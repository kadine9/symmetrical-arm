import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { FolderOpen, Save, Trash2 } from "lucide-react";
import { autoSave, deleteBatch, listSaved, saveBatch } from "@/lib/saved.functions";

type Row = Awaited<ReturnType<typeof listSaved>>[number];

function getDeviceKey() {
  let k = localStorage.getItem("lp_device");
  if (!k) {
    k = crypto.randomUUID() + crypto.randomUUID();
    localStorage.setItem("lp_device", k);
  }
  return k;
}

export function SavedLinks({
  input,
  linkCount,
  onLoad,
}: {
  input: string;
  linkCount: number;
  onLoad: (content: string) => void;
}) {
  const [deviceKey, setDeviceKey] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async (k: string) => {
    try {
      setRows(await listSaved({ data: { deviceKey: k } }));
    } catch {
      toast.error("Could not load saved links");
    }
  }, []);

  useEffect(() => {
    const k = getDeviceKey();
    setDeviceKey(k);
    void refresh(k);
  }, [refresh]);

  const [status, setStatus] = useState("");
  const first = useRef(true);
  // Auto-save the paste box 1.5s after it stops changing.
  useEffect(() => {
    if (!deviceKey) return;
    if (first.current) {
      first.current = false;
      return;
    }
    if (!input.trim()) return;
    setStatus("Saving…");
    const t = setTimeout(async () => {
      try {
        const res = await autoSave({
          data: {
            deviceKey,
            id: localStorage.getItem("lp_autosave_id"),
            content: input,
            linkCount,
          },
        });
        localStorage.setItem("lp_autosave_id", res.id);
        setStatus("Auto-saved ✓");
        void refresh(deviceKey);
      } catch {
        setStatus("Auto-save failed");
      }
    }, 1500);
    return () => clearTimeout(t);
  }, [input, linkCount, deviceKey, refresh]);

  const save = async () => {
    if (!input.trim()) return;
    setBusy(true);
    try {
      await saveBatch({
        data: {
          deviceKey,
          title: title.trim() || `Batch · ${new Date().toLocaleString()}`,
          content: input,
          linkCount,
        },
      });
      setTitle("");
      toast.success("Links saved");
      await refresh(deviceKey);
    } catch {
      toast.error("Could not save links");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteBatch({ data: { deviceKey, id } });
      setRows((r) => r.filter((x) => x.id !== id));
      if (localStorage.getItem("lp_autosave_id") === id) localStorage.removeItem("lp_autosave_id");
    } catch {
      toast.error("Could not delete");
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-4">
      <div className="flex gap-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Name this batch (optional)"
          aria-label="Batch name"
          className="min-w-0 flex-1 rounded-full border-[1.5px] border-border bg-white px-4 py-2 text-base outline-none focus:border-primary sm:text-sm"
        />
        <button
          onClick={save}
          disabled={busy || !input.trim() || !deviceKey}
          className="lp-btn-pri shrink-0 rounded-full px-4 py-2 text-sm font-bold disabled:opacity-40"
        >
          <Save className="mr-1 inline size-4" />
          Save
        </button>
      </div>
      {status && <p className="mt-2 text-xs font-semibold text-muted-foreground">{status}</p>}
      {rows.length > 0 && (
        <ul className="lp-scroll mt-3 max-h-56 space-y-1.5 overflow-auto">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex items-center gap-2 rounded-xl border border-border bg-white/80 px-3 py-1.5 text-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold">{r.title}</span>
                <span className="block text-xs text-muted-foreground">
                  {r.link_count} links · {new Date(r.created_at).toLocaleDateString()}
                </span>
              </span>
              <button
                aria-label={`Load ${r.title}`}
                onClick={() => onLoad(r.content)}
                className="rounded-full p-2 hover:bg-purple-50"
              >
                <FolderOpen className="size-4" />
              </button>
              <button
                aria-label={`Delete ${r.title}`}
                onClick={() => remove(r.id)}
                className="rounded-full p-2 text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
