/**
 * remarkCitations — finds `[n]` markers (1–2 digits) in mdast TEXT nodes and
 * replaces them with `citationRef` nodes rendered as <citation-ref index={n}>
 * (PRD story 19 — chips materialize as the text streams).
 *
 * Only `text` nodes are visited, so `code` / `inlineCode` content is never
 * touched (their values live outside text nodes). The consumer registers
 * `{ 'citation-ref': CitationRefMarkdown }` in the react-markdown
 * components map.
 */
import { createElement } from 'react';
import type { Parent, Root, Text } from 'mdast';
import type { Node } from 'unist';
import CitationRef from '@/components/citations/CitationRef';

const CITATION_PATTERN = /\[(\d{1,2})\]/g;

/**
 * The set of citation-marker indexes cited in a block of text — the SAME grammar
 * the inline-chip transform uses (single-sourced here so they can't drift).
 * Used by the sources footer to filter to only the sources this message cited
 * (wire-contract §5, PINNED). Scans plain markdown source — exact enough for the
 * footer (a `[7]` inside a code fence over-counts at worst, never under-counts).
 */
export function citedIndexesIn(text: string): Set<number> {
  const indexes = new Set<number>();
  for (const match of text.matchAll(CITATION_PATTERN)) {
    indexes.add(Number(match[1]));
  }
  return indexes;
}

type CitationRefNode = {
  type: 'citationRef';
  data: {
    hName: 'citation-ref';
    hProperties: { index: number };
  };
};

function makeCitationRefNode(index: number): CitationRefNode {
  return {
    type: 'citationRef',
    data: { hName: 'citation-ref', hProperties: { index } },
  };
}

/** Split one text node's value into text + citationRef nodes; null = no match. */
function splitTextNode(node: Text): Node[] | null {
  const value = node.value;
  if (!CITATION_PATTERN.test(value)) {
    return null;
  }
  CITATION_PATTERN.lastIndex = 0;

  const out: Node[] = [];
  let cursor = 0;
  for (const match of value.matchAll(CITATION_PATTERN)) {
    const start = match.index;
    if (start > cursor) {
      out.push({ type: 'text', value: value.slice(cursor, start) } as Text);
    }
    out.push(makeCitationRefNode(Number(match[1])) as unknown as Node);
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
export default function remarkCitations() {
  return (tree: Root) => {
    transform(tree);
  };
}

/**
 * The components-map entry for react-markdown:
 *   components={{ 'citation-ref': CitationRefMarkdown }}
 * react-markdown passes hProperties.index as a string or number — coerce.
 */
export function CitationRefMarkdown({ index }: { index: string | number }) {
  return createElement(CitationRef, { index: Number(index) });
}
