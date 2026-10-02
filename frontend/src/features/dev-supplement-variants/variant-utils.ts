/* Shared helpers for the supplement design variants. */

const TITLE_MAX_CHARS = 64;
const ASK_START =
  /^(?:please |briefly )?(?:describe|tell|explain|share|write|reflect|discuss|list|elaborate|consider|imagine|choose|select|provide|identify|name|recount|respond|what|why|how|who|which|where|when|if)\b/i;

/* The prompt's ask, shortened: the same rule the server uses for essay
 * titles (domain/supplements.py::essay_title). */
export function essayTitleFromPrompt(prompt: string): string {
  const text = prompt.split(/\s+/).join(" ").trim();
  const sentences = text.match(/[^.?!]+[.?!]/g)?.map((s) => s.trim()) ?? [];
  const asks = sentences.filter((s) => s.endsWith("?") || ASK_START.test(s));
  const title = asks[0] ?? sentences[0] ?? text;
  if (title.length <= TITLE_MAX_CHARS) return title;
  const cut = title.slice(0, TITLE_MAX_CHARS - 1).replace(/\s+\S*$/, "").replace(/[,;:]$/, "");
  return `${cut}…`;
}

export type DiffPart = { kind: "same" | "added" | "removed"; text: string };

/* Word-level diff (longest common subsequence) between two prompt versions. */
export function wordDiff(before: string, after: string): DiffPart[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const parts: DiffPart[] = [];
  const push = (kind: DiffPart["kind"], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      push("same", a[i]);
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      push("removed", a[i]);
      i += 1;
    } else {
      push("added", b[j]);
      j += 1;
    }
  }
  while (i < a.length) push("removed", a[i++]);
  while (j < b.length) push("added", b[j++]);
  return parts;
}
