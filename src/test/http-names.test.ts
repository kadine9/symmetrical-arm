import { describe, expect, it } from "vitest";
import { nameFromContentDisposition, nameFromUrlPath } from "@/lib/http-names";

describe("nameFromContentDisposition", () => {
  it("reads a quoted filename", () => {
    expect(nameFromContentDisposition('attachment; filename="My Movie 2024.mkv"')).toBe(
      "My Movie 2024.mkv",
    );
  });
  it("reads a bare filename", () => {
    expect(nameFromContentDisposition("attachment; filename=Photos.zip")).toBe("Photos.zip");
  });
  it("prefers RFC 5987 filename* and decodes it", () => {
    expect(
      nameFromContentDisposition(
        "attachment; filename=backup.zip; filename*=UTF-8''Kadine%27s%20Files.zip",
      ),
    ).toBe("Kadine's Files.zip");
  });
  it("returns empty string when there is no filename", () => {
    expect(nameFromContentDisposition("attachment")).toBe("");
    expect(nameFromContentDisposition(null)).toBe("");
    expect(nameFromContentDisposition(undefined)).toBe("");
  });
});

describe("nameFromUrlPath", () => {
  it("decodes the last path segment", () => {
    expect(nameFromUrlPath("https://x.com/d/My%20File.rar?token=1")).toBe("My File.rar");
  });
  it("returns empty string for a bad URL", () => {
    expect(nameFromUrlPath("not a url")).toBe("");
  });
});
