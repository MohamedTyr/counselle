// G5 render gate (plan.md §3.6, §8.2 "a stated limit"): the real renderer —
// `normalizeSatHtml` + the feature's own `satPurify` instance — run over
// every stimulus/stem/option/rationale in the shipped bank. Skipped when
// `SAT_BANK_PATH` is unset or the file is absent, which is what keeps a
// plain `npm test` green; `npm run sat:audit-html` sets the env var.
//
// Sharded across child `vitest` processes (measured cause, not a guess):
// every `DOMParser.parseFromString()` call -- ours in `transformMfenced`
// and DOMPurify's own internal `_initDocument` -- allocates a full jsdom
// `Document` (History, Location, CookieJar, resource loader, …) that a
// heap-snapshot diff showed is never reclaimed within one jsdom window's
// lifetime, even after an explicit `global.gc()`: call count in, live
// `DocumentImpl` count out, 1:1. A single in-process run over the ~20k-field
// corpus therefore has GC cost growing with the (unboundedly growing) heap,
// which is what turned a budgeted 2-5 minute gate into a 21+ minute run that
// never finished. Restarting the process periodically resets that heap to
// zero cost and is the only lever available here: the leak is inside jsdom
// itself, not this module or DOMPurify's sanitising logic, so it cannot be
// fixed by changing the renderer -- and changing the renderer is exactly
// what G5 exists to catch. Each shard is a plain re-invocation of this same
// spec (`SAT_SHARD_INDEX`/`SAT_SHARD_TOTAL` select its row slice); the
// orchestrator (no shard env set) spawns them, merges their per-shard
// reports into the same `g5-report.json` shape as a single-process run, and
// asserts on the merged result. `checkField` itself -- the actual gate
// logic -- is untouched.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import type { RemovedAttribute, RemovedElement } from "dompurify";
import {
  type DroppedStyleBlock,
  normalizeSatHtml,
  sanitizeSatHtml,
  satPurify,
} from "./sat-html";

interface AnswerOption {
  label: string;
  content: string;
}

interface BankQuestion {
  question_id: string;
  stimulus?: string | null;
  stem: string;
  answer_options?: AnswerOption[];
  rationale: string;
}

interface BankRow {
  question: BankQuestion;
  aliases?: string[];
}

/** Reviewed exceptions, keyed `questionId:field:kind:name` -- the exact
 * `(RemovedDetail.kind, RemovedDetail.name)` pair DOMPurify is expected to
 * trim from that field, not merely "this field had something removed"
 * (G5 audit, 2026-09-20 -- see artifacts/sat-practice/g5-report.json's
 * `categorySummary` for the full breakdown this list was adjudicated from).
 * Keying on the specific removal means a field can be exempted for one
 * reviewed kind of removal while staying sensitive to any *other* kind: if
 * a bank refresh starts stripping something new from an already-exempted
 * field, that new detail's key won't be in this set and the gate still
 * fails on it (pinned in `sat-html.corpus.test.ts`'s own tests below).
 *
 * The 212 `stem`/`rationale`/`option` entries below all fail for the same
 * single reason: an HTML comment (`<!-- … -->`) in the raw field, e.g.
 * a label naming an SVG figure's variables for a human editor, or a
 * "Note: Figure not drawn to scale." aside. Comments are never rendered by
 * any browser, sanitised or not -- removing one changes nothing a student
 * sees, because it was already invisible before DOMPurify touched it.
 * Verified against the raw bank content, not assumed from the tag name. */
