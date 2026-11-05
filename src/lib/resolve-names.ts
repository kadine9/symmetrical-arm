import { resolveNamesFn } from "@/lib/names.functions";

export type Resolved = {
  url: string;
  name?: string;
  source?: "content-disposition" | "url";
  error?: string;
};

const CHUNK = 30; // matches the server function's limit

export async function resolveNames(
  urls: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<Resolved[]> {
  const out: Resolved[] = [];
  for (let i = 0; i < urls.length; i += CHUNK) {
    const chunk = urls.slice(i, i + CHUNK);
    try {
      out.push(...(await resolveNamesFn({ data: { urls: chunk } })));
    } catch {
      chunk.forEach((url) => out.push({ url, error: "request failed" }));
    }
    onProgress?.(Math.min(i + CHUNK, urls.length), urls.length);
  }
  return out;
}
