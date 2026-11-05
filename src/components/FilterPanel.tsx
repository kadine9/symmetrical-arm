import { useState } from "react";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { DEFAULT_FILTERS, type FilterState } from "@/lib/filters";

const inputCls =
  "w-full rounded-xl border-[1.5px] border-border bg-white/90 px-3 py-2 text-base sm:text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/15";

export function FilterPanel({
  value,
  onChange,
  episodeDupes,
}: {
  value: FilterState;
  onChange: (v: FilterState) => void;
  episodeDupes: number;
}) {
  const [open, setOpen] = useState(false);
  const set = <K extends keyof FilterState>(k: K, v: FilterState[K]) =>
    onChange({ ...value, [k]: v });
  const text = (
    k: "show" | "term" | "or" | "only" | "except" | "priority" | "dedupeIgnore",
    label: string,
    ph: string,
  ) => (
    <label className="block text-xs font-semibold text-muted-foreground">
      {label}
      <input
        className={inputCls + " mt-1"}
        value={value[k]}
        placeholder={ph}
        onChange={(e) => set(k, e.target.value)}
      />
    </label>
  );
  const active = JSON.stringify(value) !== JSON.stringify(DEFAULT_FILTERS);

  return (
    <div className="rounded-2xl border border-border bg-white/70 p-2">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-sm font-bold"
        onClick={() => setOpen(!open)}
      >
        {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        Advanced filters {active && <span className="text-xs font-normal text-primary">(on)</span>}
      </button>
      {open && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {text("show", "Show name", "e.g. the curse")}
          {text("term", "Has all words", "1080p web")}
          {text("or", "Has any word", "amzn nf")}
          {text("only", "Only phrases (comma)", "repack, proper")}
          {text("except", "Except phrases (comma)", "sample, trailer")}
          <div className="flex items-end gap-2">
            <label className="block flex-1 text-xs font-semibold text-muted-foreground">
              Hide links
              <input
                type="number"
                min={0}
                className={inputCls + " mt-1"}
                value={value.hide || ""}
                placeholder="0"
                onChange={(e) => set("hide", Math.max(0, parseInt(e.target.value, 10) || 0))}
              />
            </label>
            <select
              className={inputCls + " w-auto"}
              value={value.hidePos}
              onChange={(e) => set("hidePos", e.target.value as "top" | "bottom")}
            >
              <option value="top">from top</option>
              <option value="bottom">from bottom</option>
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={value.dedupeUrls} onCheckedChange={(v) => set("dedupeUrls", v)} />
            Remove exact duplicate URLs
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={value.dedupeEps} onCheckedChange={(v) => set("dedupeEps", v)} />
            One release per episode {episodeDupes > 0 && `(${episodeDupes} skipped)`}
          </label>
          {value.dedupeEps && (
            <>
              <label className="block text-xs font-semibold text-muted-foreground">
                Keep which
                <select
                  className={inputCls + " mt-1"}
                  value={value.dedupeMode}
                  onChange={(e) => set("dedupeMode", e.target.value as FilterState["dedupeMode"])}
                >
                  <option value="priority">Best by priority words</option>
                  <option value="first">First one</option>
                  <option value="last">Last one</option>
                </select>
              </label>
              {value.dedupeMode === "priority" &&
                text("priority", "Priority words (best first)", "repack proper 2160p 1080p")}
              {text("dedupeIgnore", "Never dedupe if name has", "extras")}
            </>
          )}
          {active && (
            <button
              type="button"
              className="flex items-center gap-1 text-xs font-semibold text-primary sm:col-span-2"
              onClick={() => onChange(DEFAULT_FILTERS)}
            >
              <RotateCcw className="size-3.5" /> Reset filters
            </button>
          )}
        </div>
      )}
    </div>
  );
}
