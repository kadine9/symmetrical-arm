import { describe, expect, it } from "vitest";
import { buildCells, buildGroups, DEFAULT_SETTINGS, parseLinks } from "@/lib/commands";

const output = (input: string, overrides = {}) => {
  const items = parseLinks(input);
  return buildCells(items, buildGroups(items), { ...DEFAULT_SETTINGS, ...overrides })[0]?.text;
};

describe("Parallel wget format", () => {
  it("sends clean URLs to content-disposition and query URLs to wget -O automatically", () => {
    expect(
      output("https://example.com/one.txt\nhttps://example.com/two.txt?download=true&n=two.txt"),
    ).toBe(
      [
        "! printf '%s\\n' \\",
        "'https://example.com/one.txt' \\",
        "| xargs -n 1 -P 15 wget --content-disposition",
        "! printf '%s\\0' \\",
        "'two.txt' 'https://example.com/two.txt?download=true&n=two.txt' \\",
        `| xargs -0 -n 2 -P 15 sh -c 'wget -O "$0" "$1"'`,
      ].join("\n"),
    );
  });

  it("preserves the selected worker count", () => {
    expect(
      output("https://example.com/one.txt\nhttps://example.com/two.txt", { workers: 4 }),
    ).toContain("-P 4 wget --content-disposition");
  });

  it("escapes apostrophes in single-quoted URLs", () => {
    expect(output("https://example.com/Doug's.txt\nhttps://example.com/two.txt")).toContain(
      "'https://example.com/Doug'\\''s.txt' \\",
    );
  });

  it("force filename pairs each name with its URL for parallel -O downloads", () => {
    expect(
      output("https://example.com/one.txt\nhttps://example.com/two.txt", { forceName: true }),
    ).toBe(
      [
        "! printf '%s\\0' \\",
        "'one.txt' 'https://example.com/one.txt' \\",
        "'two.txt' 'https://example.com/two.txt' \\",
        `| xargs -0 -n 2 -P 15 sh -c 'wget -O "$0" "$1"'`,
      ].join("\n"),
    );
  });

  it("force filename escapes apostrophes in names", () => {
    expect(
      output("https://example.com/Doug's.txt\nhttps://example.com/two.txt", { forceName: true }),
    ).toContain("'Doug'\\''s.txt' 'https://example.com/Doug'\\''s.txt' \\");
  });

  it("force filename without parallel stays one -O wget per line", () => {
    expect(output("https://example.com/one.txt", { forceName: true, parallel: false })).toBe(
      '! wget -O "one.txt" "https://example.com/one.txt"',
    );
  });

  it("leaves nonparallel wget output unchanged", () => {
    expect(
      output("https://example.com/one.txt\nhttps://example.com/two.txt?token=abc", {
        parallel: false,
      }),
    ).toBe(
      '! wget --content-disposition "https://example.com/one.txt"\n! wget -O "two.txt" "https://example.com/two.txt?token=abc"',
    );
  });
});
