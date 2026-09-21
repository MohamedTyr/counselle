// Sanitises College Board's raw question HTML (after `normalizeSatHtml`,
// see `sat-html-normalize.ts`) before it is rendered via
// `dangerouslySetInnerHTML` (plan.md §6.1, §6.2; parity-inventory Q43–Q44).
// `satPurify` is a dedicated DOMPurify instance — hooks are registered once,
// at module scope, so they never leak onto a shared default import another
// feature might sanitise with.

import createDOMPurify, { type Config } from "dompurify";

import { normalizeSatHtml, transformMfenced } from "./sat-html-normalize";

export { normalizeSatHtml, transformMfenced };

// ---------------------------------------------------------------------------
// 2. Sanitiser configuration (§6.2, Q43)
// ---------------------------------------------------------------------------

const MATHML_TAGS = [
  "math", "mrow", "mn", "mo", "mi", "mtext", "mspace", "ms", "mglyph",
  "mfenced", "mfrac", "msqrt", "mroot", "mstyle", "merror", "mpadded",
  "mphantom", "msub", "msup", "msubsup", "munder", "mover", "munderover",
  "mmultiscripts", "mtable", "mtr", "mtd", "maligngroup", "malignmark",
  "semantics", "annotation",
];

/** DOMPurify's `ALLOWED_ATTR` (and thus `ADD_ATTR`) is a flat,
 * non-element-scoped allow-list — `form` in `ADD_ATTR` would otherwise
 * permit it on every element, not just the `<mo>` it was added for. This
 * is the tag set the `uponSanitizeAttribute` hook below scopes `form` to. */
const MATHML_TAG_SET = new Set(MATHML_TAGS);

const SVG_TAGS = [
  "svg", "g", "path", "defs", "use", "clippath", "clipPath", "rect",
  "circle", "line", "polygon", "polyline", "ellipse", "text", "tspan",
  "style", "figure", "figcaption",
];

/**
 * Upstream's `USE_PROFILES` + `ADD_TAGS` + `ADD_ATTR`, ported, plus
 * hardening (`FORBID_TAGS`) that G5 proves changes nothing visible.
 * `USE_PROFILES` resets the allowed-tag set; `ADD_*` merge after it;
 * `FORBID_TAGS` wins over both (pinned in `sat-html.test.ts`).
 */
export const SANITIZE_CONFIG: Config = {
  USE_PROFILES: { html: true, svg: true, mathMl: true, svgFilters: true },
  ADD_TAGS: [
    ...MATHML_TAGS,
    ...SVG_TAGS,
    "table", "thead", "tbody", "tr", "th", "td", "figure", "img", "ul",
    "ol", "li", "em", "strong", "b", "i", "u", "span", "p", "div",
  ],
  ADD_ATTR: [
    "src", "alt", "alttext", "aria-hidden", "aria-label", "class",
    "colspan", "rowspan", "style", "viewBox", "xmlns", "xmlns:xlink",
    "xlink:href", "href", "clip-path", "clipPath", "clip-rule", "fill",
    "stroke", "stroke-width", "stroke-linecap", "stroke-linejoin",
    "stroke-dasharray", "transform", "d", "id", "x", "y", "width",
    "height", "display", "mathvariant", "accent", "accentunder", "align",
    "rowalign", "columnalign", "version", "role", "loading",
    // G5 audit findings (2026-09-20, plan.md §6.2 / §3.6 R2): both are
    // legitimate, non-executable content found in the full 3,756-question
    // corpus but outside the plan's 204-sample measurement.
    // `form` (MathML Core): controls a stretchy fence's open/close
    // direction, e.g. `<mo form="prefix">(</mo>` — without it a rendered
    // parenthesis can pick the wrong stretch direction, a real content
    // difference (2 fields: 042aa429, de39858a). `ADD_ATTR` is a flat,
    // non-element-scoped allow-list, so `form` is scoped down to
    // `MATHML_TAG_SET` by the `uponSanitizeAttribute` hook below — a
    // security review found it otherwise surviving on `<input>`/`<button>`
    // for orphan form-control association (2026-09-20).
    "form",
    // `isolation` (SVG/CSS presentation attribute, e.g. `isolation:
    // isolate` on a `<g>`): a standard, non-executable compositing hint
    // emitted by design tools that export the bank's SVG figures — the
    // same category as the already-allowed `clip-path`/`fill`/`stroke`
    // presentation attributes (1 field: 25fc031a). Left unscoped: it has
    // no executable meaning on any element, so scoping it would cost
    // complexity for no security benefit.
    "isolation",
  ],
  // Question content is passages, stems, options, rationales, MathML and
  // figures — form controls have no legitimate use here. A security review
  // found College Board's own default-profile allowances otherwise let a
  // live `<form action="https://...">` render and submit, or an
  // `<input>`/`<button>` bind to one via `form=`, straight out of question
  // content (2026-09-20): a native, no-JavaScript phishing vector.
  // `action`/`method` are forbidden too, as defense in depth against any
  // future tag that reintroduces them.
  FORBID_TAGS: [
    "script", "foreignObject",
    "form", "input", "button", "select", "textarea", "option",
  ],
  FORBID_ATTR: ["action", "method"],
};

