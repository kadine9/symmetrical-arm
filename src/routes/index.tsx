import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardCopy,
  Search,
  Sparkles,
  Trash2,
  ArrowDownToLine,
  ArrowUpToLine,
  Wand2,
  X,
} from "lucide-react";

import { Switch } from "@/components/ui/switch";
import {
  DEFAULT_SETTINGS,
  TAG,
  blankCells,
  buildGroups,
  dedupeItems,
  parseLinks,
  type Cell,
  type CopyMode,
  type ForceKind,
  type Kind,
  type Settings,
} from "@/lib/commands";
import { cn } from "@/lib/utils";
import { dedupeEpisodes, sortByEpisode } from "@/lib/episodes";
import {
  DEFAULT_FILTERS,
  buildMatcher,
  dedupeExactUrls,
  hideEdge,
  normalizeFilters,
  wordsOf,
  type FilterState,
} from "@/lib/filters";
import { FilterPanel } from "@/components/FilterPanel";
import { SavedLinks } from "@/components/SavedLinks";
import { SyncPanel } from "@/components/SyncPanel";
import { ResolveNamesButton } from "@/components/ResolveNamesButton";
import { useSync, type Snapshot } from "@/lib/useSync";
import { DownloadDestinations } from "@/components/DownloadDestinations";
import {
  buildPlannedCells,
  EMPTY_PLAN,
  normalizePlan,
  type DownloadPlan,
} from "@/lib/download-plan";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "LinkPop — Turn download links into Colab cells" },
      {
        name: "description",
        content:
          "Paste download links and get ready-to-run Colab wget cells. Save link batches to reuse later.",
      },
      { property: "og:title", content: "LinkPop — Turn download links into Colab cells" },
      {
        property: "og:description",
        content: "Paste download links and get ready-to-run Colab wget cells.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

const SAMPLE = `1. Dune.Part.Two.2024.1080p.WEB.mkv
https://srv3.example-cdn.com/d/8hQk2/Dune.Part.Two.2024.1080p.WEB.mkv
https://srv1.example-cdn.com/d/ab12/Oppenheimer.2023.2160p.mkv?token=Xy91kP&expires=1761200000https://srv1.example-cdn.com/d/cd34/Arrival.2016.720p.mp4
https://srv2.example-cdn.com/f/Severance.S02E01.1080p.mkv https://srv2.example-cdn.com/f/Severance.S02E02.1080p.mkv https://srv2.example-cdn.com/f/Severance.S02E03.1080p.mkv https://srv2.example-cdn.com/f/Severance.S02E04.1080p.mkv
https://srv4.example-cdn.com/dl/Photos.Backup.zip?sig=a1b2c3
https://srv4.example-cdn.com/dl/Project.Files.part1.rarhttps://srv4.example-cdn.com/dl/Soundtrack.rar
https://srv5.example-cdn.com/dl/BigArchive.zip.001
https://srv5.example-cdn.com/dl/BigArchive.zip.002
https://srv6.example-cdn.com/get?id=77&filename=Notes.pdf`;

const KIND_STYLE: Record<Kind, string> = {
  movie: "badge-candy-berry font-black",
  series: "badge-candy-violet font-black",
  zip: "badge-candy-sun font-black",
  other: "badge-candy-mint font-black",
};
const CELL_EMOJI: Record<string, string> = {
  movie: "🎬",
  wget: "📦",
  zip: "🗜️",
  rar: "🗜️",
  split: "🧩",
  plain: "🔗",
};
const MODES: [CopyMode, string, string][] = [
  ["all", "Together", "Everything in as few cells as possible (movies still alone)"],
  ["group", "By group", "One cell per group — each movie on its own"],
  ["single", "One by one", "A separate cell for every single link"],
];

// Command type chooser: "auto" picks per link; the rest force every selected link into that type.
const KINDS: [ForceKind, string][] = [
  ["auto", "Auto (detect per link)"],
  ["wget", "wget (downloads)"],
  ["zip", "ZIP (download + extract)"],
  ["rar", "RAR (download + extract)"],
  ["split", "Split archive (.001, .002…)"],
  ["plain", "Plain links (no command)"],
];

type SortMode = "none" | "episode";
const SORTS: [SortMode, string, string][] = [
  ["none", "As pasted", "Keep the order the links were pasted in"],
  ["episode", "By episode", "Show name → season → episode"],
];

// Settings that can be changed for only the selected links.
type SettingsKey =
  | "commands"
  | "moviesAlone"
  | "parallel"
  | "looseSeriesPlain"
  | "comments"
  | "names"
  | "forceName"
  | "workers"
  | "mode"
  | "dedupe";
type OvKey =
  | SettingsKey
  | "forceCD"
  | "parts"
  | "sortMode"
  | "groupKeys"
  | "autoGroup"
  | "autoCopy"
  | "autoDelay";
type Override = Partial<Pick<Settings, SettingsKey>> & {
  forceCD?: boolean;
  parts?: number;
  sortMode?: SortMode;
  groupKeys?: string;
  autoGroup?: boolean;
  autoCopy?: boolean;
  autoDelay?: number;
};
type Scope = "all" | "selected";

const LS = {
  input: "lp_input",
  settings: "lp_settings",
  off: "lp_off",
  extra: "lp_extra",
};
const NO_COPIES: ReadonlySet<number> = new Set();

type Item = ReturnType<typeof parseLinks>[number];

// ── Group by keyword ─────────────────────────────────────────────────────────
// "severance dune" → one bucket per keyword (matched against name + URL, first
// keyword wins), then everything else in "Other". Empty keywords = no bucketing.
const splitKeys = (s: string) => Array.from(new Set(s.toLowerCase().split(/\s+/).filter(Boolean)));

function bucketByKeywords(items: Item[], keys: string[]) {
  if (!keys.length) return [{ label: "", items }];
  const buckets = keys.map((k) => ({ label: k, items: [] as Item[] }));
  const rest: Item[] = [];
  for (const f of items) {
    const hay = `${f.name}\n${f.url}`.toLowerCase();
    const i = keys.findIndex((k) => hay.includes(k));
    if (i >= 0) buckets[i]!.items.push(f);
    else rest.push(f);
  }
  const out = buckets.filter((b) => b.items.length);
  if (rest.length) out.push({ label: "Other", items: rest });
  return out;
}

// ── Auto group ───────────────────────────────────────────────────────────────
// Movies / non-series files each get their own group; a season with MORE than
// `minEpisodes` episodes becomes one group; short seasons fall into "Ungrouped".
const AUTO = "\u0000auto"; // appended to a keyword string to mean "auto group on"
const AUTO_MIN_EPISODES = 3;
const NO_COPIES_URLS: ReadonlySet<string> = new Set();

function seasonOf(title: string): number | null {
  let m = title.match(/s(\d{1,4})[\s._-]*e(\d{1,4})/i);
  if (m) return parseInt(m[1]!, 10);
  m = title.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (m) return parseInt(m[1]!, 10);
  m = title.match(/\b(?:s|season)[\s._-]*(\d{1,4})(?!\d)/i);
  return m ? parseInt(m[1]!, 10) : null;
}
function showOf(title: string): string {
  let n = title.replace(/[._+]+/g, " ");
  const m = n.match(
    /\b(s\d{1,4}[\s._-]*e\d{1,4}|\d{1,2}x\d{1,4}|(?:s|season)[\s._-]*\d{1,4})(?!\d)/i,
  );
  if (m && m.index !== undefined) n = n.slice(0, m.index);
  return n.replace(/\s+/g, " ").trim().toLowerCase();
}
// Best file name for a link. Collects EVERY candidate — the parsed name, the
// names hidden in query params (?n=, ?name=, ?filename=, response-content-
// disposition, …), any param that looks like a file name, every path segment,
// the #fragment — scores them and returns the one that looks most like a real
// release name (S01E02 / known extension / dots) and least like an id or hash.
const NAME_KEYS =
  /^(?:n|name|filename|file|fn|f|title|dn|download|dl|out|rename|response-content-disposition|content-disposition)$/i;
const FILE_EXT =
  /\.(?:mkv|mp4|avi|mov|wmv|m4v|webm|ts|flv|mpg|mpeg|srt|ass|sub|idx|zip|rar|7z|tar|gz|tgz|bz2|xz|iso|pdf|epub|cbz|cbr|mp3|flac|m4a|aac|wav|ogg|jpg|jpeg|png|gif|nfo|txt|001|r\d{2}|z\d{2})$/i;
function nameCandidates(f: Item): { text: string; bonus: number }[] {
  const out: { text: string; bonus: number }[] = [];
  const add = (raw: string | null | undefined, bonus: number) => {
    if (!raw) return;
    let t = raw;
    for (let i = 0; i < 2; i++) {
      try {
        const d = decodeURIComponent(t);
        if (d === t) break;
        t = d;
      } catch {
        break;
      }
    }
    // Content-Disposition style: attachment; filename*=UTF-8''X / filename="X"
    const cd = t.match(/filename\*?\s*=\s*(?:[\w-]+'[^']*')?"?([^";]+)"?/i);
    if (cd) t = cd[1]!;
    t = t.split(/[\\/]/).filter(Boolean).pop()?.trim() ?? "";
    if (t && !/\s/.test(t) && t.includes("+")) t = t.replace(/\+/g, " ");
    if (t) out.push({ text: t, bonus });
  };
  try {
    const u = new URL(f.url);
    u.searchParams.forEach((v, k) => {
      if (NAME_KEYS.test(k)) add(v, 3);
      else if (FILE_EXT.test(v) || seasonOf(v) !== null) add(v, 1);
    });
    const segs = u.pathname.split("/").filter(Boolean);
    segs
      .slice()
      .reverse()
      .forEach((seg, i) => add(seg, i === 0 ? 1 : 0));
    if (u.hash.length > 1) add(u.hash.slice(1), 0);
  } catch {
    /* not a valid URL: fall through to the raw regex below */
  }
  // Raw fallback for odd URLs that URL() could not split.
  const rawHit = f.url.match(/[?&#](?:n|name|filename|file|fn|title)=([^&#]+)/i);
  if (rawHit) add(rawHit[1], 3);
  add(f.name, 1);
  return out;
}
const looksLikeId = (t: string) => {
  const stem = t.replace(/\.[a-z0-9]{2,4}$/i, "");
  return (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(stem) ||
    /^[0-9a-f]{16,}$/i.test(stem) ||
    (/^[\w-]{20,}$/.test(stem) &&
      !/[._ ]/.test(stem) &&
      /\d/.test(stem) &&
      !/[aeiou]{2}/i.test(stem))
  );
};
function scoreName(c: { text: string; bonus: number }): number {
  const t = c.text;
  let sc = c.bonus;
  if (seasonOf(t) !== null) sc += 6;
  if (FILE_EXT.test(t)) sc += 3;
  if (/[a-z]{3,}/i.test(t) && /[._ -]/.test(t)) sc += 2;
  if (/\b(?:1080p|720p|2160p|480p|web|bluray|webrip|hdtv|x264|x265|h264|h265)\b/i.test(t)) sc += 2;
  if (looksLikeId(t)) sc -= 8;
  if (/^(?:download|get|file|index|view|stream)(?:\.\w+)?$/i.test(t)) sc -= 6;
  if (/^\d+$/.test(t)) sc -= 6;
  return sc;
}
function pickBest(cands: { text: string; bonus: number }[]) {
  let best: { text: string; bonus: number } | null = null;
  let bs = -Infinity;
  for (const c of cands) {
    const x = scoreName(c);
    if (x > bs) {
      best = c;
      bs = x;
    }
  }
  return { text: best?.text ?? "", score: bs };
}
function titleOf(f: Item): string {
  const r = pickBest(nameCandidates(f));
  return r.text || f.url;
}

// The full link as pasted: some parsers cut a URL at "&" or keep only the path,
// so if the parsed URL is a prefix of a longer token in the raw text, use that too.
function rawLinkAround(input: string, url: string): string | null {
  const at = input.indexOf(url);
  if (at < 0) return null;
  let end = at + url.length;
  while (end < input.length && !/\s/.test(input[end]!) && !input.startsWith("http", end)) end++;
  const full = input.slice(at, end);
  return full.length > url.length ? full : null;
}

// Re-derive a link's name from every source (parsed name, whole URL, raw text).
function withBestName(f: Item, input: string): Item {
  const cands = nameCandidates(f);
  const first = pickBest(cands);
  if (first.score < 8) {
    const raw = rawLinkAround(input, f.url);
    if (raw) cands.push(...nameCandidates({ ...f, url: raw }));
  }
  const best = pickBest(cands);
  return best.text && best.text !== f.name ? { ...f, name: best.text } : f;
}

// Archives: "Show.part1.zip" + "Show.part2.zip", or "Big.zip.001" + "Big.zip.002",
// share one base name → one group, always together.
const ARCHIVE_RE = /\.(?:(?:zip|rar|7z|tar|gz|tgz|bz2|xz)(?:\.\d{2,4})?|\d{3}|r\d{2}|z\d{2})$/i;
function archiveBase(title: string): string | null {
  if (!ARCHIVE_RE.test(title)) return null;
  return title
    .replace(ARCHIVE_RE, "")
    .replace(/[\s._-]*\b(?:part|pt)[\s._-]*\d+(?:[\s._-]*of[\s._-]*\d+)?$/i, "")
    .replace(/[\s._-]*\b(?:part|pt)[\s._-]*\d+(?:[\s._-]*of[\s._-]*\d+)?\b/i, "")
    .replace(/[._]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Numbered episodes with no season tag: "Loopy De Loop 01 Wolf Hounded [Pixar].mkv",
// "Show - 12 - Title.mkv", "Show Ep 5.mkv". Returns the show prefix, or null.
function bareEpisodeShow(title: string): string | null {
  const n = title
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}/g, " ")
    .replace(/[._+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const m =
    n.match(/^(.*?)[\s-]*\b(?:e|ep|eps|episode)[\s-]*(\d{1,3})\b/i) ||
    n.match(/^(.*?[a-z].*?)[\s-]+(\d{1,3})(?=[\s-]|$)/i);
  if (!m) return null;
  const show = m[1]!
    .replace(/[\s-]+$/, "")
    .trim()
    .toLowerCase();
  return /[a-z]/i.test(show) ? show : null;
}

function autoBucket(items: Item[], minEpisodes = AUTO_MIN_EPISODES) {
  const singles: { label: string; items: Item[] }[] = [];
  const seasons = new Map<string, { label: string; items: Item[] }>();
  const archives = new Map<string, { label: string; items: Item[] }>();
  const numbered = new Map<string, { label: string; items: Item[] }>();
  for (const f of items) {
    const title = titleOf(f);
    const base = archiveBase(title);
    if (base !== null) {
      if (!archives.has(base)) {
        const pretty = base.replace(/\b\w/g, (c) => c.toUpperCase());
        archives.set(base, { label: pretty || title, items: [] });
      }
      archives.get(base)!.items.push(f);
      continue;
    }
    const season = seasonOf(title);
    if (season === null) {
      const bare = bareEpisodeShow(title);
      if (bare) {
        if (!numbered.has(bare)) {
          const pretty = bare.replace(/\b\w/g, (c) => c.toUpperCase());
          numbered.set(bare, { label: pretty, items: [] });
        }
        numbered.get(bare)!.items.push(f);
      }
      singles.push({ label: title, items: [f] });
      continue;
    }
    const show = showOf(title) || "series";
    const key = `${show}|${season}`;
    if (!seasons.has(key)) {
      const pretty = show.replace(/\b\w/g, (c) => c.toUpperCase());
      seasons.set(key, { label: `${pretty} S${String(season).padStart(2, "0")}`, items: [] });
    }
    seasons.get(key)!.items.push(f);
  }
  const out: { label: string; items: Item[] }[] = [];
  const ungrouped: Item[] = [];
  for (const b of seasons.values()) {
    if (b.items.length > minEpisodes) out.push(b);
    else ungrouped.push(...b.items);
  }
  // Numbered shows with more than `minEpisodes` files sharing a prefix → one group.
  // Everything else numbered stays a single (so "Movie 2" alone is still alone).
  const taken = new Set<Item>();
  for (const b of numbered.values()) {
    if (b.items.length > minEpisodes) {
      out.push(b);
      b.items.forEach((f) => taken.add(f));
    }
  }
  out.push(...archives.values(), ...singles.filter((x) => !taken.has(x.items[0]!)));
  return { groups: out, ungrouped };
}

// Keyword groups first (a keyword always wins). With Auto group on, whatever
// no keyword claimed is then auto-grouped (movies alone, big seasons, archives);
// the remainder gets the normal movie / series / zip grouping.
function makeGroups(
  items: Item[],
  keys: string[],
  auto = false,
  held: ReadonlySet<string> = NO_COPIES_URLS,
) {
  type G = ReturnType<typeof buildGroups>[number];
  const kw: G[] = [];
  const rest: G[] = [];
  for (const b of bucketByKeywords(items, keys)) {
    if (!keys.length || !keys.includes(b.label)) {
      if (auto) {
        // Links the person put in a batch are never auto-grouped.
        const a = autoBucket(b.items.filter((f) => !held.has(f.url)));
        for (const g of a.groups)
          kw.push({ type: "other" as Kind, label: g.label, members: g.items } as G);
        const left = [...a.ungrouped, ...b.items.filter((f) => held.has(f.url))];
        if (left.length) rest.push(...buildGroups(left));
      } else rest.push(...buildGroups(b.items));
    } else kw.push({ type: "other" as Kind, label: b.label, members: b.items } as G);
  }
  return { groups: [...kw, ...rest], kwGroups: kw, restGroups: rest };
}

// ── Exact override tags shown under each link ────────────────────────────────
const onOff = (n: string) => (v: any) => `${n} ${v ? "on" : "off"}`;
const OV_TEXT: Record<string, (v: any) => string> = {
  commands: onOff("commands"),
  moviesAlone: onOff("movies alone"),
  parallel: onOff("parallel"),
  looseSeriesPlain: onOff("loose series plain"),
  comments: onOff("# comments"),
  names: onOff("names"),
  forceName: onOff("force filename"),
  forceCD: onOff("force CD"),
  dedupe: onOff("dedupe"),
  autoCopy: onOff("auto-copy"),
  autoGroup: onOff("auto group"),
  workers: (v) => `workers ${v}`,
  mode: (v) => `mode ${v}`,
  parts: (v) => `split ${v}`,
  autoDelay: (v) => `delay ${v}s`,
  sortMode: (v) => (v === "episode" ? "sort by episode" : "sort as pasted"),
  groupKeys: (v) => (v ? `keywords “${v}”` : "no keywords"),
};
function overrideTags(ov: Override | undefined, kind: ForceKind | undefined) {
  const t = Object.entries(ov ?? {})
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => OV_TEXT[k]?.(v) ?? `${k} ${v}`);
  if (kind) t.push(`type ${kind}`);
  return t;
}

function Home() {
  const [input, setInput] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  const jump = (end: boolean) => {
    const t = taRef.current;
    if (!t) return;
    t.focus();
    const pos = end ? t.value.length : 0;
    let v = t.value;
    if (end && v && !v.endsWith("\n")) {
      v += "\n";
      setInput(v);
    }
    requestAnimationFrame(() => {
      t.setSelectionRange(end ? v.length : pos, end ? v.length : pos);
      t.scrollTop = end ? t.scrollHeight : 0;
    });
  };
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [forceCD, setForceCD] = useState(false);
  const [parts, setParts] = useState(1);
  const [sortMode, setSortMode] = useState<SortMode>("none");
  const [downloadPlan, setDownloadPlan] = useState<DownloadPlan>(EMPTY_PLAN);
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [groupKeys, setGroupKeys] = useState("");
  const [autoGroup, setAutoGroup] = useState(false);
  const [autoCopy, setAutoCopy] = useState(false);
  const [autoDelay, setAutoDelay] = useState(5);
  // Per-link command type, keyed by URL. Missing = use the global "Command type".
  const [kindOverrides, setKindOverrides] = useState<Record<string, ForceKind>>({});
  // Per-link settings overrides, keyed by URL. Missing key = use the global value.
  const [overrides, setOverrides] = useState<Record<string, Override>>({});
  // Whether the Options card edits every link or only the ticked ones.
  const [scope, setScope] = useState<Scope>("all");
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [copiedState, setCopiedState] = useState<{
    key: string;
    idx: Set<number>;
  }>({
    key: "",
    idx: new Set(),
  });
  const [ready, setReady] = useState(false);

  // Restore from this browser after hydration; localStorage doesn't exist during SSR.
  useEffect(() => {
    try {
      setInput(localStorage.getItem(LS.input) ?? "");
      const s = localStorage.getItem(LS.settings);
      if (s) setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(s) });
      const o = localStorage.getItem(LS.off);
      if (o) setOff(new Set(JSON.parse(o)));
      const x = localStorage.getItem(LS.extra);
      if (x) {
        const j = JSON.parse(x);
        setForceCD(!!j.forceCD);
        setParts(Math.max(1, parseInt(j.parts, 10) || 1));
        setSortMode(j.sortMode === "episode" ? "episode" : "none");
        setDownloadPlan(normalizePlan(j.downloadPlan));
        setFilters(normalizeFilters(j.filters));
        setGroupKeys(typeof j.groupKeys === "string" ? j.groupKeys : "");
        setAutoGroup(!!j.autoGroup);
        setAutoCopy(!!j.autoCopy);
        setAutoDelay(Math.max(1, Math.min(600, parseInt(j.autoDelay, 10) || 5)));
        if (j.kindOverrides && typeof j.kindOverrides === "object")
          setKindOverrides(j.kindOverrides);
        if (j.overrides && typeof j.overrides === "object") setOverrides(j.overrides);
      }
    } catch {
      /* ignore broken storage */
    }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    localStorage.setItem(LS.input, input);
    localStorage.setItem(LS.settings, JSON.stringify(settings));
    localStorage.setItem(LS.off, JSON.stringify([...off]));
    localStorage.setItem(
      LS.extra,
      JSON.stringify({
        forceCD,
        parts,
        sortMode,
        downloadPlan,
        filters,
        groupKeys,
        autoGroup,
        autoCopy,
        autoDelay,
        kindOverrides,
        overrides,
      }),
    );
  }, [
    filters,
    autoDelay,
    kindOverrides,
    overrides,
    ready,
    input,
    settings,
    off,
    forceCD,
    parts,
    sortMode,
    downloadPlan,
    groupKeys,
    autoGroup,
    autoCopy,
  ]);

  // Userscript pushes links via #add=<encoded text>; append them to the paste box.
  useEffect(() => {
    if (!ready) return;
    const take = () => {
      const m = window.location.hash.match(/(?:^#|&)add=([^&]*)/);
      if (!m) return;
      let added = "";
      try {
        added = decodeURIComponent(m[1] ?? "");
      } catch {
        return;
      }
      const rest = window.location.hash.replace(/(?:^#|&)add=[^&]*/, "").replace(/^&/, "");
      history.replaceState(
        null,
        "",
        window.location.pathname + window.location.search + (rest ? "#" + rest : ""),
      );
      if (!added.trim()) return;
      setInput((v) => (v && !v.endsWith("\n") ? v + "\n" : v) + added.trim() + "\n");
    };
    take();
    window.addEventListener("hashchange", take);
    return () => window.removeEventListener("hashchange", take);
  }, [ready]);

  // ── Cross-device sync (workspace link) ──────────────────────────────────────────
  const snapshot = useMemo<Snapshot>(
    () => ({ input, settings, off: [...off], forceCD, parts, sortMode, downloadPlan }),
    [input, settings, off, forceCD, parts, sortMode, downloadPlan],
  );
  const sync = useSync(snapshot, ready, (s) => {
    setInput(s.input);
    setSettings(s.settings);
    setOff(new Set(s.off));
    setForceCD(s.forceCD);
    setParts(s.parts);
    setSortMode(s.sortMode);
    setDownloadPlan(s.downloadPlan ?? EMPTY_PLAN);
  });

  const keys = useMemo(() => splitKeys(groupKeys), [groupKeys]);
  const parsed = useMemo(() => parseLinks(input).map((f) => withBestName(f, input)), [input]);

  // Links assigned to a batch (Pick links → Batch…). They skip auto grouping, and
  // links in a named batch are downloaded in parallel.
  const held = useMemo(
    () =>
      new Set(
        Object.entries(downloadPlan.assignments)
          .filter(([, a]) => !!(a as { batch?: string } | undefined)?.batch)
          .map(([u]) => u),
      ),
    [downloadPlan],
  );
  const parallelBatch = useMemo(
    () =>
      new Set(
        Object.entries(downloadPlan.assignments)
          .filter(([, a]) => {
            const b = (a as { batch?: string } | undefined)?.batch;
            return !!b && b !== "separate";
          })
          .map(([u]) => u),
      ),
    [downloadPlan],
  );

  const { items, dupes, episodeDupes } = useMemo(() => {
    // Per-link dedupe: links with dedupe off are always kept.
    const dedupeOn = (f: Item) => overrides[f.url]?.dedupe ?? settings.dedupe;
    const keptIds = new Set(dedupeItems(parsed.filter(dedupeOn)).kept.map((f) => f.id));
    const byNameRaw = parsed.filter((f) => !dedupeOn(f) || keptIds.has(f.id));
    // Exact-URL dedupe (separate from name dedupe on purpose).
    const byName = filters.dedupeUrls ? dedupeExactUrls(byNameRaw) : byNameRaw;
    // Episode dedupe: one release per show + season + episode (global switch).
    const eps = filters.dedupeEps
      ? dedupeEpisodes(byName, {
          mode: filters.dedupeMode,
          priorityWords: wordsOf(filters.priority),
          ignoreWords: wordsOf(filters.dedupeIgnore),
        })
      : { kept: byName, dupes: 0 };
    const deduped = eps.kept;
    // Force content-disposition: treat every link as "clean" so -O is never used.
    // Done here (not later) so groups and "By group" mode see it too.
    // A per-link override wins over the global switch.
    const forced = deduped.map((f) =>
      (overrides[f.url]?.forceCD ?? forceCD) ? { ...f, hasQuery: false } : f,
    );
    // Per-link sort: sort only the links set to "episode", put them back in the slots they held.
    const slots = forced
      .map((f, i) => ((overrides[f.url]?.sortMode ?? sortMode) === "episode" ? i : -1))
      .filter((i) => i >= 0);
    let sorted = forced;
    if (slots.length) {
      const ep = sortByEpisode(slots.map((i) => forced[i]!));
      sorted = [...forced];
      slots.forEach((pos, j) => (sorted[pos] = ep[j]!));
    }
    // Keyword grouping reorders so each keyword's links sit together (stable
    // inside each bucket), which keeps the output cells in the same order.
    let kept = sorted;
    if (keys.length || autoGroup) {
      kept = bucketByKeywords(sorted, keys).flatMap((b) => {
        if (!autoGroup || (keys.length && keys.includes(b.label))) return b.items;
        const a = autoBucket(b.items.filter((f) => !held.has(f.url)));
        return [
          ...a.groups.flatMap((g) => g.items),
          ...a.ungrouped,
          ...b.items.filter((f) => held.has(f.url)),
        ];
      });
    }
    return {
      items: kept,
      dupes: parsed.length - byName.length,
      episodeDupes: eps.dupes,
    };
  }, [parsed, settings.dedupe, filters, forceCD, overrides, sortMode, keys, autoGroup, held]);
  const { groups, kwGroups, restGroups } = useMemo(
    () => makeGroups(items, keys, autoGroup, held),
    [items, keys, autoGroup, held],
  );

  const matches = useMemo(() => buildMatcher(search, filters), [search, filters]);
  const shown = useMemo(
    () =>
      hideEdge(
        items.filter((f) => matches(f)),
        filters.hide,
        filters.hidePos,
      ),
    [items, matches, filters.hide, filters.hidePos],
  );
  const shownIds = useMemo(() => new Set(shown.map((f) => f.id)), [shown]);
  const view = useMemo(() => shown.filter((f) => !off.has(f.url)), [shown, off]);

  // Split the selected links evenly, in order, into `parts` commands (50 / 2 = 25 + 25).
  // Keyword groups are built on their own with movie / loose-series special
  // handling and "one by one" turned off, so each keyword is always exactly
  // one cell (or `parts` cells when splitting) — movies and series included.
  //
  // Links with their own settings (overrides / kindOverrides) are bucketed by
  // their effective settings and built separately; the buckets using the global
  // settings come first, then each custom bucket in order of first appearance.
  const { cells, cellMeta } = useMemo(() => {
    const globalKeys = keys.join(" ") + (autoGroup ? AUTO : "");
    const buildFor = (vw: typeof view, st: Settings, prt: number, ks: string): Cell[] => {
      if (!vw.length) return [];
      const g =
        ks === globalKeys
          ? { groups, kwGroups, restGroups }
          : makeGroups(items, splitKeys(ks.replace(AUTO, "")), ks.endsWith(AUTO), held);
      // Named-batch links are built apart, with parallel wget forced on.
      const buildRest = (v: typeof vw, grs: typeof g.groups): Cell[] => {
        if (!v.length) return [];
        const par = v.filter((f) => parallelBatch.has(f.url));
        const seq = v.filter((f) => !parallelBatch.has(f.url));
        return [
          ...(seq.length ? buildPlannedCells(seq, grs, st, prt, downloadPlan) : []),
          ...(par.length
            ? buildPlannedCells(par, grs, { ...st, parallel: true }, prt, downloadPlan)
            : []),
        ];
      };
      if (!g.kwGroups.length) return buildRest(vw, g.groups);
      const forced: Settings = {
        ...st,
        mode: "group",
        moviesAlone: false,
        looseSeriesPlain: false,
      };
      const inView = new Set(vw.map((f) => f.url));
      const claimed = new Set(g.kwGroups.flatMap((x) => x.members.map((f) => f.url)));
      const out: Cell[] = [];
      for (const kg of g.kwGroups) {
        const members = kg.members.filter((f) => inView.has(f.url));
        if (!members.length) continue;
        out.push(...buildPlannedCells(members, [{ ...kg, members }], forced, prt, downloadPlan));
      }
      const restView = vw.filter((f) => !claimed.has(f.url));
      out.push(...buildRest(restView, g.restGroups));
      return out;
    };

    // Effective settings for one link. forceCD, dedupe and sortMode are applied
    // earlier (items memo), so they are left out of the bucket key.
    const effFor = (url: string) => {
      const {
        forceCD: _cd,
        dedupe: _dd,
        sortMode: _sm,
        parts: p,
        groupKeys: gk,
        autoGroup: ag,
        autoCopy: ac,
        autoDelay: ad,
        ...rest
      } = overrides[url] ?? {};
      const k = kindOverrides[url];
      const auto = ac ?? autoCopy;
      return {
        st: { ...settings, ...rest, ...(k ? { kind: k } : {}) } as Settings,
        parts: p ?? parts,
        ks: splitKeys(gk ?? groupKeys).join(" ") + ((ag ?? autoGroup) ? AUTO : ""),
        auto,
        delay: auto ? (ad ?? autoDelay) : 0,
      };
    };
    type B = ReturnType<typeof effFor> & { vw: typeof view };
    const buckets = new Map<string, B>();
    const base = effFor("");
    buckets.set(JSON.stringify(base), { ...base, vw: [] }); // global bucket first
    for (const f of view) {
      const e = effFor(f.url);
      const key = JSON.stringify(e);
      if (!buckets.has(key)) buckets.set(key, { ...e, vw: [] });
      buckets.get(key)!.vw.push(f);
    }
    const out: Cell[] = [];
    const meta: { auto: boolean; delay: number }[] = [];
    for (const b of buckets.values()) {
      const c = buildFor(b.vw, b.st, b.parts, b.ks);
      out.push(...c);
      c.forEach(() => meta.push({ auto: b.auto, delay: b.delay }));
    }
    return { cells: out, cellMeta: meta };
  }, [
    view,
    items,
    keys,
    groups,
    kwGroups,
    restGroups,
    settings,
    parts,
    downloadPlan,
    held,
    parallelBatch,
    kindOverrides,
    overrides,
    groupKeys,
    autoGroup,
    autoCopy,
    autoDelay,
  ]);

  // "Copied" marks belong to one exact output; any change to the cells' text resets them.
  const cellsKey = useMemo(() => cells.map((c) => c.text).join("\0"), [cells]);
  const copied = copiedState.key === cellsKey ? copiedState.idx : NO_COPIES;
  const markCopied = (i: number) =>
    setCopiedState((s) => ({
      key: cellsKey,
      idx: new Set(s.key === cellsKey ? s.idx : []).add(i),
    }));

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));
  const toggleOff = (urls: string[], turnOff: boolean) =>
    setOff((o) => {
      const n = new Set(o);
      urls.forEach((u) => (turnOff ? n.add(u) : n.delete(u)));
      return n;
    });

  // Apply a batch / folder choice to every currently selected link ("__clear" resets it).
  const assignSelected = (field: "batch" | "folder", value: string) => {
    if (!value) return;
    const urls = view.map((f) => f.url);
    setDownloadPlan((p) => {
      const assignments = { ...p.assignments };
      for (const u of urls) {
        assignments[u] = {
          ...assignments[u],
          [field]: value === "__clear" ? undefined : value,
        };
      }
      return { ...p, assignments };
    });
    toast.success(
      `${value === "__clear" ? "Cleared" : "Set"} ${field} for ${urls.length} link${urls.length === 1 ? "" : "s"}`,
    );
  };
  // Set a command type for every selected link ("auto" removes the override).
  const assignKind = (value: string) => {
    if (!value) return;
    const urls = view.map((f) => f.url);
    setKindOverrides((o) => {
      const n = { ...o };
      for (const u of urls) {
        if (value === "auto") delete n[u];
        else n[u] = value as ForceKind;
      }
      return n;
    });
    toast.success(
      `${value === "auto" ? "Cleared" : "Set"} command type for ${urls.length} link${urls.length === 1 ? "" : "s"}`,
    );
  };

  // ── Scoped settings: edit all links, or only the selected ones ───────────────
  const selUrls = useMemo(() => view.map((f) => f.url), [view]);
  const scoped = scope === "selected";
  const globalVal = (k: OvKey): any => {
    switch (k) {
      case "forceCD":
        return forceCD;
      case "parts":
        return parts;
      case "sortMode":
        return sortMode;
      case "groupKeys":
        return groupKeys;
      case "autoGroup":
        return autoGroup;
      case "autoCopy":
        return autoCopy;
      case "autoDelay":
        return autoDelay;
      default:
        return settings[k];
    }
  };
  // Current value of a setting for the active scope. In "selected" scope it is
  // the value shared by the selected links; `mixed` is true when they differ.
  const val = (k: OvKey) => {
    const base = globalVal(k);
    if (!scoped || !selUrls.length) return { v: base as any, mixed: false };
    const vs = selUrls.map((u) => overrides[u]?.[k] ?? base);
    return { v: vs[0] as any, mixed: vs.some((x) => x !== vs[0]) };
  };
  // Change a setting in the active scope.
  const apply = (k: OvKey, v: any) => {
    if (!scoped) {
      switch (k) {
        case "forceCD":
          setForceCD(!!v);
          break;
        case "parts":
          setParts(v);
          break;
        case "sortMode":
          setSortMode(v);
          break;
        case "groupKeys":
          setGroupKeys(v);
          break;
        case "autoGroup":
          setAutoGroup(!!v);
          break;
        case "autoCopy":
          setAutoCopy(!!v);
          break;
        case "autoDelay":
          setAutoDelay(v);
          break;
        default:
          set(k, v);
      }
      return;
    }
    if (!selUrls.length) {
      toast.error("Select some links first");
      return;
    }
    setOverrides((o) => {
      const n = { ...o };
      for (const u of selUrls) n[u] = { ...n[u], [k]: v };
      return n;
    });
  };
  // Drop every per-link setting (and command type) from the selected links.
  const resetSelected = () => {
    setOverrides((o) => {
      const n = { ...o };
      selUrls.forEach((u) => delete n[u]);
      return n;
    });
    setKindOverrides((o) => {
      const n = { ...o };
      selUrls.forEach((u) => delete n[u]);
      return n;
    });
    toast.success(
      `Reset ${selUrls.length} link${selUrls.length === 1 ? "" : "s"} to the global settings`,
    );
  };
  const customCount = selUrls.filter((u) => overrides[u] || kindOverrides[u]).length;
  const tg = (k: OvKey, label: string, hint: string, needsCmd = true, extraOff = false) => {
    const { v, mixed } = val(k);
    return (
      <Toggle
        label={label}
        hint={mixed ? "Mixed — tap to set all selected" : hint}
        checked={!!v}
        disabled={extraOff || (needsCmd && !val("commands").v)}
        onChange={(x) => apply(k, x)}
      />
    );
  };

  const groupKey = (g: { type: string; label: string }) => g.type + g.label;
  const toggleCollapsed = (k: string) =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  const copy = async (text: string, what: string, silent = false) => {
    try {
      // Command cells are copied exactly as shown (no extra blank line when
      // pasted into Colab). Plain-link output keeps its trailing newline.
      const out =
        settings.commands && settings.kind !== "plain"
          ? text
          : text.endsWith("\n")
            ? text
            : text + "\n";
      await navigator.clipboard.writeText(out);
      toast.success(`Copied ${what}`);
      return true;
    } catch {
      if (!silent) toast.error("Clipboard blocked — select the text and copy manually");
      return false;
    }
  };

  // Auto-copy: once you've copied a cell, coming back to this tab (e.g. after
  // pasting it into Colab) copies the next uncopied cell automatically.
  // Browsers (especially on phones) often refuse clipboard writes that aren't
  // triggered by a tap, so if the immediate attempt fails we keep it "pending"
  // and finish it on the very next tap / touch / scroll / key press anywhere.
  const armed = useRef(false);
  const pending = useRef(false);
  const busy = useRef(false);
  const autoRef = useRef<() => Promise<void>>(async () => {});

  const copyCell = async (i: number, silent = false) => {
    const c = cells[i];
    if (!c) return false;
    if (await copy(c.text, c.label, silent)) {
      markCopied(i);
      armed.current = true;
      return true;
    }
    return false;
  };
  const blanks = useMemo(() => blankCells(settings.workers), [settings.workers]);
  const [copiedB, setCopiedB] = useState<Set<number>>(new Set());
  const copyBlank = async (i: number) => {
    const b = blanks[i];
    if (b && (await copy(b.text, b.label))) setCopiedB((c) => new Set(c).add(i));
  };
  const nextIdx = cells.findIndex((_, i) => !copied.has(i));
  const queryCount = items.filter((f) => f.hasQuery).length;

  autoRef.current = async () => {
    const m = cellMeta[nextIdx];
    if (nextIdx < 0 || !m?.auto || !armed.current || busy.current) {
      if (nextIdx < 0 || !m?.auto) pending.current = false;
      return;
    }
    busy.current = true;
    try {
      // silent: a refused attempt just stays pending until the next tap
      pending.current = !(await copyCell(nextIdx, true));
    } finally {
      busy.current = false;
    }
  };
  useEffect(() => {
    // Coming back to the tab: try right away, and again shortly after in case
    // the document hadn't regained focus yet.
    const back = () => {
      if (document.visibilityState !== "visible") return;
      pending.current = true;
      void autoRef.current();
      setTimeout(() => pending.current && void autoRef.current(), 400);
    };
    // Any interaction finishes a pending copy (counts as a user gesture).
    const gesture = () => {
      if (pending.current) void autoRef.current();
    };
    window.addEventListener("focus", back);
    window.addEventListener("pageshow", back);
    document.addEventListener("visibilitychange", back);
    const evs = ["pointerdown", "touchstart", "keydown", "scroll"] as const;
    evs.forEach((e) => window.addEventListener(e, gesture, { passive: true, capture: true }));
    return () => {
      window.removeEventListener("focus", back);
      window.removeEventListener("pageshow", back);
      document.removeEventListener("visibilitychange", back);
      evs.forEach((e) => window.removeEventListener(e, gesture, { capture: true }));
    };
  }, []);
  // Timed run: after each copy, wait the cell's delay and copy the next cell,
  // one after another until all are done. Pauses while the tab is hidden (the
  // browser blocks clipboard access then) and resumes when you come back.
  useEffect(() => {
    const m = cellMeta[nextIdx];
    if (!m?.auto || !armed.current || nextIdx < 0) return;
    if (document.visibilityState !== "visible") return;
    const t = setTimeout(() => {
      pending.current = true;
      void autoRef.current();
    }, m.delay * 1000);
    return () => clearTimeout(t);
  }, [cellMeta, nextIdx, cellsKey, copiedState]);
  // New output → don't auto-copy until the person copies something again.
  useEffect(() => {
    armed.current = false;
    pending.current = false;
  }, [cellsKey]);

  return (
    <div className="lp-bg relative min-h-dvh overflow-x-hidden text-foreground">
      <Stickers />

      {/* Top Bar Contract: 3 zones, gap-8 */}
      <header className="sticky top-0 z-40 w-full border-b border-purple-200/70 bg-white/85 px-4 py-3 backdrop-blur-md shadow-2xs">
        <div className="mx-auto flex max-w-content items-center justify-between gap-8">
          {/* Zone 1: Single text wordmark */}
          <a
            href="/"
            className="flex items-center gap-1.5 font-display text-2xl font-bold tracking-tight text-purple-950 whitespace-nowrap shrink-0"
          >
            <span className="bg-gradient-to-r from-fuchsia-600 via-purple-600 to-violet-700 bg-clip-text text-transparent">
              LinkPop
            </span>
            <span className="sticker text-xl" style={{ transform: "rotate(10deg)" }}>
              💜
            </span>
          </a>

          {/* Zone 2: Concise navigation links */}
          <nav className="hidden md:flex items-center gap-6 text-sm font-bold text-purple-950/75">
            <a
              href="#step-paste"
              className="hover:text-purple-600 transition-colors whitespace-nowrap shrink-0"
            >
              Paste Links
            </a>
            <a
              href="#step-options"
              className="hover:text-purple-600 transition-colors whitespace-nowrap shrink-0"
            >
              Download Options
            </a>
            <a
              href="#step-pick"
              className="hover:text-purple-600 transition-colors whitespace-nowrap shrink-0"
            >
              Filter ({items.length})
            </a>
            <a
              href="#step-commands"
              className="hover:text-purple-600 transition-colors whitespace-nowrap shrink-0"
            >
              Colab Cells ({cells.length})
            </a>
          </nav>

          {/* Zone 3: 1 primary action */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={() => {
                setInput(SAMPLE);
                setOff(new Set());
              }}
              className="lp-btn-pri flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-bold whitespace-nowrap shrink-0"
            >
              <Wand2 className="size-3.5" />
              <span>Try sample</span>
            </button>
            {input && (
              <button
                onClick={() => {
                  setInput("");
                  setOff(new Set());
                }}
                title="Clear links"
                className="rounded-full border border-purple-200 bg-white/90 p-1.5 text-muted-foreground hover:bg-rose-50 hover:text-destructive transition-colors shrink-0"
              >
                <Trash2 className="size-3.5" />
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <div className="relative mx-auto max-w-content px-4 pt-8 pb-5">
        <div className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-2 text-xs font-bold">
            <span className="sticker-badge badge-candy-berry px-3.5 py-1">🎬 Movies isolated</span>
            <span className="sticker-badge badge-candy-violet px-3.5 py-1">⚡ Parallel xargs</span>
            <span className="sticker-badge badge-candy-sun px-3.5 py-1">🗜️ Auto unpack</span>
            <span className="sticker-badge badge-candy-mint px-3.5 py-1">
              ✨ Content-Disposition
            </span>
            <span className="sticker-badge badge-candy-peach px-3.5 py-1">🧁 100% in-browser</span>
          </div>

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="max-w-2xl">
              <h1 className="font-display text-4xl sm:text-5xl font-black tracking-tight text-foreground">
                Turn messy links into <span className="text-rainbow">Colab cells</span>
                <span
                  className="sticker ml-2 text-3xl align-middle"
                  style={{ transform: "rotate(12deg)" }}
                >
                  ✨
                </span>
              </h1>
              <p className="mt-1.5 text-sm sm:text-base font-medium text-muted-foreground">
                Paste download links — even glued together with no spaces. Get clean, organized,
                ready-to-run Colab cells with wget and smart episode grouping.
              </p>
            </div>

            <div className="hidden sm:flex items-center gap-3">
              <button
                disabled={nextIdx < 0}
                onClick={() => copyCell(nextIdx)}
                className="lp-btn-pri flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-black shadow-md disabled:opacity-40"
              >
                <Sparkles className="size-4 animate-spin-slow" />
                {nextIdx < 0 ? "All copied ✨" : `Copy next cell (${nextIdx + 1}/${cells.length})`}
              </button>
            </div>
          </div>
        </div>
      </div>

      <main className="relative mx-auto grid max-w-content grid-cols-[minmax(0,1fr)] gap-6 px-4 pb-28 lg:pb-16 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        {/* ---------- left: input + options + links ---------- */}
        <div className="flex min-w-0 flex-col gap-6">
          <section id="step-paste" className="lp-card card-theme-berry p-5 sm:p-6">
            <Corner emoji="🔮" washi="pink" />
            <StepHeader
              n="1"
              title="Paste links"
              subtitle="Paste one or more URLs — spaces and newlines are optional"
              variant="berry"
            >
              <div className="flex items-center gap-1.5">
                <button
                  className="sticker-badge bg-white px-3 py-1 text-xs font-bold text-foreground hover:bg-pink-50 hover:text-pink-600 transition-colors"
                  onClick={() => {
                    setInput(SAMPLE);
                    setOff(new Set());
                    toast.success("Loaded sample links! 🔮");
                  }}
                >
                  <Wand2 className="mr-1 inline size-3.5 text-pink-600" />
                  Try sample
                </button>
                <button
                  className="sticker-badge bg-white px-3 py-1 text-xs font-bold text-muted-foreground hover:text-destructive hover:bg-rose-50 disabled:opacity-40 transition-colors"
                  disabled={!input}
                  onClick={() => {
                    setInput("");
                    setOff(new Set());
                    toast("Links cleared 🫧");
                  }}
                >
                  <Trash2 className="mr-1 inline size-3.5" />
                  Clear
                </button>
              </div>
            </StepHeader>

            <div className="relative">
              <textarea
                ref={taRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                aria-label="Download links"
                spellCheck={false}
                placeholder={
                  "https://…/Movie.2024.mkvhttps://…/Show.S01E01.mkv?token=…\n\nOptional: put a file name on the line above a link."
                }
                className="lp-code lp-scroll bg-notebook-dots h-48 w-full resize-y rounded-2xl border-2 border-pink-200/90 bg-white/95 p-3.5 text-base leading-relaxed sm:text-[13px] outline-none placeholder:text-pink-300 focus:border-pink-500 focus:ring-4 focus:ring-pink-500/20 shadow-inner font-mono text-purple-950 font-medium"
              />
              <div className="absolute right-2.5 bottom-3 flex flex-col gap-1.5">
                <button
                  type="button"
                  aria-label="Go to start of links"
                  onClick={() => jump(false)}
                  className="rounded-full border border-pink-200 bg-white p-2 shadow-xs hover:bg-pink-50 hover:scale-105 active:scale-95 transition-all"
                >
                  <ArrowUpToLine className="size-4 text-pink-700" />
                </button>
                <button
                  type="button"
                  aria-label="Go to end to keep pasting"
                  onClick={() => jump(true)}
                  className="lp-btn-pri rounded-full p-2 shadow-xs"
                >
                  <ArrowDownToLine className="size-4" />
                </button>
              </div>
            </div>

            <div className="mt-3.5 flex flex-wrap gap-2 text-xs">
              <Stat n={items.length} label="total links" emoji="🔗" variant="default" />
              <Stat n={queryCount} label="with ?query → -O name" emoji="⚡" variant="query" />
              <Stat
                n={items.length - queryCount}
                label="clean → content-disposition"
                emoji="✨"
                variant="clean"
              />
              {dupes > 0 && <Stat n={dupes} label="dupes skipped" emoji="🫧" variant="warning" />}
              {episodeDupes > 0 && (
                <Stat
                  n={episodeDupes}
                  label="duplicate episodes skipped"
                  emoji="📺"
                  variant="warning"
                />
              )}
            </div>

            <div className="mt-3.5 flex flex-col gap-2">
              <ResolveNamesButton input={input} urls={view.map((f) => f.url)} onChange={setInput} />
              <SavedLinks
                input={input}
                linkCount={items.length}
                onLoad={(c) => {
                  setInput(c);
                  setOff(new Set());
                }}
              />
            </div>
          </section>

          <section id="step-options" className="lp-card card-theme-peach p-5 sm:p-6">
            <Corner emoji="🎀" washi="peach" />
            <StepHeader
              n="2"
              title="Options"
              subtitle="Fine-tune grouping, parallel downloads, and command flags"
              variant="peach"
            />

            {/* Scope: change settings for every link, or only the ticked ones */}
            <div className="mb-4 rounded-2xl border border-border bg-purple-50/70 p-2.5">
              <div className="grid w-full grid-cols-2 overflow-hidden rounded-full border-[1.5px] border-border bg-white">
                {(["all", "selected"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScope(s)}
                    className={cn(
                      "px-3 py-2 text-sm font-semibold transition-colors not-first:border-l border-border sm:py-1.5",
                      scope === s ? "lp-btn-pri" : "hover:bg-purple-50",
                    )}
                  >
                    {s === "all" ? "All links" : `Selected only (${view.length})`}
                  </button>
                ))}
              </div>
              {scoped && (
                <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                  <span className="min-w-0">
                    Changes below apply only to the {view.length} ticked link
                    {view.length === 1 ? "" : "s"}.
                    {customCount > 0 && ` ${customCount} already customized.`}
                  </span>
                  <button
                    type="button"
                    disabled={!customCount}
                    onClick={resetSelected}
                    className="rounded-full border border-border bg-white px-3 py-1 font-semibold text-foreground hover:bg-purple-50 disabled:opacity-40"
                  >
                    Reset selected
                  </button>
                </div>
              )}
            </div>

            <DownloadDestinations
              plan={downloadPlan}
              onChange={setDownloadPlan}
              urls={view.map((f) => f.url)}
            />
            <div className="mb-4">
              <div className="mb-1.5 text-xs font-extrabold tracking-widest text-muted-foreground uppercase">
                Output cells
                {scoped && val("mode").mixed && (
                  <span className="ml-2 font-semibold normal-case tracking-normal">(mixed)</span>
                )}
              </div>
              <div className="grid w-full grid-cols-3 overflow-hidden rounded-full border-[1.5px] border-border bg-white sm:inline-grid sm:w-auto">
                {MODES.map(([k, label, tip]) => (
                  <button
                    key={k}
                    title={tip}
                    onClick={() => apply("mode", k)}
                    className={cn(
                      "px-2 py-2 text-sm font-semibold transition-colors not-first:border-l border-border sm:px-4 sm:py-1.5",
                      !val("mode").mixed && val("mode").v === k
                        ? "lp-btn-pri"
                        : "hover:bg-purple-50",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <label
                htmlFor="cmd-kind"
                className="mb-1.5 block text-xs font-extrabold tracking-widest text-muted-foreground uppercase"
              >
                Command type
              </label>
              <select
                id="cmd-kind"
                value={scoped ? "" : settings.kind}
                disabled={!val("commands").v}
                onChange={(e) =>
                  scoped ? assignKind(e.target.value) : set("kind", e.target.value as ForceKind)
                }
                className="w-full rounded-full border-[1.5px] border-border bg-white px-4 py-2 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 disabled:opacity-45 sm:w-auto sm:min-w-64 sm:text-sm"
              >
                {scoped && <option value="">Pick type for selected…</option>}
                {KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {scoped && k === "auto" ? "Auto (use global)" : label}
                  </option>
                ))}
              </select>
            </div>
            <div className="mb-4">
              <div className="mb-1.5 text-xs font-extrabold tracking-widest text-muted-foreground uppercase">
                Sort links
                {scoped && val("sortMode").mixed && (
                  <span className="ml-2 font-semibold normal-case tracking-normal">(mixed)</span>
                )}
              </div>
              <div className="grid w-full grid-cols-2 overflow-hidden rounded-full border-[1.5px] border-border bg-white sm:inline-grid sm:w-auto">
                {SORTS.map(([k, label, tip]) => (
                  <button
                    key={k}
                    title={tip}
                    onClick={() => apply("sortMode", k)}
                    className={cn(
                      "px-2 py-2 text-sm font-semibold transition-colors not-first:border-l border-border sm:px-4 sm:py-1.5",
                      !val("sortMode").mixed && val("sortMode").v === k
                        ? "lp-btn-pri"
                        : "hover:bg-purple-50",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mb-4">
              <label
                htmlFor="group-keys"
                className="mb-1.5 block text-xs font-extrabold tracking-widest text-muted-foreground uppercase"
              >
                Group by keyword
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <div className="relative min-w-0 flex-1">
                  <input
                    id="group-keys"
                    value={val("groupKeys").mixed ? "" : (val("groupKeys").v ?? "")}
                    onChange={(e) => apply("groupKeys", e.target.value)}
                    spellCheck={false}
                    placeholder={
                      val("groupKeys").mixed
                        ? "Mixed — type to set all selected"
                        : "e.g. severance dune  (space = several groups)"
                    }
                    className="w-full rounded-full border-[1.5px] border-border bg-white px-4 py-2 pr-9 text-base outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 sm:text-sm"
                  />
                  {!val("groupKeys").mixed && val("groupKeys").v && (
                    <button
                      aria-label="Clear keywords"
                      className="absolute top-1/2 right-3 -translate-y-1/2"
                      onClick={() => apply("groupKeys", "")}
                    >
                      <X className="size-4 text-purple-400" />
                    </button>
                  )}
                </div>
                <button
                  type="button"
                  aria-pressed={!!val("autoGroup").v && !val("autoGroup").mixed}
                  title="Movies alone, seasons with 4+ episodes together, same-name zip parts together, the rest ungrouped"
                  onClick={() => {
                    const { v, mixed } = val("autoGroup");
                    apply("autoGroup", mixed ? true : !v);
                  }}
                  className={cn(
                    "flex items-center justify-center gap-1.5 rounded-full border-[1.5px] px-4 py-2 text-sm font-semibold whitespace-nowrap transition-colors",
                    val("autoGroup").v && !val("autoGroup").mixed
                      ? "lp-btn-pri border-transparent"
                      : "border-border bg-white hover:bg-purple-50",
                  )}
                >
                  <Wand2 className="size-3.5" />
                  {val("autoGroup").mixed
                    ? "Auto group: mixed"
                    : val("autoGroup").v
                      ? "Auto group: on"
                      : "Auto group"}
                </button>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {val("autoGroup").v && !val("autoGroup").mixed
                  ? "Keyword groups come first. Auto group then handles the rest: each movie alone, seasons with 4+ episodes together, same-name archives / split parts (.001, .002, part1…) together."
                  : "Matches the file name or URL. Each link goes in the first keyword it matches; the rest land in “Other”."}
              </p>
            </div>
            <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {tg("commands", "Commands", "Wrap links in wget / extract cells", false)}
              {tg(
                "autoCopy",
                "Auto-copy cells",
                "Copies each cell in turn after the first one",
                false,
              )}
              <label
                className={cn(
                  "flex items-center justify-between gap-3",
                  !val("autoCopy").v && "opacity-45",
                )}
              >
                <span className="min-w-0">
                  <span className="block font-bold">Auto-copy delay</span>
                  <span className="block text-xs text-muted-foreground">
                    {val("autoDelay").mixed ? "Mixed — set all selected" : "Seconds between cells"}
                  </span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={600}
                  disabled={!val("autoCopy").v}
                  value={val("autoDelay").v}
                  onChange={(e) =>
                    apply(
                      "autoDelay",
                      Math.max(1, Math.min(600, parseInt(e.target.value, 10) || 1)),
                    )
                  }
                  className="w-16 shrink-0 rounded-full border-[1.5px] border-border bg-white px-3 py-1 text-center text-base outline-none sm:text-sm focus:border-primary"
                />
              </label>
              {tg("moviesAlone", "Movies alone", "Each movie gets its own wget cell")}
              {tg("parallel", "Parallel wget", "Other files download together via xargs")}
              {tg("looseSeriesPlain", "Loose series plain", "Stray episodes stay as bare links")}
              {tg("comments", "# Comments", "File names on top of each command")}
              {tg("names", "Names", "Number + name above plain links", false)}
              {tg("dedupe", "Dedupe", "Skip repeated file names", false)}
              {tg("forceName", "Force filename", "Always save as the detected name (wget -O)")}
              {tg(
                "forceCD",
                "Force content-disposition",
                "Ignore ?query and never use -O",
                true,
                !!val("forceName").v,
              )}
              <label className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-bold">Workers</span>
                  <span className="block text-xs text-muted-foreground">
                    {val("workers").mixed ? "Mixed — set all selected" : "Concurrent downloads"}
                  </span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={64}
                  value={val("workers").v}
                  onChange={(e) =>
                    apply("workers", Math.max(1, Math.min(64, parseInt(e.target.value, 10) || 1)))
                  }
                  className="w-16 shrink-0 rounded-full border-[1.5px] border-border bg-white px-3 py-1 text-center text-base outline-none sm:text-sm focus:border-primary"
                />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block font-bold">Split into</span>
                  <span className="block text-xs text-muted-foreground">
                    {val("parts").mixed
                      ? "Mixed — set all selected"
                      : "Number of parts (1 = no split)"}
                  </span>
                </span>
                <input
                  type="number"
                  min={1}
                  max={999}
                  value={val("parts").v}
                  onChange={(e) => apply("parts", Math.max(1, parseInt(e.target.value, 10) || 1))}
                  className="w-16 shrink-0 rounded-full border-[1.5px] border-border bg-white px-3 py-1 text-center text-base outline-none sm:text-sm focus:border-primary"
                />
              </label>
            </div>
          </section>

          <section id="step-pick" className="lp-card card-theme-violet p-5 sm:p-6">
            <Corner emoji="🍇" washi="violet" />
            <StepHeader
              n="3"
              title="Pick links"
              subtitle="Filter and select links to include in the generated commands"
              variant="violet"
            >
              <div className="flex flex-wrap gap-1.5 text-xs">
                <button
                  className="sticker-badge bg-white px-3 py-1 font-bold text-foreground hover:bg-purple-50"
                  onClick={() =>
                    toggleOff(
                      shown.map((f) => f.url),
                      false,
                    )
                  }
                >
                  All
                </button>
                <button
                  className="sticker-badge bg-white px-3 py-1 font-bold text-foreground hover:bg-purple-50"
                  onClick={() =>
                    toggleOff(
                      shown.map((f) => f.url),
                      true,
                    )
                  }
                >
                  None
                </button>
                <button
                  className="sticker-badge bg-white px-3 py-1 font-bold text-foreground hover:bg-purple-50 disabled:opacity-40"
                  disabled={!groups.length}
                  onClick={() => setCollapsed(new Set(groups.map(groupKey)))}
                >
                  Collapse
                </button>
                <button
                  className="sticker-badge bg-white px-3 py-1 font-bold text-foreground hover:bg-purple-50 disabled:opacity-40"
                  disabled={!collapsed.size}
                  onClick={() => setCollapsed(new Set())}
                >
                  Expand
                </button>
              </div>
            </StepHeader>
            <div className="relative mb-3">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-purple-400" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                aria-label="Search links"
                placeholder="Search name or URL… (space = AND, comma = OR)"
                className="w-full rounded-full border-[1.5px] border-border bg-white py-2 pr-9 pl-9 text-base outline-none sm:text-sm focus:border-primary focus:ring-4 focus:ring-primary/15"
              />
              {search && (
                <button
                  aria-label="Clear search"
                  className="absolute top-1/2 right-3 -translate-y-1/2"
                  onClick={() => setSearch("")}
                >
                  <X className="size-4 text-purple-400" />
                </button>
              )}
            </div>
            <FilterPanel value={filters} onChange={setFilters} episodeDupes={episodeDupes} />
            <div className="lp-scroll max-h-[420px] overflow-auto rounded-2xl border border-border bg-white/80 p-1.5">
              {!items.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">
                  <span className="sticker mb-2 block text-3xl">🫧</span>
                  No links yet — paste some above.
                </p>
              ) : !shown.length ? (
                <p className="p-6 text-center text-sm text-muted-foreground">No matches</p>
              ) : (
                groups.map((g) => {
                  const ms = g.members.filter((f) => shownIds.has(f.id));
                  if (!ms.length) return null;
                  const gk = groupKey(g);
                  // An active search always shows its matches, even in collapsed groups.
                  const open = !!search.trim() || !collapsed.has(gk);
                  const on = ms.filter((f) => !off.has(f.url)).length;
                  return (
                    <div key={gk} className="mb-1">
                      <div className="flex items-center gap-1 rounded-xl bg-gradient-to-r from-purple-100 to-fuchsia-100 pr-3 text-sm font-bold">
                        <button
                          type="button"
                          aria-label={`${open ? "Collapse" : "Expand"} ${g.label}`}
                          aria-expanded={open}
                          className="rounded-l-xl p-1.5 pl-2 hover:bg-purple-200/60"
                          onClick={() => toggleCollapsed(gk)}
                        >
                          {open ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 py-1.5">
                          <input
                            type="checkbox"
                            className="accent-purple-600"
                            checked={on === ms.length}
                            ref={(el) => {
                              if (el) el.indeterminate = on > 0 && on < ms.length;
                            }}
                            onChange={(e) =>
                              toggleOff(
                                ms.map((f) => f.url),
                                !e.target.checked,
                              )
                            }
                          />
                          <span
                            className={cn(
                              "rounded-full border px-1.5 text-[10px]",
                              KIND_STYLE[g.type],
                            )}
                          >
                            {TAG[g.type]}
                          </span>
                          <span className="flex-1 truncate">{g.label}</span>
                          <span className="text-xs text-muted-foreground">
                            {on === ms.length ? ms.length : `${on}/${ms.length}`}
                          </span>
                        </label>
                      </div>
                      {open &&
                        ms.map((f) => (
                          <div key={f.id}>
                            <div
                              title={f.url}
                              className="flex cursor-pointer items-start gap-2 rounded-lg px-3 py-1.5 pl-6 text-[13px] hover:bg-purple-50"
                            >
                              <input
                                type="checkbox"
                                aria-label={`Include ${f.name}`}
                                className="mt-0.5 accent-purple-600"
                                checked={!off.has(f.url)}
                                onChange={(e) => toggleOff([f.url], !e.target.checked)}
                              />
                              <span
                                className={cn(
                                  "min-w-0 flex-1 break-all",
                                  off.has(f.url) && "opacity-45",
                                )}
                              >
                                {f.name}
                                {f.failed && (
                                  <span className="ml-1 text-xs font-bold text-rose-600">
                                    · failed
                                  </span>
                                )}
                                {(() => {
                                  const tags = [
                                    ...overrideTags(overrides[f.url], kindOverrides[f.url]),
                                    downloadPlan.assignments[f.url]?.batch &&
                                      `batch ${downloadPlan.assignments[f.url]?.batch}`,
                                    downloadPlan.assignments[f.url]?.folder &&
                                      `folder ${downloadPlan.assignments[f.url]?.folder}`,
                                  ].filter(Boolean);
                                  return tags.length ? (
                                    <span className="mt-0.5 block text-[11px] font-semibold text-purple-600">
                                      {tags.join(" · ")}
                                    </span>
                                  ) : null;
                                })()}
                              </span>
                              <span
                                className={cn(
                                  "shrink-0 rounded-full px-1.5 text-[10px] font-bold",
                                  f.hasQuery
                                    ? "bg-amber-100 text-amber-700"
                                    : "bg-emerald-100 text-emerald-700",
                                )}
                                title={
                                  f.hasQuery
                                    ? "Has query parameters — saved with -O and the real file name"
                                    : "No query parameters — uses --content-disposition"
                                }
                              >
                                {f.hasQuery ? "?query" : "clean"}
                              </span>
                            </div>
                          </div>
                        ))}
                    </div>
                  );
                })
              )}
            </div>
            {/* Assign batch / folder to every selected link at once */}
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-border bg-purple-50/70 p-2.5">
              <span className="text-xs font-bold text-muted-foreground">
                {view.length} selected
              </span>
              <select
                aria-label="Set download mode for selected links"
                value=""
                disabled={!view.length}
                onChange={(e) => assignSelected("batch", e.target.value)}
                className="min-w-0 flex-1 rounded-full border-[1.5px] border-border bg-white px-3 py-1.5 text-base outline-none disabled:opacity-45 sm:text-xs"
              >
                <option value="">Batch…</option>
                <option value="__clear">Automatic</option>
                <option value="separate">Separate (one by one)</option>
                {downloadPlan.batches.map((b) => (
                  <option key={b} value={b}>
                    {b} (parallel)
                  </option>
                ))}
              </select>
              <select
                aria-label="Set command type for selected links"
                value=""
                disabled={!view.length || !settings.commands}
                onChange={(e) => assignKind(e.target.value)}
                className="min-w-0 flex-1 rounded-full border-[1.5px] border-border bg-white px-3 py-1.5 text-base outline-none disabled:opacity-45 sm:text-xs"
              >
                <option value="">Command…</option>
                {KINDS.map(([k, label]) => (
                  <option key={k} value={k}>
                    {k === "auto" ? "Auto (use global)" : label}
                  </option>
                ))}
              </select>
              <select
                aria-label="Set folder for selected links"
                value=""
                disabled={!view.length}
                onChange={(e) => assignSelected("folder", e.target.value)}
                className="min-w-0 flex-1 rounded-full border-[1.5px] border-border bg-white px-3 py-1.5 text-base outline-none disabled:opacity-45 sm:text-xs"
              >
                <option value="">Folder…</option>
                <option value="__clear">Default folder</option>
                {downloadPlan.folders.map((folder) => (
                  <option key={folder} value={folder}>
                    {folder}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!view.length}
                onClick={() => {
                  setScope("selected");
                  document
                    .getElementById("cmd-kind")
                    ?.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
                className="rounded-full border-[1.5px] border-border bg-white px-3 py-1.5 text-base font-semibold hover:bg-purple-50 disabled:opacity-45 sm:text-xs"
              >
                More settings…
              </button>
            </div>
          </section>

          <SyncPanel
            code={sync.code}
            status={sync.status}
            onEnable={sync.enable}
            onJoin={sync.join}
            onDisconnect={sync.disconnect}
          />
        </div>

        {/* ---------- right: output ---------- */}
        <section
          id="step-commands"
          className="lp-card card-theme-mint min-w-0 self-start p-5 sm:p-6 lg:sticky lg:top-18"
        >
          <Corner emoji="✨" washi="mint" />
          <StepHeader
            n="4"
            title="Commands"
            subtitle={`${cells.length} ready cell${cells.length === 1 ? "" : "s"} · ${view.length} link${view.length === 1 ? "" : "s"}`}
            variant="mint"
          >
            <div className="flex w-full sm:w-auto items-center gap-1.5">
              <button
                disabled={nextIdx < 0}
                onClick={() => copyCell(nextIdx)}
                className="lp-btn-pri flex-1 sm:flex-none flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-black shadow-xs disabled:opacity-40"
              >
                <Sparkles className="size-3.5" />
                <span>
                  {nextIdx < 0 ? "All copied" : `Copy next (${nextIdx + 1}/${cells.length})`}
                </span>
              </button>
              <button
                disabled={!cells.length}
                onClick={() => copy(cells.map((c) => c.text).join("\n\n"), "everything")}
                className="sticker-badge bg-white px-3 py-1.5 text-xs font-bold text-foreground hover:bg-purple-50 disabled:opacity-40"
              >
                Copy all
              </button>
            </div>
          </StepHeader>

          {cellMeta.some((m) => m.auto) && (
            <div className="mb-3 rounded-xl border border-purple-200/80 bg-purple-50/70 p-2.5 text-xs text-purple-900 flex items-center gap-2">
              <span className="sticker text-base">⏱️</span>
              <span>
                Auto-copy active: cells copy automatically after delay or whenever you refocus this
                tab.
              </span>
            </div>
          )}
          <div className="lp-scroll flex lg:max-h-[calc(100dvh-9rem)] flex-col gap-3 overflow-auto pr-1">
            {!cells.length ? (
              <div className="rounded-2xl border-2 border-dashed border-border p-10 text-center text-muted-foreground">
                <span
                  className="sticker sticker-float mb-3 block text-5xl"
                  style={{ "--r": "-8deg" } as CSSProperties}
                >
                  🦄
                </span>
                Your Colab cells appear here.
              </div>
            ) : (
              cells.map((c, i) => (
                <CellCard
                  key={i}
                  cell={c}
                  n={i + 1}
                  copied={copied.has(i)}
                  onCopy={() => copyCell(i)}
                />
              ))
            )}
          </div>
          <details className="mt-4 min-w-0 rounded-2xl border border-border bg-white/70 p-3">
            <summary className="cursor-pointer py-1 font-semibold">Blank templates</summary>
            <div className="mt-3 flex flex-col gap-3">
              {blanks.map((c, i) => (
                <CellCard
                  key={i}
                  cell={c}
                  n={i + 1}
                  copied={copiedB.has(i)}
                  onCopy={() => copyBlank(i)}
                />
              ))}
            </div>
          </details>
        </section>
      </main>

      <footer className="relative pb-8 text-center text-sm text-muted-foreground">
        <span className="sticker mr-1">🧁</span> Everything runs in your browser — saved batches are
        stored privately for this browser.
      </footer>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-white/95 px-3 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur lg:hidden">
        <button
          disabled={nextIdx < 0}
          onClick={() => copyCell(nextIdx)}
          className="lp-btn-pri w-full rounded-full py-3 font-bold disabled:opacity-40"
        >
          <Sparkles className="mr-1 inline size-4" />
          {nextIdx < 0 ? "All copied" : `Copy next ${nextIdx + 1}/${cells.length}`}
        </button>
      </div>
    </div>
  );
}

function StepHeader({
  n,
  title,
  subtitle,
  variant = "berry",
  children,
}: {
  n: string;
  title: string;
  subtitle?: string;
  variant?: "berry" | "peach" | "violet" | "mint";
  children?: React.ReactNode;
}) {
  const badgeGradient = {
    berry: "from-pink-500 via-rose-500 to-fuchsia-600 shadow-pink-200",
    peach: "from-amber-400 via-orange-500 to-rose-500 shadow-orange-200",
    violet: "from-purple-500 via-violet-600 to-indigo-600 shadow-purple-200",
    mint: "from-emerald-400 via-teal-500 to-cyan-600 shadow-teal-200",
  }[variant];

  const borderLine = {
    berry: "border-pink-200/90",
    peach: "border-amber-200/90",
    violet: "border-violet-200/90",
    mint: "border-teal-200/90",
  }[variant];

  return (
    <div
      className={cn(
        "mb-4 flex flex-wrap items-center justify-between gap-2 border-b pb-3.5",
        borderLine,
      )}
    >
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "sticker-badge size-8.5 bg-gradient-to-br text-sm font-black text-white shadow-sm",
            badgeGradient,
          )}
          style={{ transform: "rotate(-4deg)" }}
        >
          {n}
        </span>
        <div>
          <h2 className="font-display text-xl sm:text-2xl font-black tracking-tight text-foreground flex items-center gap-2">
            {title}
          </h2>
          {subtitle && <p className="text-xs font-semibold text-muted-foreground">{subtitle}</p>}
        </div>
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

const KIND_THEMES: Record<
  string,
  {
    border: string;
    headerBg: string;
    badgeBg: string;
    pillBg: string;
    tagText: string;
    tagIcon: string;
  }
> = {
  movie: {
    border: "border-pink-300/90 hover:border-pink-400",
    headerBg: "bg-gradient-to-r from-pink-100/95 via-rose-50/80 to-white",
    badgeBg: "bg-gradient-to-br from-pink-500 to-rose-600 text-white",
    pillBg: "bg-pink-100 text-pink-700 border-pink-300",
    tagText: "MOVIE",
    tagIcon: "🎬",
  },
  wget: {
    border: "border-emerald-300/90 hover:border-emerald-400",
    headerBg: "bg-gradient-to-r from-emerald-100/95 via-teal-50/80 to-white",
    badgeBg: "bg-gradient-to-br from-emerald-500 to-teal-600 text-white",
    pillBg: "bg-emerald-100 text-emerald-800 border-emerald-300",
    tagText: "PARALLEL",
    tagIcon: "⚡",
  },
  zip: {
    border: "border-amber-300/90 hover:border-amber-400",
    headerBg: "bg-gradient-to-r from-amber-100/95 via-orange-50/80 to-white",
    badgeBg: "bg-gradient-to-br from-amber-500 to-orange-600 text-white",
    pillBg: "bg-amber-100 text-amber-800 border-amber-300",
    tagText: "ZIP EXTRACT",
    tagIcon: "🗜️",
  },
  rar: {
    border: "border-orange-300/90 hover:border-orange-400",
    headerBg: "bg-gradient-to-r from-orange-100/95 via-amber-50/80 to-white",
    badgeBg: "bg-gradient-to-br from-orange-500 to-red-500 text-white",
    pillBg: "bg-orange-100 text-orange-800 border-orange-300",
    tagText: "RAR EXTRACT",
    tagIcon: "🗜️",
  },
  split: {
    border: "border-violet-300/90 hover:border-violet-400",
    headerBg: "bg-gradient-to-r from-violet-100/95 via-purple-50/80 to-white",
    badgeBg: "bg-gradient-to-br from-violet-500 to-purple-600 text-white",
    pillBg: "bg-violet-100 text-violet-800 border-violet-300",
    tagText: "SPLIT ARCHIVE",
    tagIcon: "🧩",
  },
  plain: {
    border: "border-sky-300/90 hover:border-sky-400",
    headerBg: "bg-gradient-to-r from-sky-100/95 via-cyan-50/80 to-white",
    badgeBg: "bg-gradient-to-br from-sky-500 to-blue-600 text-white",
    pillBg: "bg-sky-100 text-sky-800 border-sky-300",
    tagText: "URL LIST",
    tagIcon: "🔗",
  },
};

function CellCard({
  cell,
  n,
  copied,
  onCopy,
}: {
  cell: Cell;
  n: number;
  copied: boolean;
  onCopy: () => void;
}) {
  const theme = KIND_THEMES[cell.kind] ?? KIND_THEMES.plain!;

  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border-2 transition-all duration-200 shadow-xs",
        copied
          ? "border-emerald-400 bg-emerald-50/70 shadow-emerald-100 shadow-md scale-[1.01]"
          : cn(theme.border, "bg-white/95 hover:shadow-md hover:scale-[1.005]"),
      )}
    >
      <div
        className={cn(
          "flex items-center gap-2.5 border-b px-3.5 py-2.5 transition-colors",
          copied
            ? "border-emerald-200 bg-gradient-to-r from-emerald-200/80 via-teal-100/70 to-emerald-50"
            : theme.headerBg,
        )}
      >
        <span
          className="sticker text-xl"
          style={{ transform: "rotate(-4deg)", "--r": "-4deg" } as CSSProperties}
        >
          {CELL_EMOJI[cell.kind] ?? "📄"}
        </span>
        <span
          className={cn(
            "sticker-badge px-2 py-0.5 text-[11px] font-black shadow-2xs",
            copied ? "bg-emerald-600 text-white" : theme.badgeBg,
          )}
        >
          #{n}
        </span>
        <span
          className="min-w-0 flex-1 truncate text-xs sm:text-sm font-bold text-foreground/90"
          title={cell.label}
        >
          {cell.label}
        </span>
        <span
          className={cn(
            "hidden sm:inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider border",
            theme.pillBg,
          )}
        >
          <span>{theme.tagIcon}</span>
          <span>{theme.tagText}</span>
        </span>
        <button
          onClick={onCopy}
          className={cn(
            "flex items-center gap-1.5 rounded-full px-3.5 py-1 text-xs font-black transition-all active:scale-95 shadow-xs shrink-0",
            copied
              ? "bg-emerald-600 text-white shadow-emerald-200 ring-2 ring-emerald-300"
              : "lp-btn-pri hover:scale-105",
          )}
        >
          {copied ? (
            <>
              <Check className="size-3.5 stroke-[3]" />
              <span>Copied!</span>
            </>
          ) : (
            <>
              <ClipboardCopy className="size-3.5" />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      <div className="relative p-2.5 sm:p-3 bg-purple-50/15">
        <pre className="lp-code lp-scroll max-h-72 max-w-full overflow-auto rounded-xl bg-slate-900/5 p-3 text-[11.5px] leading-relaxed break-all whitespace-pre-wrap text-purple-950 font-medium">
          {cell.text}
        </pre>
      </div>
    </div>
  );
}

function Toggle({
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-3 rounded-xl p-2 hover:bg-purple-50/80 transition-colors border border-transparent hover:border-purple-200/50",
        disabled && "opacity-45 pointer-events-none",
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-bold text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
      <Switch
        className="shrink-0"
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </label>
  );
}

function Stat({
  n,
  label,
  emoji,
  variant = "default",
}: {
  n: number;
  label: string;
  emoji?: string;
  variant?: "default" | "query" | "clean" | "warning";
}) {
  const styles = {
    default: "badge-candy-berry",
    query: "badge-candy-sun",
    clean: "badge-candy-mint",
    warning: "badge-candy-peach",
  }[variant];

  return (
    <span
      className={cn(
        "sticker-badge px-3.5 py-1 text-xs font-bold shadow-xs transition-transform hover:scale-105",
        styles,
      )}
    >
      {emoji && <span className="mr-1.5 text-sm">{emoji}</span>}
      <b className="font-black tabular-nums">{n}</b> <span className="opacity-80">{label}</span>
    </span>
  );
}

function Corner({
  emoji,
  washi = "pink",
}: {
  emoji: string;
  washi?: "pink" | "peach" | "violet" | "mint";
}) {
  const washiClass = {
    pink: "washi-tape-pink",
    peach: "washi-tape-peach",
    violet: "washi-tape-violet",
    mint: "washi-tape-mint",
  }[washi];

  return (
    <>
      <div className={cn("washi-tape", washiClass)} />
      <span
        onClick={() => toast(`Sticker ${emoji} clicked! ✨`)}
        className="sticker sticker-wiggle absolute -top-4 -right-2 z-20 cursor-pointer text-3xl sm:text-4xl transition-transform hover:scale-130 active:scale-95"
        style={{ transform: "rotate(12deg)", "--r": "12deg" } as CSSProperties}
        title="Tap sticker!"
      >
        {emoji}
      </span>
    </>
  );
}

const FLOATERS: [string, string, string, string][] = [
  ["🌸", "3%", "16%", "-12deg"],
  ["⭐", "94%", "12%", "10deg"],
  ["🍬", "2%", "56%", "8deg"],
  ["🌙", "96%", "50%", "-14deg"],
  ["💫", "46%", "2%", "6deg"],
  ["🪻", "93%", "86%", "12deg"],
  ["🦄", "2%", "34%", "-8deg"],
  ["🍭", "97%", "30%", "14deg"],
  ["🍒", "4%", "80%", "10deg"],
];

function Stickers() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 hidden overflow-hidden md:block select-none"
    >
      {FLOATERS.map(([e, left, top, r], i) => (
        <span
          key={i}
          onClick={(ev) => {
            ev.stopPropagation();
            toast(`Tapped floating sticker ${e}! 💖`);
          }}
          className="sticker sticker-float pointer-events-auto cursor-pointer absolute text-4xl opacity-80 transition-opacity hover:opacity-100 hover:scale-130"
          style={
            {
              left,
              top,
              "--r": r,
              animationDelay: `${i * 0.6}s`,
            } as CSSProperties
          }
        >
          {e}
        </span>
      ))}
    </div>
  );
}