const REMOVAL_IGNORE_LIST = new Set<string>([
  "0013adbd:stem:element:#comment",
  "02c67921:stem:element:#comment",
  "03a16790:stem:element:#comment",
  "053e5e9f:stem:element:#comment",
  "05bb1af9:stem:element:#comment",
  "096c7ef5:stem:element:#comment",
  "099526fc:stem:element:#comment",
  "09d21d79:stem:element:#comment",
  "0b221d05:stem:element:#comment",
  "0d3f51dc:stem:element:#comment",
  "0ea7ef01:stem:element:#comment",
  "1006cad7:stem:element:#comment",
  "13294295:stem:element:#comment",
  "13d9a1c3:rationale:element:#comment",
  "1429dcdf:stem:element:#comment",
  "145337bc:stem:element:#comment",
  "15ce8207:option:A:element:#comment",
  "15ce8207:option:B:element:#comment",
  "15ce8207:option:C:element:#comment",
  "15ce8207:option:D:element:#comment",
  "15ce8207:stem:element:#comment",
  "16988f9c:stem:element:#comment",
  "18ac8354:stem:element:#comment",
  "197bed38:stem:element:#comment",
  "1a1a95de:stem:element:#comment",
  "1b2b20b9:stem:element:#comment",
  "1bf809b5:stem:element:#comment",
  "1ee962ec:stem:element:#comment",
  "24a1e6a7:stem:element:#comment",
  "252a3b3a:stem:element:#comment",
  "25da87f8:rationale:element:#comment",
  "263f9937:rationale:element:#comment",
  "26f5269a:stem:element:#comment",
  "27f5fff3:stem:element:#comment",
  "2937ef4f:rationale:element:#comment",
  "295a41f0:stem:element:#comment",
  "2adbf1b1:stem:element:#comment",
  "2b6c12eb:stem:element:#comment",
  "2bddbc1b:stem:element:#comment",
  "2d394c28:stem:element:#comment",
  "2e0290c3:stem:element:#comment",
  "2e74e403:stem:element:#comment",
  "2e8027b0:stem:element:#comment",
  "2ecce641:stem:element:#comment",
  "2f4eafcc:stem:element:#comment",
  "3174f07d:stem:element:#comment",
  "33e4af6b:stem:element:#comment",
  "36200a38:rationale:element:#comment",
  "36661021:stem:element:#comment",
  "38525983:stem:element:#comment",
  "39aa146d:stem:element:#comment",
  "3b44439b:stem:element:#comment",
  "3b4b5b1e:stem:element:#comment",
  "3de7a7d7:rationale:element:#comment",
  "3f5a3602:stem:element:#comment",
  "3f8d5876:stem:element:#comment",
  "415ab1d2:stem:element:#comment",
  "43236565:stem:element:#comment",
  "494d247d:stem:element:#comment",
  "4a141e77:stem:element:#comment",
  "4acd05cd:stem:element:#comment",
  "4b06557b:stem:element:#comment",
  "4c774b00:stem:element:#comment",
  "4ca30186:stem:element:#comment",
  "4cc05491:stem:element:#comment",
  "4d037075:stem:element:#comment",
  "4fbffc0a:stem:element:#comment",
  "50418728:stem:element:#comment",
  "50b2807e:stem:element:#comment",
  "52f7b898:stem:element:#comment",
  "5377d9cf:rationale:element:#comment",
  "53d97af5:rationale:element:#comment",
  "58687a66:stem:element:#comment",
  "59a49431:stem:element:#comment",
  "5b7599a6:stem:element:#comment",
  "5b918ebb:stem:element:#comment",
  "5c7d5744:stem:element:#comment",
  "5cf1bbc9:stem:element:#comment",
  "5f07b257:stem:element:#comment",
  "5f10c095:stem:element:#comment",
  "5f3ee607:stem:element:#comment",
  "5f46fc76:stem:element:#comment",
  "60fdb4d4:rationale:element:#comment",
  "632cf8f9:stem:element:#comment",
  "64c1f044:stem:element:#comment",
  "659cb706:stem:element:#comment",
  "66bce0c1:rationale:element:#comment",
  "686b5212:stem:element:#comment",
  "69f4bbdc:stem:element:#comment",
  "6abec9a8:stem:element:#comment",
  "6d8ad460:stem:element:#comment",
  "71189542:rationale:element:#comment",
  "7160cbb3:stem:element:#comment",
  "720e51ac:stem:element:#comment",
  "75a32330:option:A:element:#comment",
  "75a32330:option:B:element:#comment",
  "75a32330:option:C:element:#comment",
  "75a32330:option:D:element:#comment",
  "782a8a53:stem:element:#comment",
  "789975b7:rationale:element:#comment",
  "79e6ec70:stem:element:#comment",
  "7b52985c:stem:element:#comment",
  "7bd10ef3:rationale:element:#comment",
  "7fe7cf26:option:A:element:#comment",
  "7fe7cf26:option:B:element:#comment",
  "7fe7cf26:option:C:element:#comment",
  "7fe7cf26:option:D:element:#comment",
  "7fe7cf26:stem:element:#comment",
  "82dfb646:rationale:element:#comment",
  "8364487a:stem:element:#comment",
  "8368afd1:stem:element:#comment",
  "869a32f1:rationale:element:#comment",
  "87a9a2d4:stem:element:#comment",
  "893c7519:stem:element:#comment",
  "8baf2118:stem:element:#comment",
  "8d63b6f1:stem:element:#comment",
  "8e7689e0:stem:element:#comment",
  "8eb0e19e:stem:element:#comment",
  "90ba8f98:stem:element:#comment",
  "912cd125:rationale:element:#comment",
  "930c2990:stem:element:#comment",
  "94f7c9e2:stem:element:#comment",
  "95d1c344:stem:element:#comment",
  "9823f279:stem:element:#comment",
  "9afe2370:rationale:element:#comment",
  "9b0a4eae:stem:element:#comment",
  "9b7a1b67:stem:element:#comment",
  "9bb4107c:stem:element:#comment",
  "9bf4c545:rationale:element:#comment",
  "9d0396d4:stem:element:#comment",
  "9d078710:stem:element:#comment",
  "9ff88bb5:stem:element:#comment",
  "a4c05a1b:stem:element:#comment",
  "a4ed5285:stem:element:#comment",
  "a6097ec2:stem:element:#comment",
  "a67b9f88:stem:element:#comment",
  "a6dbad6b:stem:element:#comment",
  "a71617d3:stem:element:#comment",
  "aa95fb33:option:A:element:#comment",
  "aa95fb33:option:B:element:#comment",
  "aa95fb33:option:C:element:#comment",
  "aa95fb33:option:D:element:#comment",
  "aa95fb33:stem:element:#comment",
  "ad376f1a:stem:element:#comment",
  "ad7dbb22:stem:element:#comment",
  "ae32cc3c:stem:element:#comment",
  "af142f8d:rationale:element:#comment",
  "afa3c48b:stem:element:#comment",
  "b0c5ece5:stem:element:#comment",
  "b0fc3166:stem:element:#comment",
  "b2528e6b:stem:element:#comment",
  "b58dbf88:stem:element:#comment",
  "b5c43226:stem:element:#comment",
  "b8fa27db:stem:element:#comment",
  "c10ad793:stem:element:#comment",
  "c141366d:stem:element:#comment",
  "c307283c:stem:element:#comment",
  "c41e5688:stem:element:#comment",
  "c5082ce3:rationale:element:#comment",
  "c5ee6ac0:stem:element:#comment",
  "c81b6c57:rationale:element:#comment",
  "c9355dec:stem:element:#comment",
  "c99d154a:stem:element:#comment",
  "c9f8d1e9:stem:element:#comment",
  "ca4ee54e:stem:element:#comment",
  "cab8f907:stem:element:#comment",
  "cc2601cb:stem:element:#comment",
  "cc6ccd71:stem:element:#comment",
  "ccc3ad6b:stem:element:#comment",
  "cef0eada:stem:element:#comment",
  "cf0d3050:stem:element:#comment",
  "d02193fb:stem:element:#comment",
  "d0cb49e8:stem:element:#comment",
  "d0e8e8f5:stem:element:#comment",
  "d112bc9d:stem:element:#comment",
  "d11910d6:stem:element:#comment",
  "d21270da:stem:element:#comment",
  "d230e963:stem:element:#comment",
  "d3f7c429:stem:element:#comment",
  "d45572cc:stem:element:#comment",
  "d7bf55e1:rationale:element:#comment",
  "d9d83c02:rationale:element:#comment",
  "db888cd6:stem:element:#comment",
  "dd4ab4c4:rationale:element:#comment",
  "de550be0:stem:element:#comment",
  "de9148c4:stem:element:#comment",
  "e117d3b8:rationale:element:#comment",
  "e166aca6:stem:element:#comment",
  "e17babed:stem:element:#comment",
  "e1ad3d41:stem:element:#comment",
  "e6545fa8:stem:element:#comment",
  "e6f2ace7:stem:element:#comment",
  "e9129a5c:stem:element:#comment",
  "e9349667:rationale:element:#comment",
  "e9aed539:option:A:element:#comment",
  "e9aed539:option:B:element:#comment",
  "e9aed539:option:C:element:#comment",
  "e9aed539:option:D:element:#comment",
  "e9aed539:stem:element:#comment",
  "eb70d2d0:stem:element:#comment",
  "ecc98c87:stem:element:#comment",
  "eeebe166:stem:element:#comment",
  "f0773a55:stem:element:#comment",
  "f123e039:stem:element:#comment",
  "f1251f35:stem:element:#comment",
  "f1fa0821:stem:element:#comment",
  "f2f3fa00:rationale:element:#comment",
  "f40552a9:stem:element:#comment",
  "f547a8b1:stem:element:#comment",
  "f6b055dc:stem:element:#comment",
  "f89e1d6f:rationale:element:#comment",
  "fb866265:stem:element:#comment",
  // Source-data typo: the raw field literally contains `<p style="…"s>` --
  // a stray `s` character before the closing angle bracket -- so the HTML
  // parser reads it as a bare boolean attribute named `s` on the <p>. Not a
  // real attribute of any kind; removing it changes nothing about the
  // rendered paragraph text.
  "3566120b:stimulus:attribute:s",
  // `<itembody>` is an inert QTI wrapper tag with no attributes and no
  // matching CSS selector -- DOMPurify unwraps it and keeps every child
  // node (verified: sanitizing `<itembody><div>x</div></itembody>` yields
  // `<div>x</div>`), so nothing a student would see is lost.
  "6670e407:stem:element:itembody",
  // A bare, empty `<mo></mo>` sitting between two sibling `<math>` elements
  // (not inside a <math> ancestor itself) -- an artifact of the upstream
  // markup, not meaningful content. It has no text node, so even kept it
  // renders nothing; outside a MathML namespace context a browser would not
  // treat it as an operator glyph either way.
  "deee9063:rationale:element:mo",

]);

