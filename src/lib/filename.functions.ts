import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { nameFromContentDisposition } from "./http-names";

// Ask each link's server for the real file name (HEAD first, then a 1-byte
// GET as fallback). Runs server-side because browsers can't do cross-origin
// HEAD requests. Only the file name ever leaves this function.
const TIMEOUT_MS = 8000;

const headName = async (url: string): Promise<string> => {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    let res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: ctrl.signal,
    });
    if (!res.ok) {
      res.body?.cancel().catch(() => {});
      res = await fetch(url, {
        method: "GET",
        headers: { Range: "bytes=0-0" },
        redirect: "follow",
        signal: ctrl.signal,
      });
    }
    const name = nameFromContentDisposition(res.headers.get("content-disposition"));
    res.body?.cancel().catch(() => {});
    return name;
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
};

export const fetchFileNames = createServerFn({ method: "POST" })
  .validator((d: unknown) =>
    z
      .object({
        urls: z
          .array(z.string().regex(/^https?:\/\//))
          .min(1)
          .max(50),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const entries = await Promise.all(data.urls.map(async (u) => [u, await headName(u)] as const));
    return Object.fromEntries(entries.filter(([, n]) => n));
  });
