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
 * clause (any prior `citationRef` split the text, bounding the clause on the
 * left). We trim that sibling to the last `.?!` boundary within it — so
 * `"X. Y "` → `"Y "` — and wrap the trailing remainder in a `dbClaim` node
 * carrying `data.hProperties.index = n`. The `citationRef` itself is left as a
 * following sibling, never nested inside the dbClaim.
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

/**
 * Split a preceding text value into a leading remainder (everything up to and
 * including the last `.?!` boundary) and the trailing clause to wrap. When the
 * text has no boundary, the whole value is the clause.
 */
function splitAtLastBoundary(value: string): { head: string; clause: string } {
  SENTENCE_BOUNDARY.lastIndex = 0;
  let lastEnd = -1;
  for (const match of value.matchAll(SENTENCE_BOUNDARY)) {
    lastEnd = match.index + match[0].length;
  }
  if (lastEnd <= 0 || lastEnd >= value.length) {
    return { head: '', clause: value };
  }
  return { head: value.slice(0, lastEnd), clause: value.slice(lastEnd) };
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
