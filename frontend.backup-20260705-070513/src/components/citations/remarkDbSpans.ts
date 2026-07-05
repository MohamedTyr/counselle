/**
 * remarkDbSpans — wraps the clause each `[n]` citation annotates into a
 * `dbClaim` node, so the "show what's from Counselle" reveal can light up
 * exactly the prose a citation rests on.
 *
 * CRITICAL ordering: this plugin runs AFTER `remarkCitations`. By the time it
 * runs, every `[n]` in a text node has already been replaced by a `citationRef`
 * node (see remarkCitations.splitTextNode). So we do NOT scan text for `[n]` —
 * that would match nothing. Instead we walk parents and key off the
 * `citationRef` children remarkCitations produced.
 *
 * For each `citationRef`, its immediately-preceding text sibling already IS its
 * clause. We trim that sibling on the left to the LATER of (a) the last `.?!`
 * sentence boundary and (b) the last leftover `[…]` marker (a 3+-digit `[999]`
 * that remarkCitations' `\[(\d{1,2})\]` pattern did not capture, so it stayed as
 * literal text and belongs to a DIFFERENT — often external — source). So
 * `"X. Y "` → `"Y "`, and `"Source 999 … [999], Y "` → `"Y "`. The trailing
 * remainder is wrapped in a `dbClaim` node carrying `data.hProperties.index = n`;
 * the `citationRef` itself is left as a following sibling, never nested inside
 * the dbClaim.
 *
 * RESIDUAL LIMITATION (accepted, ADR 0006): a bare external attribution with NO
 * marker and NO sentence boundary in the same text node ("US News reports …
 * [1]") is NOT detectable here — there is no bracket to cut at, and the clause
 * text alone carries no machine signal that "US News reports" is external.
 * Bounding that case is the model's responsibility (attach a `[n]` to the
 * external claim, or don't co-mingle it into a DB-cited sentence); `DbClaim`'s
 * source gate (a clause lights only when its `[n]` resolves to a streamed DB
 * source) is the only backstop, and it guards against the wrong source CLASS,
 * not against co-mingled external PROSE under a DB index.
 *
 * The plugin is a plain, parameterless cached singleton: it wraps EVERY cited
 * clause unconditionally and stamps the index. Whether a wrapped clause actually
 * highlights is decided in `DbClaim` (React) from the live sources — the plugin
 * never decides DB-vs-external, so the toggle is a pure context re-render.
 *
 * Mirrors remarkCitations' style: depth-first walk, immutable child arrays,
 * never descends into code (it operates on the same node types remarkCitations
 * touches — text nodes are already split there; code/inlineCode carry no
 * citationRef children).
 */
import type { Parent, Root, Text } from 'mdast';
import type { Node } from 'unist';

/**
 * A sentence boundary: a `.?!` (optionally closed by a quote/bracket) followed
 * by whitespace. The trailing-whitespace requirement keeps a decimal point
 * ("12.5%") from being mistaken for a sentence end. The negative lookbehind on a
 * single uppercase letter keeps a one-letter abbreviation's dot ("U.S. ", the
 * "S." in it) from clipping the visible clause.
 */
const SENTENCE_BOUNDARY = /(?<![A-Z])[.?!]['")\]]*\s+/g;

type DbClaimNode = {
  type: 'dbClaim';
  data: { hName: 'db-claim'; hProperties: { index: number } };
  children: Text[];
};

function makeDbClaimNode(value: string, index: number): DbClaimNode {
  return {
    type: 'dbClaim',
    data: { hName: 'db-claim', hProperties: { index } },
    children: [{ type: 'text', value } as Text],
  };
}

function isCitationRef(node: Node): boolean {
  return node.type === 'citationRef';
}

function citationIndexOf(node: Node): number | null {
  const data = (node as { data?: { hProperties?: { index?: unknown } } }).data;
  const index = data?.hProperties?.index;
  return typeof index === 'number' ? index : null;
}

//: Any "[…]" the citation plugin left behind — e.g. a 3+-digit marker like
//: "[999]" that remarkCitations' `\[(\d{1,2})\]` pattern did not capture. Such
//: a leftover bracket belongs to a DIFFERENT (often external) source, so the
//: db-claim clause must not reach back across it.
const EMBEDDED_MARKER = /\[[^\]]*]\s*/g;

/**
 * The clause to wrap = the text after the LATER of (a) the last `.?!` sentence
 * boundary and (b) the last leftover `[…]` bracket. (a) keeps a db-claim from
 * swallowing a prior sentence; (b) closes the unmatched-multi-digit-marker
 * leak (a "[999]" the citation plugin left as text — see FE-C1 case 2). When
 * neither is present, the whole value is the clause.
 *
 * NOTE the deliberate limit: a bare external attribution with NO bracket and
 * NO sentence boundary ("US News reports … [1]") is undetectable here and is
 * the model's responsibility per ADR 0006 — see the header's residual note.
 */
function splitAtLastBoundary(value: string): { head: string; clause: string } {
  let cut = 0;
  SENTENCE_BOUNDARY.lastIndex = 0;
  for (const match of value.matchAll(SENTENCE_BOUNDARY)) {
    cut = Math.max(cut, match.index + match[0].length);
  }
  EMBEDDED_MARKER.lastIndex = 0;
  for (const match of value.matchAll(EMBEDDED_MARKER)) {
    cut = Math.max(cut, match.index + match[0].length);
  }
  if (cut <= 0 || cut >= value.length) {
    return { head: '', clause: value };
  }
  return { head: value.slice(0, cut), clause: value.slice(cut) };
}

/**
 * Walk a parent's children, wrapping the clause preceding each citationRef into
 * a dbClaim node. Returns a new children array (immutable), or null if nothing
 * changed.
 */
function wrapClauses(children: ReadonlyArray<Node>): Node[] | null {
  let changed = false;
  const out: Node[] = [];
  for (const child of children) {
    if (isCitationRef(child)) {
      const index = citationIndexOf(child);
      const prev = out[out.length - 1];
      // Invariant (FE-C1 Layer 2): the clause text for a citationRef never
      // reaches across a PRIOR citationRef, because remarkCitations already
      // split the text node at each `[n]` marker. So `prev` only ever holds
      // the text accumulated since the last marker — no runtime "don't cross a
      // prior citationRef" guard is needed; the split already guarantees it.
      if (index !== null && prev !== undefined && prev.type === 'text') {
        const { head, clause } = splitAtLastBoundary((prev as Text).value);
        if (clause.length > 0) {
          out.pop();
          if (head.length > 0) {
            out.push({ type: 'text', value: head } as Text);
          }
          out.push(makeDbClaimNode(clause, index) as unknown as Node);
          changed = true;
        }
      }
    }
    out.push(child);
  }
  return changed ? out : null;
}

/** Depth-first walk; wraps clauses at each parent (new arrays). */
function transform(node: Node): void {
  const parent = node as Parent;
  if (!Array.isArray(parent.children)) {
    return;
  }
  for (const child of parent.children) {
    transform(child);
  }
  const wrapped = wrapClauses(parent.children);
  if (wrapped) {
    parent.children = wrapped as Parent['children'];
  }
}

/** The remark plugin. */
export default function remarkDbSpans() {
  return (tree: Root) => {
    transform(tree);
  };
}