/** A dedicated instance — hooks are registered once, on this instance only. */
export const satPurify = createDOMPurify(window);

// ---------------------------------------------------------------------------
// 3. Figure `<style>` selector-prefix rewrite (§6.2, Q43b)
// ---------------------------------------------------------------------------

export interface DroppedStyleBlock {
  reason: "not-in-svg" | "disallowed-token" | "unparsable-selector";
  css: string;
}

interface ParsedCssRule {
  selectors: string[];
  body: string;
}

const CSS_COMMENT = /\/\*[\s\S]*?\*\//g;
const CSS_RULE = /([^{}]+)\{([^{}]*)\}/g;
const DISALLOWED_STYLE_TOKEN = /@import|url\(/i;
// The corpus's 14 figure `<style>` blocks use no CSS escapes at all, so a
// backslash anywhere in the block (e.g. `\75 rl(` for `url(`) is treated as
// disallowed rather than unescaped and re-checked against the token list.
const CSS_ESCAPE = /\\/;

function stripCssComments(css: string): string {
  return css.replace(CSS_COMMENT, "");
}

/** A block parses only as a flat list of `selector, selector { … }` rules —
 * no nested at-rule (e.g. `@media`), which the corpus has none of. */
function parseCssRules(css: string): ParsedCssRule[] | null {
  const rules: ParsedCssRule[] = [];
  CSS_RULE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CSS_RULE.exec(css)) !== null) {
    const selectors = match[1]
      .trim()
      .split(",")
      .map((selector) => selector.trim());
    if (selectors.length === 0 || selectors.some((selector) => !selector)) {
      return null;
    }
    rules.push({ selectors, body: match[2] });
  }
  if (css.replace(CSS_RULE, "").trim() !== "" || rules.length === 0) {
    return null;
  }
  return rules;
}

function scopeCssToFigure(rules: ParsedCssRule[], figureId: number): string {
  return rules
    .map((rule) => {
      const scopedSelectors = rule.selectors
        .map((selector) => `[data-sat-fig="${figureId}"] ${selector}`)
        .join(", ");
      return `${scopedSelectors}{${rule.body}}`;
    })
    .join("\n");
}

/** Assigns each `<svg>` its figure id once (a module counter, so ids stay
 * unique across every field the module has sanitised this session). */
function figureIdFor(svg: Element): number {
  const existing = svg.getAttribute("data-sat-fig");
  if (existing !== null) {
    return Number(existing);
  }
  figureCounter += 1;
  svg.setAttribute("data-sat-fig", String(figureCounter));
  return figureCounter;
}

let figureCounter = 0;
let droppedStyleBlocks: DroppedStyleBlock[] = [];

function isElement(node: Node): node is Element {
  return node.nodeType === Node.ELEMENT_NODE;
}

satPurify.addHook("afterSanitizeElements", (currentNode) => {
  if (!isElement(currentNode) || currentNode.tagName.toLowerCase() !== "style") {
    return;
  }
  const styleNode = currentNode;
  const svg = styleNode.parentElement?.closest("svg") ?? null;
  // `textContent` is whatever the parser attached to this node, including
  // anything a premature `</style>` spilled into it — still just a string
  // run through the same comment-strip, backslash and token checks below.
  const rawCss = styleNode.textContent ?? "";
  const css = stripCssComments(rawCss);

  if (!svg || DISALLOWED_STYLE_TOKEN.test(css) || CSS_ESCAPE.test(css)) {
    droppedStyleBlocks.push({
      reason: svg ? "disallowed-token" : "not-in-svg",
      css: rawCss,
    });
    styleNode.remove();
    return;
  }

  const rules = parseCssRules(css);
  if (!rules) {
    droppedStyleBlocks.push({ reason: "unparsable-selector", css: rawCss });
    styleNode.remove();
    return;
  }

  styleNode.textContent = scopeCssToFigure(rules, figureIdFor(svg));
});

