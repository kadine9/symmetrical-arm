import { describe, expect, it } from "vitest";
import { dedupeEpisodes, sortByEpisode } from "@/lib/episodes";
import { buildMatcher, DEFAULT_FILTERS, dedupeExactUrls } from "@/lib/filters";

const it_ = (name: string, url = `https://x.com/${name}`) => ({ name, url });

describe("ported filter logic", () => {
  it("keeps the release with the earliest priority word", () => {
    const r = dedupeEpisodes([it_("Show.S01E01.720p.mkv"), it_("Show.S01E01.1080p.mkv")], {
      priorityWords: ["1080p", "720p"],
    });
    expect(r.kept.map((f) => f.name)).toEqual(["Show.S01E01.1080p.mkv"]);
    expect(r.dupes).toBe(1);
  });
  it("sorts by season then episode", () => {
    const s = sortByEpisode([it_("Show.S01E10.mkv"), it_("Show.S01E02.mkv")]);
    expect(s.map((f) => f.name)).toEqual(["Show.S01E02.mkv", "Show.S01E10.mkv"]);
  });
  it("except phrases drop matches", () => {
    const m = buildMatcher("", { ...DEFAULT_FILTERS, except: "sample" });
    expect(m(it_("a.sample.mkv"))).toBe(false);
    expect(m(it_("a.mkv"))).toBe(true);
  });
  it("removes exact duplicate URLs", () => {
    expect(dedupeExactUrls([it_("a", "https://x/a"), it_("b", "https://x/a/")])).toHaveLength(1);
  });
});
