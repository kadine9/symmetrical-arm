// src/lib/useSync.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
// Adjust this path to wherever your Supabase client lives.
import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/commands";
import { normalizePlan, type DownloadPlan } from "@/lib/download-plan";

export type Snapshot = {
  input: string;
  settings: Settings;
  off: string[];
  forceCD: boolean;
  parts: number;
  sortMode: "none" | "episode";
  downloadPlan?: DownloadPlan;
};

export type SyncStatus = "off" | "syncing" | "synced" | "error";

const CODE_KEY = "lp_sync_code";
const TS_KEY = "lp_sync_ts";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I

// ── code helpers ─────────────────────────────────────────────────────────────
export const CODE_LEN = 16; // ~80 bits: it lives in a link, nobody types it

export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LEN));
  // 256 % 32 === 0, so this has no modulo bias.
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

export function normalizeCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Accepts a bare code or a whole workspace link (…#w=CODE).
export function extractCode(raw: string): string {
  const m = raw.match(/[#&?]w=([A-Za-z0-9]+)/);
  return normalizeCode(m ? m[1]! : raw);
}

export function workspaceUrl(code: string): string {
  return `${window.location.origin}${window.location.pathname}#w=${code}`;
}

async function hashCode(code: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode("linkpop:" + normalizeCode(code)),
  );
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
}

// ── remote calls (RPC functions from the migration) ─────────────────────────
// Cast because the generated Supabase types don't know about these functions.
const rpc = (fn: string, args: Record<string, unknown>) =>
  (supabase as any).rpc(fn, args) as Promise<{ data: any; error: any }>;

async function pullRemote(hash: string) {
  const { data, error } = await rpc("sync_pull", { p_hash: hash });
  if (error) throw error;
  return (data ?? null) as { data: unknown; updated_at: number } | null;
}

async function pushRemote(hash: string, snap: Snapshot, updatedAt: number) {
  const { error } = await rpc("sync_push", {
    p_hash: hash,
    p_data: snap,
    p_updated_at: updatedAt,
  });
  if (error) throw error;
}

// Fill defaults / clamp so a snapshot from an older or newer app version is safe.
export function normalizeSnapshot(raw: any): Snapshot {
  return {
    input: typeof raw?.input === "string" ? raw.input : "",
    settings: { ...DEFAULT_SETTINGS, ...(raw?.settings ?? {}) },
    off: Array.isArray(raw?.off) ? raw.off.filter((x: unknown) => typeof x === "string") : [],
    forceCD: !!raw?.forceCD,
    parts: Math.max(1, parseInt(raw?.parts, 10) || 1),
    sortMode: raw?.sortMode === "episode" ? "episode" : "none",
    downloadPlan: normalizePlan(raw?.downloadPlan),
  };
}

// ── hook ─────────────────────────────────────────────────────────────────────
export function useSync(snapshot: Snapshot, ready: boolean, apply: (s: Snapshot) => void) {
  const [code, setCode] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [status, setStatus] = useState<SyncStatus>("off");

  const serialized = useMemo(() => JSON.stringify(snapshot), [snapshot]);
  const snapRef = useRef(snapshot);
  snapRef.current = snapshot;
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const lastRef = useRef(""); // serialized state known to match the server
  const tsRef = useRef(0); // time of the last local edit (or last applied remote)

  const saveTs = (ts: number) => {
    tsRef.current = ts;
    try {
      localStorage.setItem(TS_KEY, String(ts));
    } catch {
      /* ignore */
    }
  };

  // Restore saved code once local state has been restored.
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    try {
      const c = localStorage.getItem(CODE_KEY);
      tsRef.current = Number(localStorage.getItem(TS_KEY) ?? 0) || 0;
      if (c) {
        lastRef.current = JSON.stringify(snapRef.current);
        hashCode(c).then((h) => {
          if (cancelled) return;
          setCode(c);
          setHash(h);
          setStatus("synced");
        });
      }
    } catch {
      /* ignore */
    }
    return () => {
      cancelled = true;
    };
  }, [ready]);

  const pull = useCallback(async (h: string, force = false) => {
    // Never overwrite what the user is typing.
    if (!force && document.activeElement?.tagName === "TEXTAREA") return;
    setStatus("syncing");
    try {
      const remote = await pullRemote(h);
      const local = JSON.stringify(snapRef.current);
      if (!remote) {
        saveTs(Date.now());
        await pushRemote(h, snapRef.current, tsRef.current);
        lastRef.current = local;
      } else {
        const n = normalizeSnapshot(remote.data);
        const remoteStr = JSON.stringify(n);
        if (remoteStr === local) {
          lastRef.current = local;
          if (remote.updated_at > tsRef.current) saveTs(remote.updated_at);
        } else if (force || remote.updated_at > tsRef.current) {
          lastRef.current = remoteStr;
          saveTs(remote.updated_at);
          applyRef.current(n);
        } else {
          // Local is newer (e.g. edited, then closed before the push went out).
          await pushRemote(h, snapRef.current, tsRef.current);
          lastRef.current = local;
        }
      }
      setStatus("synced");
    } catch {
      setStatus("error");
    }
  }, []);

  // Pull on connect, on tab focus, and every 30s while visible.
  useEffect(() => {
    if (!hash) return;
    pull(hash);
    const onVis = () => document.visibilityState === "visible" && pull(hash);
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onVis);
    const id = setInterval(onVis, 30000);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onVis);
      clearInterval(id);
    };
  }, [hash, pull]);

  // Push local edits, debounced.
  useEffect(() => {
    if (!ready || !hash) return;
    if (serialized === lastRef.current) return;
    const ts = Date.now();
    saveTs(ts);
    const snap = snapRef.current;
    const t = setTimeout(async () => {
      setStatus("syncing");
      try {
        await pushRemote(hash, snap, ts);
        lastRef.current = serialized;
        setStatus("synced");
      } catch {
        setStatus("error");
      }
    }, 1200);
    return () => clearTimeout(t);
  }, [ready, hash, serialized]);

  const connect = async (rawCode: string, isNew: boolean) => {
    const c = extractCode(rawCode);
    const h = await hashCode(c);
    localStorage.setItem(CODE_KEY, c);
    if (isNew) {
      // Fresh code: this device's data becomes the master copy.
      saveTs(Date.now());
      lastRef.current = "";
    } else {
      // Existing code: pull() below will apply the server copy if there is one.
      saveTs(0);
      // Mark local as "in sync" so the push effect can't overwrite the server
      // copy before the pull below finishes.
      lastRef.current = JSON.stringify(snapRef.current);
    }
    setCode(c);
    setHash(h);
    if (!isNew) await pull(h, true);
  };

  const enable = async () => {
    // Short codes can collide: pick one that isn't already in use.
    for (let i = 0; i < 5; i++) {
      const c = generateCode();
      if (!(await pullRemote(await hashCode(c)))) return connect(c, true);
    }
    throw new Error("Could not find a free code");
  };
  const join = (rawCode: string) => connect(rawCode, false);

  // Opening a workspace link (#w=CODE) joins that workspace automatically.
  const autoJoined = useRef(false);
  useEffect(() => {
    if (!ready || autoJoined.current) return;
    autoJoined.current = true;
    const m = window.location.hash.match(/[#&]w=([A-Za-z0-9]+)/);
    if (!m) return;
    const c = normalizeCode(m[1]!);
    if (c.length !== CODE_LEN) return;
    const stored = localStorage.getItem(CODE_KEY);
    if (stored === c) return;
    if (
      stored &&
      !window.confirm(
        "Switch to the workspace in this link? This device will use its data instead.",
      )
    )
      return;
    connect(c, false).catch(() => setStatus("error"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Keep the address bar on the workspace link so it can be bookmarked.
  useEffect(() => {
    if (!ready) return;
    if (code) {
      if (!window.location.hash.includes("w=" + code)) history.replaceState(null, "", "#w=" + code);
    } else if (/^#w=/.test(window.location.hash)) {
      history.replaceState(null, "", window.location.pathname + window.location.search);
    }
  }, [ready, code]);

  const disconnect = async (deleteRemote: boolean) => {
    if (deleteRemote && hash) {
      try {
        await rpc("sync_delete", { p_hash: hash });
      } catch {
        /* ignore */
      }
    }
    localStorage.removeItem(CODE_KEY);
    localStorage.removeItem(TS_KEY);
    setCode(null);
    setHash(null);
    setStatus("off");
  };

  return { code, status, enable, join, disconnect };
}
