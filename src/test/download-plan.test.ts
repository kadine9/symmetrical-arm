import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, buildGroups, parseLinks } from "@/lib/commands";
import { buildPlannedCells, EMPTY_PLAN, normalizePlan } from "@/lib/download-plan";

const items = parseLinks(
  "https://example.com/One.mkv\nhttps://example.com/Two.mkv?token=abc\nhttps://example.com/Three.mkv",
);
const groups = buildGroups(items);
describe("Download choices", () => {
  it("keeps any number of destination folders", () => {
    const folders = Array.from({ length: 150 }, (_, i) => `/content/Folder ${i}`);
    expect(normalizePlan({ folders, folder: folders[149] }).folders).toHaveLength(150);
    expect(normalizePlan({ folders, folder: folders[149] }).folder).toBe("/content/Folder 149");
  });
  it("combines chosen movies and leaves the other movie in a separate wget cell", () => {
    const cells = buildPlannedCells(items, groups, DEFAULT_SETTINGS, 1, {
      ...EMPTY_PLAN,
      batches: ["Together 1"],
      assignments: {
        "https://example.com/One.mkv": { batch: "Together 1" },
        "https://example.com/Two.mkv?token=abc": { batch: "Together 1" },
        "https://example.com/Three.mkv": { batch: "separate" },
      },
    });
    expect(cells.map((c) => c.ids.length)).toEqual([2, 1]);
    expect(cells[0]?.text).toContain("xargs");
    expect(cells[0]?.text).toContain("wget --content-disposition");
    expect(cells[1]?.text).toBe('! wget --content-disposition "https://example.com/Three.mkv"');
  });
  it("downloads clean and query links inside the chosen folder with safe quoting", () => {
    const cells = buildPlannedCells(items, groups, DEFAULT_SETTINGS, 1, {
      ...EMPTY_PLAN,
      folder: "/content/Kadine's Movies",
    });
    expect(cells).toHaveLength(3);
    expect(cells[0]?.text).toContain(
      "mkdir -p -- '/content/Kadine'\\''s Movies' && cd -- '/content/Kadine'\\''s Movies' && wget",
    );
    expect(cells[1]?.text).toContain('wget -O "Two.mkv"');
  });
  it("allows different destinations for individual items", () => {
    const cells = buildPlannedCells(items, groups, DEFAULT_SETTINGS, 1, {
      ...EMPTY_PLAN,
      folder: "/content/Movies",
      assignments: { "https://example.com/Three.mkv": { folder: "/content/Other" } },
    });
    expect(cells[0]?.text).toContain("cd -- '/content/Movies'");
    expect(cells[2]?.text).toContain("cd -- '/content/Other'");
  });
  it("uses chosen folders for archive extraction while leaving plain URLs unchanged", () => {
    const zip = parseLinks("https://example.com/Photos.zip");
    expect(
      buildPlannedCells(zip, buildGroups(zip), DEFAULT_SETTINGS, 1, {
        ...EMPTY_PLAN,
        folder: "/content/Photos",
      })[0]?.text,
    ).toContain('extract_path = "/content/Photos"');
    expect(
      buildPlannedCells(zip, buildGroups(zip), { ...DEFAULT_SETTINGS, kind: "plain" }, 1, {
        ...EMPTY_PLAN,
        folder: "/content/Photos",
      })[0]?.text,
    ).toBe("https://example.com/Photos.zip");
  });
});
describe("Per-item split", () => {
  it("splits only the chosen links into the chosen number of parts", () => {
    const cells = buildPlannedCells(items, groups, DEFAULT_SETTINGS, 1, {
      ...EMPTY_PLAN,
      assignments: {
        "https://example.com/One.mkv": { batch: "Together 1", parts: 2 },
        "https://example.com/Three.mkv": { batch: "Together 1", parts: 2 },
      },
      batches: ["Together 1"],
    });
    const split = cells.filter((c) => c.label.includes("Part"));
    expect(split.map((c) => c.ids.length)).toEqual([1, 1]);
    expect(normalizePlan({ assignments: { a: { parts: 3 } } }).assignments["a"]?.parts).toBe(3);
  });
});
