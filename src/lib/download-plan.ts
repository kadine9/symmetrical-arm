import { buildCells, type Cell, type Group, type LinkItem, type Settings } from "./commands";

export interface DownloadAssignment {
  batch?: string | undefined;
  folder?: string | undefined;
  parts?: number | undefined;
}
export interface DownloadPlan {
  folders: string[];
  folder: string;
  batches: string[];
  assignments: Record<string, DownloadAssignment>;
}
export const EMPTY_PLAN: DownloadPlan = { folders: [], folder: "", batches: [], assignments: {} };

export function normalizePlan(raw: unknown): DownloadPlan {
  if (!raw || typeof raw !== "object") return EMPTY_PLAN;
  const p = raw as Partial<DownloadPlan>;
  const folders = Array.isArray(p.folders)
    ? [
        ...new Set(
          p.folders.filter(
            (f): f is string => typeof f === "string" && !!f.trim() && !/[\r\n\0]/.test(f),
          ),
        ),
      ]
    : [];
  const batches = Array.isArray(p.batches)
    ? p.batches.filter((b): b is string => typeof b === "string" && b !== "separate" && !!b)
    : [];
  const assignments: DownloadPlan["assignments"] = {};
  for (const [url, a] of Object.entries(p.assignments ?? {})) {
    if (!a || typeof a !== "object") continue;
    assignments[url] = {
      batch: a.batch === "separate" || batches.includes(a.batch ?? "") ? a.batch : undefined,
      folder: folders.includes(a.folder ?? "") ? a.folder : undefined,
      parts: Number.isInteger(a.parts) && (a.parts as number) > 1 ? a.parts : undefined,
    };
  }
  return {
    folders,
    batches,
    folder: folders.includes(p.folder ?? "") ? (p.folder ?? "") : "",
    assignments,
  };
}

const shellQuote = (s: string) => "'" + s.replace(/'/g, "'\\''") + "'";

export function destinationCell(cell: Cell, folder: string): Cell {
  if (!folder || cell.kind === "plain") return cell;
  const text = cell.text
    .replace(
      /^! (?!pip install)(.*)$/gm,
      (_, command: string) =>
        `! mkdir -p -- ${shellQuote(folder)} && cd -- ${shellQuote(folder)} && ${command}`,
    )
    .replace(
      /extract_path = (?:'extracted_files'|"extracted_files")/g,
      `extract_path = ${JSON.stringify(folder)}`,
    );
  return { ...cell, text, label: `${cell.label} → ${folder}` };
}

export function buildPlannedCells(
  view: LinkItem[],
  groups: Group[],
  settings: Settings,
  parts: number,
  plan: DownloadPlan,
): Cell[] {
  const buckets = new Map<
    string,
    { members: LinkItem[]; folder: string; batch: string; split: number }
  >();
  for (const f of view) {
    const a = plan.assignments[f.url];
    const folder = a?.folder || plan.folder;
    const batch = a?.batch || "";
    const split = a?.parts ?? 0;
    const key = JSON.stringify([folder, batch, batch === "separate" ? f.id : "", split]);
    const bucket = buckets.get(key) ?? { members: [], folder, batch, split };
    bucket.members.push(f);
    buckets.set(key, bucket);
  }
  const out: Cell[] = [];
  for (const { members, folder, batch, split } of buckets.values()) {
    const custom = !!batch && settings.commands && settings.kind !== "plain";
    // A batch keeps each link's own command type (wget / zip / rar / split archive),
    // so archives in a batch are still downloaded in parallel AND extracted.
    // Only the grouping is overridden: the whole batch is built together.
    const s: Settings = custom
      ? {
          ...settings,
          mode: batch === "separate" ? "single" : "all",
          moviesAlone: false,
          looseSeriesPlain: false,
        }
      : settings;
    const n = Math.min(Math.max(1, split || (custom ? 1 : parts)), members.length);
    for (let p = 0; p < n; p++) {
      const chunk = members.slice(
        Math.round((p * members.length) / n),
        Math.round(((p + 1) * members.length) / n),
      );
      out.push(
        ...buildCells(chunk, groups, s).map((c) =>
          destinationCell(
            {
              ...c,
              label:
                batch && batch !== "separate"
                  ? `${batch}${n > 1 ? ` · Part ${p + 1}/${n}` : ""} · ${c.label}`
                  : n > 1
                    ? `Part ${p + 1}/${n} · ${c.label}`
                    : c.label,
            },
            folder,
          ),
        ),
      );
    }
  }
  return out;
}