interface FieldFailure {
  questionId: string;
  field: string;
  reasons: string[];
  removedDetails: RemovedDetail[];
}

/** What `DOMPurify.removed` actually is (element removal or attribute
 * removal), reduced to a JSON-safe shape for the report: `kind` + the
 * removed tag/attribute name, plus enough surrounding markup to judge
 * whether a student loses anything. Task 1 of the G5 audit: the prior
 * report recorded only a count, which is not adjudicable. */
interface RemovedDetail {
  kind: "element" | "attribute" | "style-block";
  /** Tag name for an element, attribute name for an attribute, drop reason
   * for a style-block (the figure-style rewrite's own hook removals --
   * these never appear in DOMPurify's own `removed` list, §6.2). */
  name: string;
  /** The parent/host element's tag name, for context. */
  parentTag: string | null;
  /** A bounded snippet of the surrounding markup. */
  snippet: string;
}

const SNIPPET_MAX_LEN = 200;

function snippetOf(node: Node | null): string {
  if (!node) return "";
  const html =
    node.nodeType === Node.ELEMENT_NODE
      ? (node as Element).outerHTML
      : (node.textContent ?? "");
  return html.length > SNIPPET_MAX_LEN ? `${html.slice(0, SNIPPET_MAX_LEN)}…` : html;
}

