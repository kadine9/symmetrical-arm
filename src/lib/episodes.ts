// Season / episode helpers, ported from the filter app. Pure functions.

type Named = { name: string; url: string };

export function parseSeasonEpisode(title: string) {
  if (!title) return null;
  let m = title.match(/s(\d{1,4})[\s._-]*e(\d{1,4})/i);
  if (m) return { season: parseInt(m[1]!, 10), episode: parseInt(m[2]!, 10) as number | null };
  m = title.match(/\b(\d{1,2})x(\d{1,3})\b/i);
  if (m) return { season: parseInt(m[1]!, 10), episode: parseInt(m[2]!, 10) as number | null };
  m = title.match(/\b(?:s|season)[\s._-]*(\d{1,4})(?!\d)/i);
  if (m) return { season: parseInt(m[1]!, 10), episode: null as number | null };
  return null;
}

export function stripShowName(title: string): string {
  if (!title) return "";
  let name = title.replace(/[._]+/g, " ");
  const se = name.match(
    /\b(s\d{1,4}[\s._-]*e\d{1,4}|\d{1,2}x\d{1,4}|(?:s|season)[\s._-]*\d{1,4})(?!\d)/i,
  );
  if (se && se.index !== undefined) name = name.slice(0, se.index);
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

export function episodeKey(title: string): string {
  const show = stripShowName(title);
  const se = parseSeasonEpisode(title);
  if (se) {
    const ep = se.episode !== null ? `e${String(se.episode).padStart(2, "0")}` : "";
    return `${show}|s${String(se.season).padStart(2, "0")}${ep}`;
  }
  return show || title.toLowerCase().trim();
}

export function episodeSortValue(title: string): number {
  const se = parseSeasonEpisode(title);
  if (!se) return Number.POSITIVE_INFINITY;
  return se.season * 10000 + (se.episode ?? 0);
}

/**
 * Keep one link per show+season+episode. "priority" keeps the release matching
 * the earliest priority word; "first"/"last" keep by position.
 */
export function dedupeEpisodes<T extends Named>(
  items: T[],
  opts: {
    mode?: "priority" | "first" | "last";
    priorityWords?: string[];
    ignoreWords?: string[];
  } = {},
): { kept: T[]; dupes: number } {
  const { mode = "priority", priorityWords = [], ignoreWords = [] } = opts;
  const rank = (f: T) => {
    const text = `${f.url} ${f.name}`.toLowerCase();
    const i = priorityWords.findIndex((w) => text.includes(w));
    return i === -1 ? priorityWords.length : i;
  };
  const buckets = new Map<string, T[]>();
  const survivors = new Set<T>();
  for (const f of items) {
    const title = f.name;
    const lower = title.toLowerCase();
    if (
      (ignoreWords.length && ignoreWords.some((w) => lower.includes(w))) ||
      !parseSeasonEpisode(title)
    ) {
      survivors.add(f);
      continue;
    }
    const k = episodeKey(title);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k)!.push(f);
  }
  for (const group of buckets.values()) {
    let winner = group[0]!;
    if (mode === "last") winner = group[group.length - 1]!;
    else if (mode === "priority") {
      let best = rank(winner);
      for (const f of group.slice(1)) {
        const r = rank(f);
        if (r < best) {
          best = r;
          winner = f;
        }
      }
    }
    survivors.add(winner);
  }
  const kept = items.filter((f) => survivors.has(f));
  return { kept, dupes: items.length - kept.length };
}

/** Sort by show name, then season/episode, then file name. */
export function sortByEpisode<T extends Named>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const ds = stripShowName(a.name).localeCompare(stripShowName(b.name));
    if (ds !== 0) return ds;
    const de = episodeSortValue(a.name) - episodeSortValue(b.name);
    if (de !== 0 && Number.isFinite(de)) return de;
    if (!Number.isFinite(episodeSortValue(a.name)) !== !Number.isFinite(episodeSortValue(b.name)))
      return Number.isFinite(episodeSortValue(a.name)) ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