// ---------------------------------------------------------------------------
// 4. Attribute hardening (§6.2)
// ---------------------------------------------------------------------------

const STYLE_DECL_BLOCKLIST = /url\(|expression|position/i;
const FRAGMENT_HREF = /^#/;
// eslint-disable-next-line no-control-regex -- intentional: control chars are a known scheme-prefix smuggling vector for the src attribute.
const LEADING_WHITESPACE_CONTROL = /^[\s\x00-\x1f]+/;
// eslint-disable-next-line no-control-regex -- see LEADING_WHITESPACE_CONTROL above.
const DATA_URI = /^[\s\x00-\x1f]*data:/i;
const SAFE_IMAGE_DATA_URI = /^data:image\/(png|jpe?g|gif)[;,]/i;

function sanitizeStyleAttribute(value: string): string {
  return value
    .split(";")
    .map((declaration) => declaration.trim())
    .filter(
      (declaration) =>
        declaration &&
        !STYLE_DECL_BLOCKLIST.test(declaration) &&
        !CSS_ESCAPE.test(declaration),
    )
    .join("; ");
}

satPurify.addHook("uponSanitizeAttribute", (currentNode, hookEvent) => {
  const { attrName, attrValue } = hookEvent;

  if (attrName === "style") {
    hookEvent.attrValue = sanitizeStyleAttribute(attrValue);
    return;
  }

  if (attrName === "href" || attrName === "xlink:href") {
    if (!FRAGMENT_HREF.test(attrValue)) {
      hookEvent.keepAttr = false;
    }
    return;
  }

  // `ADD_ATTR`'s `form` entry is a flat allow-list, not element-scoped —
  // restrict it to the MathML elements it was added for (`<mo form="prefix">`,
  // a stretchy fence's direction). Everywhere else it is dropped, closing
  // the orphan form-control-association vector a security review found.
  if (attrName === "form") {
    if (!MATHML_TAG_SET.has(currentNode.tagName.toLowerCase())) {
      hookEvent.keepAttr = false;
    }
    return;
  }

  if (DATA_URI.test(attrValue)) {
    const trimmed = attrValue.replace(LEADING_WHITESPACE_CONTROL, "");
    const isImg = currentNode.tagName.toLowerCase() === "img";
    const match = isImg ? SAFE_IMAGE_DATA_URI.exec(trimmed) : null;
    if (!match) {
      hookEvent.keepAttr = false;
    } else {
      // DOMPurify's own data-URI allowance re-checks the (hook-returned)
      // value against a case-sensitive literal "data:" prefix, so a
      // mixed-case scheme/type must be normalised here or it is dropped a
      // second time downstream. The base64 payload after the prefix is
      // case-sensitive and left untouched.
      hookEvent.attrValue = match[0].toLowerCase() + trimmed.slice(match[0].length);
    }
  }
});

// ---------------------------------------------------------------------------
// 5. sanitizeSatHtml + the per-(contentSha, field) memo (§6.1)
// ---------------------------------------------------------------------------

export interface SanitizeSatHtmlResult {
  html: string;
  droppedStyleBlocks: DroppedStyleBlock[];
}

/** Sanitises already-normalised HTML. Resets the figure-style drop report
 * to this call's own findings — hook removals never appear in DOMPurify's
 * own `removed` list, so this is the only record of them (G5). */
export function sanitizeSatHtml(html: string): SanitizeSatHtmlResult {
  droppedStyleBlocks = [];
  const sanitized = satPurify.sanitize(html, SANITIZE_CONFIG);
  return { html: sanitized, droppedStyleBlocks };
}

const satHtmlCache = new Map<string, string>();

/**
 * The memoised `normalizeSatHtml` → `sanitizeSatHtml` pipeline, keyed by
 * `(contentSha, field)`. Memoisation is load-bearing (§6.1): a stable string
 * is what lets `SatContent` keep a stable `dangerouslySetInnerHTML` wrapper
 * object, and it is that wrapper's *reference* — not the `__html` string —
 * that React's prop differ checks before resetting `innerHTML`. See
 * `SatContent.tsx` for the full mechanism; the highlighter (§6.3) holds
 * `Range`s into that DOM and depends on it surviving unrelated re-renders.
 */
export function getSatHtml(
  contentSha: string,
  field: string,
  html: string,
): string {
  const cacheKey = `${contentSha}:${field}`;
  const cached = satHtmlCache.get(cacheKey);
  if (cached !== undefined) {
    return cached;
  }
  const { html: sanitized } = sanitizeSatHtml(normalizeSatHtml(html));
  satHtmlCache.set(cacheKey, sanitized);
  return sanitized;
}
