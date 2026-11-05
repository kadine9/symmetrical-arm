import { useState } from "react";
import { FolderPlus, Trash2, Combine, Split, RotateCcw, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { DownloadPlan } from "@/lib/download-plan";

export function DownloadDestinations({
  plan,
  onChange,
  urls,
}: {
  plan: DownloadPlan;
  onChange: (p: DownloadPlan) => void;
  urls: string[];
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [splitN, setSplitN] = useState(2);
  const assign = (batch?: string, batches = plan.batches) => {
    const assignments = { ...plan.assignments };
    urls.forEach((url) => {
      assignments[url] = { ...assignments[url], batch };
    });
    onChange({ ...plan, batches, assignments });
  };
  const split = (n?: number) => {
    const assignments = { ...plan.assignments };
    urls.forEach((url) => {
      assignments[url] = { ...assignments[url], parts: n };
    });
    onChange({ ...plan, assignments });
  };
  const add = () => {
    const folder = draft.trim();
    if (!folder || /[\r\n\0]/.test(folder)) {
      setError("Enter a folder path on one line.");
      return;
    }
    onChange({ ...plan, folders: [...new Set([...plan.folders, folder])], folder });
    setDraft("");
    setError("");
  };
  return (
    <div className="mb-4 space-y-3 border-b border-border pb-4">
      <label className="block text-sm font-bold" htmlFor="download-folder">
        Download folder
      </label>
      <div className="flex min-w-0 gap-2">
        <select
          id="download-folder"
          value={plan.folder}
          onChange={(e) => onChange({ ...plan, folder: e.target.value })}
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        >
          <option value="">Current Colab folder</option>
          {plan.folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <Button
          variant="outline"
          size="icon"
          disabled={!plan.folder}
          title="Remove selected folder"
          aria-label="Remove selected folder"
          onClick={() => {
            const assignments = Object.fromEntries(
              Object.entries(plan.assignments).map(([url, a]) => [
                url,
                { ...a, folder: a.folder === plan.folder ? undefined : a.folder },
              ]),
            );
            onChange({
              ...plan,
              folders: plan.folders.filter((f) => f !== plan.folder),
              folder: "",
              assignments,
            });
          }}
        >
          <Trash2 />
        </Button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
        className="flex min-w-0 gap-2"
      >
        <input
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError("");
          }}
          aria-label="New download folder"
          placeholder="/content/drive/MyDrive/Movies"
          className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <Button type="submit" size="icon" title="Add folder" aria-label="Add folder">
          <FolderPlus />
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <span className="w-full text-sm font-bold">Selected items · {urls.length}</span>
        <Button
          variant="outline"
          size="sm"
          disabled={!urls.length}
          onClick={() => {
            let i = 1;
            while (plan.batches.includes(`Together ${i}`)) i++;
            const batch = `Together ${i}`;
            assign(batch, [...plan.batches, batch]);
          }}
        >
          <Combine />
          Together (wget)
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!urls.length}
          onClick={() => assign("separate")}
        >
          <Split />
          Separate (wget)
        </Button>
        <span className="flex items-center gap-1">
          <input
            type="number"
            min={2}
            value={splitN}
            onChange={(e) => setSplitN(Math.max(2, parseInt(e.target.value, 10) || 2))}
            aria-label="Split selected into parts"
            className="w-14 rounded-md border border-input bg-background px-2 py-1 text-sm"
          />
          <Button variant="outline" size="sm" disabled={!urls.length} onClick={() => split(splitN)}>
            <Scissors />
            Split
          </Button>
        </span>
        <Button
          variant="ghost"
          size="icon"
          disabled={!urls.length}
          title="Reset selected items to automatic"
          aria-label="Reset selected items to automatic"
          onClick={() => {
            const assignments = { ...plan.assignments };
            urls.forEach((u) => {
              assignments[u] = {};
            });
            onChange({ ...plan, assignments });
          }}
        >
          <RotateCcw />
        </Button>
      </div>
    </div>
  );
}