function describeRemoved(entries: Array<RemovedElement | RemovedAttribute>): RemovedDetail[] {
  return entries.map((entry) => {
    if ("element" in entry) {
      const el = entry.element;
      const parent = el.parentNode;
      return {
        kind: "element" as const,
        name:
          el.nodeType === Node.ELEMENT_NODE
            ? (el as Element).tagName.toLowerCase()
            : el.nodeType === Node.COMMENT_NODE
              ? "#comment"
              : `#node-${el.nodeType}`,
        parentTag:
          parent && parent.nodeType === Node.ELEMENT_NODE
            ? (parent as Element).tagName.toLowerCase()
            : null,
        snippet: snippetOf(el),
      };
    }
    const attr = entry.attribute;
    const from = entry.from;
    return {
      kind: "attribute" as const,
      name: attr?.name ?? "(unknown)",
      parentTag:
        from && from.nodeType === Node.ELEMENT_NODE
          ? (from as Element).tagName.toLowerCase()
          : null,
      snippet: snippetOf(from) || (attr ? `${attr.name}="${attr.value}"` : ""),
    };
  });
}

function fieldsOf(question: BankQuestion): Array<[string, string | null | undefined]> {
  const fields: Array<[string, string | null | undefined]> = [
    ["stimulus", question.stimulus],
    ["stem", question.stem],
    ["rationale", question.rationale],
  ];
  for (const option of question.answer_options ?? []) {
    fields.push([`option:${option.label}`, option.content]);
  }
  return fields;
}

