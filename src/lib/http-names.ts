// Pure helpers for reading a file name out of HTTP response headers.
// Used by src/lib/filename.functions.ts (server) — kept separate so it stays
// testable and browser-safe.

// Parse a Content-Disposition header into a file name.
// Handles RFC 5987 (`filename*=UTF-8''...`), quoted and bare `filename=`.
export const nameFromContentDisposition = (cd: string | null | undefined): string => {
  if (!cd) return "";
  const star = cd.match(/filename\*\s*=\s*([^;]+)/i);
  if (star?.[1]) {
    let v = star[1].trim().replace(/^"|"$/g, "");
    // strip the charset/language prefix: UTF-8''My%20File.zip
    v = v.replace(/^[^']*''/i, "");
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  }
  const quoted = cd.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
  if (quoted?.[1]) return quoted[1].replace(/\\(["\\])/g, "$1").trim();
  const bare = cd.match(/filename\s*=\s*([^;]+)/i);
  return bare?.[1]?.trim() ?? "";
};

// Last path segment of a URL, decoded — fallback when no header name exists.
export const nameFromUrlPath = (url: string): string => {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").filter(Boolean).pop() ?? "";
    try {
      return decodeURIComponent(last);
    } catch {
      return last;
    }
  } catch {
    return "";
  }
};
