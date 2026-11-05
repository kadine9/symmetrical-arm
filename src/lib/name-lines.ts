// Pure helpers for writing resolved file names into the paste box.

const cleanName = (s: string) =>
  s
    .replace(/[\x00-\x1f\x7f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Writes each name on its own line directly above its link, which is the
 * app's "file name above a link" input format. A plain-text line already above
 * the link is replaced; glued / same-line links are split onto their own line.
 * Going through the input text means parsing and grouping pick the names up.
 */
export function applyNamesToInput(
  input: string,
  names: Record<string, string>,
): { text: string; changed: number } {
  let text = input;
  let changed = 0;

  for (const [url, raw] of Object.entries(names)) {
    const name = cleanName(raw);
    if (!name) continue;
    const idx = text.indexOf(url);
    if (idx < 0) continue;

    const lineStart = text.lastIndexOf("\n", idx - 1) + 1;
    const before = text.slice(lineStart, idx);

    if (before.trim() === "") {
      // Link starts its line: reuse a plain-text line above it, else add one.
      if (lineStart > 0) {
        const prevEnd = lineStart - 1;
        const prevStart = text.lastIndexOf("\n", prevEnd - 1) + 1;
        const prev = prevStart <= prevEnd ? text.slice(prevStart, prevEnd).trim() : "";
        if (prev && !/https?:\/\//i.test(prev)) {
          if (prev !== name) {
            text = text.slice(0, prevStart) + name + text.slice(prevEnd);
            changed++;
          }
          continue;
        }
      }
      text = text.slice(0, lineStart) + name + "\n" + text.slice(lineStart);
      changed++;
    } else {
      // Glued to / sharing a line with something else: move onto its own line.
      text = text.slice(0, idx).trimEnd() + "\n" + name + "\n" + text.slice(idx);
      changed++;
    }
  }
  return { text, changed };
}
