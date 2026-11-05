// src/components/SyncPanel.tsx
import { useState } from "react";
import { toast } from "sonner";
import { Check, ClipboardCopy, Cloud, CloudOff, Loader2, TriangleAlert } from "lucide-react";
import { CODE_LEN, extractCode, workspaceUrl, type SyncStatus } from "@/lib/useSync";

type Props = {
  code: string | null;
  status: SyncStatus;
  onEnable: () => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onDisconnect: (deleteRemote: boolean) => Promise<void>;
};

export function SyncPanel({ code, status, onEnable, onJoin, onDisconnect }: Props) {
  const [entry, setEntry] = useState("");
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch {
      toast.error("Something went wrong — try again");
    } finally {
      setBusy(false);
    }
  };

  const copyCode = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(workspaceUrl(code));
      toast.success("Workspace link copied");
    } catch {
      toast.error("Clipboard blocked — select the code and copy manually");
    }
  };

  const statusLabel = {
    off: "",
    syncing: "Syncing…",
    synced: "Synced",
    error: "Offline — will retry",
  }[status];

  return (
    <section className="lp-card p-5">
      <h2 className="mb-1 font-display text-xl font-semibold">
        <Cloud className="mr-1.5 inline size-5 text-purple-500" />
        Sync devices
      </h2>

      {!code ? (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            Keep your links and settings the same on every device. No account — just a private
            workspace link.
          </p>
          <button
            disabled={busy}
            onClick={() => run(onEnable)}
            className="lp-btn-pri mb-4 w-full rounded-full px-4 py-2 text-sm font-bold disabled:opacity-40 sm:w-auto"
          >
            Create workspace link
          </button>
          <div className="text-xs font-extrabold tracking-widest text-muted-foreground uppercase">
            Have a workspace link?
          </div>
          <div className="mt-1.5 flex gap-2">
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              aria-label="Workspace link"
              placeholder="Paste link (or code)"
              autoCapitalize="characters"
              spellCheck={false}
              className="lp-code min-w-0 flex-1 rounded-full border-[1.5px] border-border bg-white px-4 py-2 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 sm:text-sm"
            />
            <button
              disabled={busy || extractCode(entry).length !== CODE_LEN}
              onClick={() =>
                run(async () => {
                  if (
                    !window.confirm(
                      "This replaces the data on this device with the synced copy. Continue?",
                    )
                  )
                    return;
                  await onJoin(entry);
                  setEntry("");
                })
              }
              className="rounded-full border-[1.5px] border-border bg-white px-4 py-2 text-sm font-bold hover:bg-purple-50 disabled:opacity-40"
            >
              Join
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
            {status === "syncing" && <Loader2 className="size-4 animate-spin" />}
            {status === "synced" && <Check className="size-4 text-emerald-600" />}
            {status === "error" && <TriangleAlert className="size-4 text-amber-600" />}
            {statusLabel}
          </div>
          <div className="flex items-center gap-2">
            <code className="lp-code min-w-0 flex-1 truncate rounded-full border border-border bg-white px-4 py-2 text-sm font-bold tracking-wider text-purple-800">
              {workspaceUrl(code).replace(/^https?:\/\//, "")}
            </code>
            <button
              onClick={copyCode}
              aria-label="Copy workspace link"
              className="lp-btn-pri rounded-full p-2.5"
            >
              <ClipboardCopy className="size-4" />
            </button>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            Open this link on your other devices (or bookmark it) to use the same workspace. Anyone
            with the link can read and change your synced data, so keep it private.
          </p>
          <div className="mt-3 flex flex-wrap gap-2 text-sm">
            <button
              disabled={busy}
              onClick={() => run(() => onDisconnect(false))}
              className="rounded-full border border-border bg-white px-3 py-1.5 font-semibold hover:bg-purple-50"
            >
              <CloudOff className="mr-1 inline size-3.5" />
              Disconnect this device
            </button>
            <button
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (
                    !window.confirm(
                      "Delete the synced copy from the server and disconnect? Other devices keep their local data but stop syncing.",
                    )
                  )
                    return;
                  await onDisconnect(true);
                })
              }
              className="rounded-full border border-rose-200 bg-white px-3 py-1.5 font-semibold text-rose-600 hover:bg-rose-50"
            >
              Delete workspace data
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────────────
   WIRING IN src/routes/index.tsx  (4 small edits)

   1) Imports:
      import { SyncPanel } from '@/components/SyncPanel'
      import { useSync, type Snapshot } from '@/lib/useSync'

   2) Inside Home(), after the `ready` state / localStorage effects:

      const snapshot = useMemo<Snapshot>(
        () => ({ input, settings, off: [...off], forceCD, parts, sortMode }),
        [input, settings, off, forceCD, parts, sortMode],
      )
      const sync = useSync(snapshot, ready, (s) => {
        setInput(s.input)
        setSettings(s.settings)
        setOff(new Set(s.off))
        setForceCD(s.forceCD)
        setParts(s.parts)
        setSortMode(s.sortMode)
      })

   3) At the end of the left column (right after the "3 · Pick links" </section>):

      <SyncPanel
        code={sync.code}
        status={sync.status}
        onEnable={sync.enable}
        onJoin={sync.join}
        onDisconnect={sync.disconnect}
      />

   4) Nothing else: your existing localStorage effects keep working as the
      offline cache; sync just layers on top.
   ────────────────────────────────────────────────────────────────────────── */
