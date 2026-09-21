// Pre-sanitise string transforms for College Board's raw question HTML
// (plan.md §6.1, §6.2; parity-inventory Q39–Q42). Ported unchanged from
// liprep's five string transforms plus `transformMfenced` (differential
// harness: `tests/domain/sat/upstream/`). Split out of `sat-html.ts` (plan
// §5.2's 400-line cap) because this half needs no DOMPurify instance at
// all — re-exported from `sat-html.ts` so every existing import keeps
// working unchanged.

const BLANK_WITH_SR_LABEL =
  /<span aria-hidden="true">_+<\/span><span class="sr-only">blank<\/span>/gi;
const BARE_BLANK_RUN = /_{4,}/g;
const DEGREE_ENTITY = /&deg;/g;
const CELL_STYLE_WIDTH =
  /(<(?:th|td)\b[^>]*style="[^"]*?)\bwidth:\s*[\d.]+(?:px|pt|em|rem);?\s*/gi;
const CELL_WIDTH_ATTR =
  /(<(?:th|td)\b[^>]*)\bwidth=["'][\d.]+(?:px|pt)?["']/gi;

/**
 * Modern browsers have deprecated MathML `<mfenced>`. Rewrites it into
 * `<mrow><mo>(</mo>…<mo>)</mo></mrow>` honouring `open` / `close` /
 * `separators`, ported unchanged from liprep's `RichContent.tsx`.
 */
export function transformMfenced(html: string): string {
  if (!html.includes("<mfenced") && !html.includes("<mfenced/")) {
    return html;
  }

  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
    const mfencedElements = Array.from(doc.querySelectorAll("mfenced"));

    for (let i = mfencedElements.length - 1; i >= 0; i--) {
      const el = mfencedElements[i];
      const open = el.hasAttribute("open") ? el.getAttribute("open") : "(";
      const close = el.hasAttribute("close") ? el.getAttribute("close") : ")";
      const separatorsAttr = el.getAttribute("separators");

      let separators: string[] = [","];
      if (separatorsAttr !== null) {
        separators = separatorsAttr.replace(/\s+/g, "").split("");
      }

      const newMrow = doc.createElement("mrow");

      if (open) {
        const moOpen = doc.createElement("mo");
        moOpen.textContent = open;
        newMrow.appendChild(moOpen);
      }

      const children = Array.from(el.childNodes);
      children.forEach((child, idx) => {
        newMrow.appendChild(child);
        if (idx < children.length - 1 && separators.length > 0) {
          const sepChar =
            idx < separators.length
              ? separators[idx]
              : separators[separators.length - 1];
          if (sepChar) {
            const moSep = doc.createElement("mo");
            moSep.textContent = sepChar;
            newMrow.appendChild(moSep);
          }
        }
      });

      if (close) {
        const moClose = doc.createElement("mo");
        moClose.textContent = close;
        newMrow.appendChild(moClose);
      }

      el.parentNode?.replaceChild(newMrow, el);
    }

    return doc.body.innerHTML;
  } catch {
    return html;
  }
}

/**
 * The five upstream `replace` calls, same order and same regexes, then
 * `transformMfenced` — pre-sanitise string transforms (Q39–Q42). Q39's FIX:
 * a bare underscore run also gets `aria-label="blank space"`, which upstream
 * only gives the screen-reader-labelled form.
 */
export function normalizeSatHtml(html: string): string {
  let normalized = html;

  normalized = normalized.replace(
    BLANK_WITH_SR_LABEL,
    '<span class="sat-blank" aria-label="blank space"></span>',
  );
  normalized = normalized.replace(
    BARE_BLANK_RUN,
    '<span class="sat-blank" aria-label="blank space"></span>',
  );
  normalized = normalized.replace(DEGREE_ENTITY, "°");
  normalized = normalized.replace(CELL_STYLE_WIDTH, "$1");
  normalized = normalized.replace(CELL_WIDTH_ATTR, "$1");
  normalized = transformMfenced(normalized);

  return normalized;
}
