/**
 * remarkDbClaim — finds `==claim==` spans in mdast TEXT nodes and replaces them
 * with `dbClaim` nodes rendered as <db-claim>…</db-claim>.
 *
 * This is the preview stand-in for the production span-inference layer. In the
 * real app, the spans are derived from the `[n]` markers whose source resolves
 * to our database (see remarkCitations); here we hand-author them so the look
 * and motion can be judged pixel-exact before that layer is wired. Same shape as
 * remarkCitations on purpose: one text-node split, one custom element, one
 * components-map renderer.
 *
 * Constraint: the inner text is plain (no nested markdown) — the highlight is
 * the emphasis, so DB claims in the sample carry no bold/links inside the `==`.
 */
import type { Parent, Root, Text } from 'mdast';
import type { Node } from 'unist';

const CLAIM_PATTERN = /==(.+?)==/g;

type DbClaimNode = {
  type: 'dbClaim';
  data: { hName: 'db-claim' };
  children: Text[];
};

function makeDbClaimNode(value: string): DbClaimNode {
  return {
    type: 'dbClaim',
    data: { hName: 'db-claim' },
    children: [{ type: 'text', value } as Text],
  };
}

/** Split one text node's value into text + dbClaim nodes; null = no match. */
function splitTextNode(node: Text): Node[] | null {
  const value = node.value;
  if (!CLAIM_PATTERN.test(value)) {
    return null;
  }
  CLAIM_PATTERN.lastIndex = 0;

  const out: Node[] = [];
  let cursor = 0;
  for (const match of value.matchAll(CLAIM_PATTERN)) {
    const start = match.index;
    if (start > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, start) } as Text);
    }
    out.push(makeDbClaimNode(match[1]) as unknown as Node);
    cursor = start + match[0].length;
  }
  if (cursor < value.length) {
    out.push({ type: 'text', value: value.slice(cursor) } as Text);
  }
  return out;
}

/** Depth-first walk replacing matching text children in place (new arrays). */
function transform(node: Node): void {
  const parent = node as Parent;
  if (!Array.isArray(parent.children)) {
    return;
  }
  const next: Node[] = [];
  for (const child of parent.children) {
    if (child.type === 'text') {
      const replaced = splitTextNode(child as Text);
      if (replaced) {
        next.push(...replaced);
        continue;
      }
    } else {
      transform(child);
    }
    next.push(child);
  }
  parent.children = next as Parent['children'];
}

/** The remark plugin. */
export default function remarkDbClaim() {
  return (tree: Root) => {
    transform(tree);
  };
}
