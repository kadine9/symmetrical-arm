// Server-only: looks up real file names with HEAD / Content-Disposition.
// Imported dynamically from names.functions.ts so it never ships to the browser.

const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 5;
const CONCURRENCY = 6;
const HEADERS = { "User-Agent": "Mozilla/5.0 (compatible; LinkPop/1.0)" };

export type NameResult = {
  url: string;
  name?: string;
  source?: "content-disposition" | "url";
  error?: string;
};

// ── SSRF guard: never fetch internal addresses ──────────────────────────────
export function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    h === "localhost" ||
    h.endsWith(".localhost") ||
    h.endsWith(".local") ||
    h.endsWith(".internal")
  )
    return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) {
    const [a, b] = h.split(".").map(Number) as [number, number];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  if (h.includes(":")) {
    return (
      h === "::" ||
      h === "::1" ||
      h.startsWith("fc") ||
      h.startsWith("fd") ||
      h.startsWith("fe80") ||
      h.startsWith("::ffff:")
    );
  }
  return false;
}

function parseHttp(raw: string): URL | null {
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

// ── Content-Disposition parsing ─────────────────────────────────────────────
export function parseDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const star = cd.match(/filename\*\s*=\s*([^']*)'[^']*'([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[2]!.trim().replace(/^"|"$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const quoted = cd.match(/filename\s*=\s*"((?:[^"\\]|\\.)*)"/i);
  if (quoted) return quoted[1]!.replace(/\\(.)/g, "$1");
  const bare = cd.match(/filename\s*=\s*([^;]+)/i);
  return bare ? bare[1]!.trim() : null;
}

function cleanName(s: string): string {
  const base = s.split(/[\\/]/).pop() ?? "";
  return base
    .replace(/[\x00-\x1f\x7f]/g, "")
    .trim()
    .slice(0, 255);
}

// ── Probing ─────────────────────────────────────────────────────────────────
const hit = (method: "HEAD" | "GET", u: URL) =>
  fetch(u, {
    method,
    redirect: "manual", // follow manually so every hop passes the SSRF check
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: method === "GET" ? { ...HEADERS, Range: "bytes=0-0" } : HEADERS,
  });

const redirectTarget = (res: Response, from: URL): string | null =>
  res.status >= 300 && res.status < 400 && res.headers.get("location")
    ? new URL(res.headers.get("location")!, from).toString()
    : null;

async function probe(start: string): Promise<{ res: Response; url: URL }> {
  let current = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = parseHttp(current);
    if (!u) throw new Error("not an http(s) link");
    if (isBlockedHost(u.hostname)) throw new Error("blocked address");

    let res: Response | null = null;
    try {
      res = await hit("HEAD", u);
    } catch {
      /* some servers drop HEAD: fall back to GET below */
    }
    if (res) {
      const next = redirectTarget(res, u);
      if (next) {
        current = next;
        continue;
      }
      if (res.ok && res.headers.get("content-disposition")) return { res, url: u };
      await res.body?.cancel().catch(() => {});
    }

    // HEAD refused or carried no header: ask for just the first byte.
    const g = await hit("GET", u);
    const next = redirectTarget(g, u);
    await g.body?.cancel().catch(() => {});
    if (next) {
      current = next;
      continue;
    }
    return { res: g, url: u };
  }
  throw new Error("too many redirects");
}

async function resolveOne(url: string): Promise<NameResult> {
  const { res, url: finalUrl } = await probe(url);
  const fromHeader = parseDisposition(res.headers.get("content-disposition"));
  if (fromHeader) {
    const name = cleanName(fromHeader);
    if (name) return { url, name, source: "content-disposition" };
  }
  // No header: use the last path segment of the final URL if it looks like a file.
  const last = finalUrl.pathname.split("/").filter(Boolean).pop() ?? "";
  let decoded = last;
  try {
    decoded = decodeURIComponent(last);
  } catch {
    /* keep raw */
  }
  const name = cleanName(decoded);
  if (name && /\.[A-Za-z0-9]{1,8}$/.test(name)) return { url, name, source: "url" };
  return {
    url,
    error: res.ok || res.status === 206 ? "no file name found" : `HTTP ${res.status}`,
  };
}

export async function resolveMany(urls: string[]): Promise<NameResult[]> {
  const results: NameResult[] = new Array(urls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, urls.length) }, async () => {
      while (next < urls.length) {
        const i = next++;
        try {
          results[i] = await resolveOne(urls[i]!);
        } catch (e) {
          results[i] = {
            url: urls[i]!,
            error: e instanceof Error ? e.message : "failed",
          };
        }
      }
    }),
  );
  return results;
}
