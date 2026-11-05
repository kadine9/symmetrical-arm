// Link filters, ported from the filter app. Pure functions.
import { stripShowName } from "@/lib/episodes";

type Named = { name: string; url: string };

export interface FilterState {
  show: string; // show name contains
  term: string; // all of these words
  or: string; // any of these words
  only: string; // comma phrases: keep only matching
  except: string; // comma phrases: drop matching
  hide: number; // hide N links from top/bottom
  hidePos: "top" | "bottom";
  dedupeUrls: boolean; // drop exact same URL (kept even though name dedupe exists)
  dedupeEps: boolean;
  dedupeMode: "priority" | "first" | "last";
  priority: string;
  dedupeIgnore: string;
}

export const DEFAULT_FILTERS: FilterState = {
  show: "",
  term: "",
  or: "",
  only: "",
  except: "",
  hide: 0,
  hidePos: "top",
  dedupeUrls: false,
  dedupeEps: false,
  dedupeMode: "priority",
  priority: "repack proper 2160p 1080p",
  dedupeIgnore: "",
};

export const wordsOf = (s: string) => (s || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
export const phrasesOf = (s: string) =>
  (s || "")
    .toLowerCase()
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

export function normalizeFilters(v: unknown): FilterState {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<keyof FilterState, unknown>>;
  const str = (k: keyof FilterState) =>
    typeof o[k] === "string" ? (o[k] as string) : (DEFAULT_FILTERS[k] as string);
  return {
    show: str("show"),
    term: str("term"),
    or: str("or"),
    only: str("only"),
    except: str("except"),
    hide: Math.max(0, parseInt(String(o.hide ?? 0), 10) || 0),
    hidePos: o.hidePos === "bottom" ? "bottom" : "top",
    dedupeUrls: o.dedupeUrls === true,
    dedupeEps: o.dedupeEps === true,
    dedupeMode: o.dedupeMode === "first" || o.dedupeMode === "last" ? o.dedupeMode : "priority",
    priority: str("priority"),
    dedupeIgnore: str("dedupeIgnore"),
  };
}

export const urlKey = (url: string) => (url || "").trim().toLowerCase().replace(/\/+$/, "");

/** Remove links pointing at the same URL, keeping the first. */
export function dedupeExactUrls<T extends Named>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((f) => {
    const k = urlKey(f.url);
    if (!k || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function buildMatcher(search: string, f: FilterState) {
  const q = search.trim().toLowerCase();
  const terms = wordsOf(f.term);
  const orTerms = wordsOf(f.or);
  const only = phrasesOf(f.only);
  const except = phrasesOf(f.except);
  const show = f.show.trim().toLowerCase();
  return (item: Named) => {
    const title = item.name.toLowerCase();
    const text = `${item.url} ${item.name}`.toLowerCase();
    if (q && !text.includes(q)) return false;
    if (only.length && !only.some((p) => text.includes(p))) return false;
    if (except.length && except.some((p) => text.includes(p))) return false;
    if (show && !stripShowName(item.name).includes(show) && !title.includes(show)) return false;
    if (terms.length && !terms.every((t) => text.includes(t))) return false;
    if (orTerms.length && !orTerms.some((t) => text.includes(t))) return false;
    return true;
  };
}

export function hideEdge<T>(items: T[], hide: number, pos: "top" | "bottom"): T[] {
  if (!hide || hide <= 0) return items;
  return pos === "top" ? items.slice(hide) : items.slice(0, Math.max(0, items.length - hide));
}