function urlIssues(html: string): string[] {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const issues: string[] = [];

  for (const el of Array.from(doc.querySelectorAll("[src]"))) {
    const src = el.getAttribute("src") ?? "";
    if (/^https?:/i.test(src)) {
      issues.push(`src is http(s): ${src}`);
    } else if (/^data:/i.test(src)) {
      const isImgDataUri =
        el.tagName.toLowerCase() === "img" &&
        /^data:image\/(png|jpe?g|gif)/i.test(src);
      if (!isImgDataUri) {
        issues.push(`bad data: URI on <${el.tagName.toLowerCase()}>: ${src.slice(0, 32)}`);
      }
    }
  }

  // `xlink:href`'s colon is not a valid bare attribute-selector character
  // (jsdom's selector parser reads it as a pseudo-class), so both
  // attributes are checked by walking every element instead of by
  // `querySelectorAll("[xlink:href]")`.
  for (const el of Array.from(doc.querySelectorAll("*"))) {
    for (const attr of ["href", "xlink:href"]) {
      if (!el.hasAttribute(attr)) continue;
      const value = el.getAttribute(attr) ?? "";
      if (/^https?:/i.test(value)) {
        issues.push(`${attr} is http(s): ${value}`);
      }
    }
  }

  for (const el of Array.from(doc.querySelectorAll("[style]"))) {
    const style = el.getAttribute("style") ?? "";
    if (/url\(/i.test(style)) {
      issues.push(`style attribute retains url(: ${style}`);
    }
  }

  if (doc.querySelector("script")) {
    issues.push("a <script> tag survived sanitisation");
  }

  for (const styleEl of Array.from(doc.querySelectorAll("style"))) {
    if (!styleEl.closest("svg")) {
      issues.push("a <style> tag survived outside an <svg>");
    }
  }

  return issues;
}

/** Every `(questionId, field)` this run actually matched against
 * `REMOVAL_IGNORE_LIST` -- i.e. really did have something removed, but was
 * a reviewed, documented exception (Task 3: this list is honesty evidence
 * for AUDIT.md, not a silent pass). Reset per `checkRows` call. */
let ignoredFieldKeys: string[] = [];

/** `REMOVAL_IGNORE_LIST` key for one specific removed detail -- the
 * granularity that lets an exemption cover only the reviewed kind of
 * removal, not "anything removed from this field" (see the list's own
 * doc comment above). */
function removalIgnoreKey(
  questionId: string,
  field: string,
  detail: Pick<RemovedDetail, "kind" | "name">,
): string {
  return `${questionId}:${field}:${detail.kind}:${detail.name}`;
}

function checkField(
  questionId: string,
  field: string,
  raw: string,
): FieldFailure | null {
  const normalized = normalizeSatHtml(raw);
  const { html, droppedStyleBlocks } = sanitizeSatHtml(normalized);
  const removed = [...satPurify.removed];

  const allDetails: RemovedDetail[] = [
    ...describeRemoved(removed),
    ...droppedStyleBlocks.map((b: DroppedStyleBlock) => ({
      kind: "style-block" as const,
      name: b.reason,
      parentTag: "svg",
      snippet:
        b.css.length > SNIPPET_MAX_LEN
          ? `${b.css.slice(0, SNIPPET_MAX_LEN)}…`
          : b.css,
    })),
  ];

  // Partition per detail, not per field: a field exempted for one reviewed
  // removal still fails on any *other* kind or name of removal.
  const removedDetails: RemovedDetail[] = [];
  for (const detail of allDetails) {
    const key = removalIgnoreKey(questionId, field, detail);
    if (REMOVAL_IGNORE_LIST.has(key)) {
      ignoredFieldKeys.push(key);
    } else {
      removedDetails.push(detail);
    }
  }

  const reasons: string[] = [];
  const unreviewedRemoved = removedDetails.filter((d) => d.kind !== "style-block");
  const unreviewedDropped = removedDetails.filter(
    (d): d is RemovedDetail & { kind: "style-block" } => d.kind === "style-block",
  );
  if (unreviewedRemoved.length > 0) {
    reasons.push(`DOMPurify removed ${unreviewedRemoved.length} node(s)/attribute(s)`);
  }
  if (unreviewedDropped.length > 0) {
    reasons.push(
      `figure-style rewrite dropped ${unreviewedDropped.length} block(s): ` +
        unreviewedDropped.map((d) => d.name).join(", "),
    );
  }
  reasons.push(...urlIssues(html));

  return reasons.length > 0 ? { questionId, field, reasons, removedDetails } : null;
}

interface CategorySummaryEntry {
  kind: RemovedDetail["kind"];
  name: string;
  instanceCount: number;
  fieldCount: number;
  sampleQuestionIds: string[];
  sampleSnippet: string;
}

/** Task 1's categorised breakdown: groups every removed detail across the
 * whole run by `(kind, name)` so the 218 field-level failures reduce to a
 * short, adjudicable list of distinct removal categories (Task 2). */
function summarizeCategories(failures: FieldFailure[]): CategorySummaryEntry[] {
  const byKey = new Map<
    string,
    { kind: RemovedDetail["kind"]; name: string; instanceCount: number; questionIds: Set<string>; sampleSnippet: string }
  >();
  for (const failure of failures) {
    for (const detail of failure.removedDetails) {
      const key = `${detail.kind}:${detail.name}`;
      let entry = byKey.get(key);
      if (!entry) {
        entry = {
          kind: detail.kind,
          name: detail.name,
          instanceCount: 0,
          questionIds: new Set(),
          sampleSnippet: detail.snippet,
        };
        byKey.set(key, entry);
      }
      entry.instanceCount += 1;
      entry.questionIds.add(failure.questionId);
    }
  }
  return [...byKey.values()]
    .map((entry) => ({
      kind: entry.kind,
      name: entry.name,
      instanceCount: entry.instanceCount,
      fieldCount: entry.questionIds.size,
      sampleQuestionIds: [...entry.questionIds].slice(0, 5),
      sampleSnippet: entry.sampleSnippet,
    }))
    .sort((a, b) => b.instanceCount - a.instanceCount);
}

function readBank(bankPath: string): BankRow[] {
  const gz = readFileSync(bankPath);
  const jsonl = gunzipSync(gz).toString("utf-8");
  return jsonl
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BankRow);
}

