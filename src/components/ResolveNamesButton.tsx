import { useRef, useState } from "react";
import { toast } from "sonner";
import { FileSearch, Loader2 } from "lucide-react";
import { applyNamesToInput } from "@/lib/name-lines";
import { resolveNames } from "@/lib/resolve-names";

type Props = {
  input: string;
  urls: string[]; // the links currently selected
  onChange: (text: string) => void;
};

export function ResolveNamesButton({ input, urls, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(input);
  inputRef.current = input; // latest text, in case you keep editing while it runs

  const run = async () => {
    if (busy || !urls.length) return;
    setBusy(true);
    const id = toast.loading(`Checking ${urls.length} link${urls.length === 1 ? "" : "s"}…`);
    try {
      const res = await resolveNames(urls, (d, t) =>
        toast.loading(`Checking links… ${d}/${t}`, { id }),
      );
      const names: Record<string, string> = {};
      let failed = 0;
      for (const r of res) {
        if (r.name) names[r.url] = r.name;
        else failed++;
      }

      const before = inputRef.current;
      const { text, changed } = applyNamesToInput(before, names);
      if (changed) onChange(text);

      const note = failed ? ` · ${failed} couldn't be checked` : "";
      if (changed) {
        toast.success(`Updated ${changed} name${changed === 1 ? "" : "s"}${note}`, {
          id,
          action: { label: "Undo", onClick: () => onChange(before) },
        });
      } else {
        toast.success(failed ? `No names found${note}` : "Names already match", { id });
      }
    } catch {
      toast.error("Could not check links — try again", { id });
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      disabled={busy || !urls.length}
      onClick={run}
      title="Ask each server for the real file name (HEAD / Content-Disposition)"
      className="mt-3 rounded-full border border-border bg-white px-3 py-2 text-sm font-semibold hover:bg-purple-50 disabled:opacity-40 sm:py-1"
    >
      {busy ? (
        <Loader2 className="mr-1 inline size-3.5 animate-spin" />
      ) : (
        <FileSearch className="mr-1 inline size-3.5" />
      )}
      Get real names{urls.length ? ` (${urls.length})` : ""}
    </button>
  );
}
