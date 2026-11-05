import { describe, expect, it } from "vitest";
import { applyNamesToInput } from "@/lib/name-lines";
import { isBlockedHost, parseDisposition } from "@/lib/names.server";

describe("applyNamesToInput", () => {
  it("adds a name line above a bare link", () => {
    const r = applyNamesToInput("https://a.com/d/1", { "https://a.com/d/1": "Movie.mkv" });
    expect(r).toEqual({ text: "Movie.mkv\nhttps://a.com/d/1", changed: 1 });
  });

  it("replaces an existing plain-text name line", () => {
    const r = applyNamesToInput("1. Old name\nhttps://a.com/d/1", {
      "https://a.com/d/1": "New.mkv",
    });
    expect(r.text).toBe("New.mkv\nhttps://a.com/d/1");
  });

  it("does not treat a previous link as a name line", () => {
    const r = applyNamesToInput("https://a.com/x\nhttps://a.com/d/1", {
      "https://a.com/d/1": "N.mkv",
    });
    expect(r.text).toBe("https://a.com/x\nN.mkv\nhttps://a.com/d/1");
  });

  it("splits glued links onto their own lines", () => {
    const r = applyNamesToInput("https://a.com/1https://a.com/2", {
      "https://a.com/1": "One.mkv",
      "https://a.com/2": "Two.mkv",
    });
    expect(r.text).toBe("One.mkv\nhttps://a.com/1\nTwo.mkv\nhttps://a.com/2");
    expect(r.changed).toBe(2);
  });

  it("skips links it cannot find and unchanged names", () => {
    expect(
      applyNamesToInput("Same.mkv\nhttps://a.com/1", { "https://a.com/1": "Same.mkv" }).changed,
    ).toBe(0);
    expect(applyNamesToInput("hello", { "https://nope": "X" }).changed).toBe(0);
  });
});

describe("server helpers", () => {
  it("parses Content-Disposition variants", () => {
    expect(parseDisposition('attachment; filename="a b.mkv"')).toBe("a b.mkv");
    expect(parseDisposition("attachment; filename*=UTF-8''caf%C3%A9.mkv")).toBe("café.mkv");
    expect(parseDisposition("attachment; filename=plain.zip")).toBe("plain.zip");
    expect(parseDisposition(null)).toBeNull();
  });

  it("blocks internal hosts", () => {
    for (const h of [
      "localhost",
      "127.0.0.1",
      "10.0.0.5",
      "192.168.1.1",
      "169.254.169.254",
      "::1",
      "foo.internal",
    ])
      expect(isBlockedHost(h)).toBe(true);
    expect(isBlockedHost("example.com")).toBe(false);
    expect(isBlockedHost("8.8.8.8")).toBe(false);
  });
});