const bankPath = process.env.SAT_BANK_PATH
  ? path.resolve(process.cwd(), process.env.SAT_BANK_PATH)
  : undefined;
const bankAvailable = Boolean(bankPath && existsSync(bankPath));

/** Checks a slice of rows, returning the same shape a full unsharded run
 * would for that slice. Pure with respect to `checkField` -- shared by the
 * orchestrator (unsharded fallback) and every shard's own worker run. */
function checkRows(
  rows: BankRow[],
): { fieldCount: number; failures: FieldFailure[]; ignoredFieldKeys: string[] } {
  let fieldCount = 0;
  const failures: FieldFailure[] = [];
  ignoredFieldKeys = [];
  for (const row of rows) {
    for (const [field, raw] of fieldsOf(row.question)) {
      if (!raw) continue;
      fieldCount += 1;
      const failure = checkField(row.question.question_id, field, raw);
      if (failure) failures.push(failure);
    }
  }
  return { fieldCount, failures, ignoredFieldKeys };
}

/** Rows per shard process (plan §8.3 "a stated limit", extended by the note
 * atop this file): kept well under the row count where jsdom's per-Document
 * retention starts dominating wall-clock, so each shard's own process stays
 * in the fast regime and is then discarded, taking its retained heap with
 * it. Tuned empirically (see the AUDIT.md entry this run writes), not a
 * value a product decision would ever change -- inline, not a Settings key. */
const SHARD_BATCH_ROWS = 400;
const REPORT_DIR = path.resolve(process.cwd(), "../artifacts/sat-practice");

interface ShardReport {
  fieldCount: number;
  failures: FieldFailure[];
  ignoredFieldKeys: string[];
}

// Gate-integrity regression (2026-09-20): `REMOVAL_IGNORE_LIST` used to be
// keyed only on `questionId:field`, so exempting a field for one reviewed
// removal (an HTML comment) silently exempted it from *any* removal —
// a future different removal on that same field would never fail the
// gate. Not gated by `bankAvailable`: `checkField` needs no bank file.
describe("REMOVAL_IGNORE_LIST granularity", () => {
  it("does not exempt a different kind of removal on an already-exempted field", () => {
    // "0013adbd:stem" is exempted only for `element:#comment`.
    const commentOnly = checkField(
      "0013adbd",
      "stem",
      "<p>Text<!-- a label for a human editor --></p>",
    );
    expect(commentOnly).toBeNull();

    // The same field id/name, but this time with a removal that isn't the
    // reviewed one (an `onclick` handler attribute, not a comment). A
    // field-level key would have swallowed this; the per-detail key must not.
    const differentRemoval = checkField(
      "0013adbd",
      "stem",
      '<div onclick="x()">Text</div>',
    );
    expect(differentRemoval).not.toBeNull();
    expect(differentRemoval?.removedDetails).toContainEqual(
      expect.objectContaining({ kind: "attribute", name: "onclick" }),
    );
  });
});

const shardIndex = process.env.SAT_SHARD_INDEX ? Number(process.env.SAT_SHARD_INDEX) : undefined;
const shardTotal = process.env.SAT_SHARD_TOTAL ? Number(process.env.SAT_SHARD_TOTAL) : undefined;
const isShardWorker = shardIndex !== undefined && shardTotal !== undefined;

describe.skipIf(!bankAvailable)("G5 render gate — the full bank corpus", () => {
  if (isShardWorker) {
    // Worker mode: check this shard's row slice and write its own partial
    // report. The orchestrator (below) makes the pass/fail call over the
    // merged result, so a worker never asserts on its own findings.
    it(`shard ${shardIndex}/${shardTotal}`, { timeout: 600_000 }, () => {
      const rows = readBank(bankPath as string);
      const start = shardIndex! * SHARD_BATCH_ROWS;
      const slice = rows.slice(start, start + SHARD_BATCH_ROWS);
      const { fieldCount, failures, ignoredFieldKeys: ignored } = checkRows(slice);
      mkdirSync(REPORT_DIR, { recursive: true });
      const report: ShardReport = { fieldCount, failures, ignoredFieldKeys: ignored };
      writeFileSync(path.join(REPORT_DIR, `g5-shard-${shardIndex}.json`), JSON.stringify(report));
    });
    return;
  }

  it(
    "normalizes + sanitises every field with nothing unreviewed removed",
    { timeout: 600_000 },
    () => {
      const start = Date.now();
      const rows = readBank(bankPath as string);
      const shardCount = Math.max(1, Math.ceil(rows.length / SHARD_BATCH_ROWS));
      const vitestBin = path.resolve(process.cwd(), "node_modules/.bin/vitest");
      const thisSpec = path.relative(
        process.cwd(),
        new URL(import.meta.url).pathname,
      );

      mkdirSync(REPORT_DIR, { recursive: true });
      const shardReportPaths: string[] = [];
      for (let i = 0; i < shardCount; i++) {
        const reportPath = path.join(REPORT_DIR, `g5-shard-${i}.json`);
        rmSync(reportPath, { force: true });
        shardReportPaths.push(reportPath);
        // A fresh `vitest run` process per shard is the fix, not an
        // optimisation of `checkField` itself (see the file header): each
        // process gets a fresh jsdom window, so the per-Document retention
        // never accumulates past `SHARD_BATCH_ROWS` worth of calls.
        execFileSync(
          vitestBin,
          ["run", thisSpec, "--reporter=dot"],
          {
            cwd: process.cwd(),
            env: {
              ...process.env,
              SAT_SHARD_INDEX: String(i),
              SAT_SHARD_TOTAL: String(shardCount),
            },
            stdio: "pipe",
          },
        );
      }

      let fieldCount = 0;
      const failures: FieldFailure[] = [];
      const ignoredFieldKeysMerged: string[] = [];
      for (const reportPath of shardReportPaths) {
        const shard = JSON.parse(readFileSync(reportPath, "utf-8")) as ShardReport;
        fieldCount += shard.fieldCount;
        failures.push(...shard.failures);
        ignoredFieldKeysMerged.push(...shard.ignoredFieldKeys);
        rmSync(reportPath, { force: true });
      }

      const durationMs = Date.now() - start;
      writeFileSync(
        path.join(REPORT_DIR, "g5-report.json"),
        JSON.stringify(
          {
            rows: rows.length,
            fieldsChecked: fieldCount,
            durationMs,
            shardCount,
            shardBatchRows: SHARD_BATCH_ROWS,
            failureCount: failures.length,
            categorySummary: summarizeCategories(failures),
            // Task 3 honesty evidence: fields DOMPurify *did* remove
            // something from, but a reviewed `REMOVAL_IGNORE_LIST` entry
            // (with its reason) explains why nothing a student sees is
            // lost -- so AUDIT.md can state the reviewed-exception count
            // rather than implying a clean run removed nothing at all.
            reviewedIgnoredCount: ignoredFieldKeysMerged.length,
            failures,
          },
          null,
          2,
        ),
      );

      expect(failures).toEqual([]);
    },
  );
});
