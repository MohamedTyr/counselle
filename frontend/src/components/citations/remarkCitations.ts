/**
 * remarkCitations — finds `[n]` markers (1–2 digits) in mdast TEXT nodes and
 * replaces them with `citationRef` nodes rendered as <citation-ref index={n}>
 * (PRD story 19 — chips materialize as the text streams).
 *
 * Only `text` nodes are visited, so `code` / `inlineCode` content is never
 * touched (their values live outside text nodes). The consumer registers
 * `{ 'citation-ref': InlineCitationMarkdown }` (markdownConfig.ts) in the
 * react-markdown components map.
 */
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import { visit } from 'unist-util-visit';
import type { Parent, Root, Text } from 'mdast';
import type { Node } from 'unist';
import type { SourceEntry } from '@/api/protocol';
import { isDbSource } from '@/components/citations/sourceName';

const CITATION_PATTERN = /\[(\d{1,2})\]/g;

/**
 * The shared mdast parser the cited-index scan uses — the same `remark` /
 * `remarkGfm` base the renderer parses with, so the scan and the render agree on
 * what a `text` node is. (The supersub plugin doesn't affect `[n]` detection, so
 * it's omitted here.)
 */
const parser = unified().use(remarkParse).use(remarkGfm);

/**
 * The `[n]` indexes cited in a block of markdown — the SAME grammar the
 * inline-chip transform uses (single-sourced here so they can't drift). Used by
 * the sources footer/panel/strip to filter to only the sources this message
 * cited (wire-contract §5, PINNED).
 *
 * Scans the parsed mdast and visits ONLY `text` nodes, so a `[7]` inside
 * `code` / `inlineCode` is skipped — the renderer's `remarkCitations` plugin
 * already excludes those, so the footer/panel must too (FE-DUP-CITED-SCAN). A
 * `[n]` in a code fence is NOT a citation, and must never inflate the source set.
 */
export function citedIndexesIn(text: string): Set<number> {
  const indexes = new Set<number>();
  const tree = parser.parse(text);
  visit(tree, 'text', (node: Text) => {
    // `matchAll` is stateless on a fresh string, so the shared `/g` pattern's
    // lastIndex doesn't leak between nodes.
    for (const m of node.value.matchAll(CITATION_PATTERN)) {
      indexes.add(Number(m[1]));
    }
  });
  return indexes;
}

/**
 * The union of `[n]` markers across an assistant message — its markdown blocks
 * when the turn reducer has produced them, else the raw streamed text. Viz cells
 * contribute nothing (cards carry their own per-cell popovers). Single-sourced
 * here so the sources strip and panel can't drift from the inline-chip grammar
 * (wire-contract §5, PINNED).
 */
export function citedIndexesForMessage(
  blocks: ReadonlyArray<{ kind: string; text?: string }> | undefined,
  fallbackText: string,
): Set<number> {
  if (blocks !== undefined) {
    const indexes = new Set<number>();
    for (const block of blocks) {
      if (block.kind === 'markdown' && block.text !== undefined) {
        for (const i of citedIndexesIn(block.text)) {
          indexes.add(i);
        }
      }
    }
    return indexes;
  }
  return citedIndexesIn(fallbackText);
}

/**
 * feat/message-ui-polish: the prose `[n]` indices of an assistant message that
 * resolve to a DB source (cds/ipeds/scorecard). It reuses the EXACT scan path of
 * `citedIndexesForMessage` (content blocks, else the `text` fallback) so the
 * reveal toggle's visibility is identical between the streaming and completed
 * states, then intersects with the message's DB-source entries.
 *
 * Used ONLY for the action-row reveal-toggle visibility gate (behavior 7) — not
 * in the markdown parse.
 */
export function dbIndicesForMessage(message: {
  content?: ReadonlyArray<{ kind: string; text?: string }>;
  text?: string;
  sources?: ReadonlyArray<SourceEntry>;
}): Set<number> {
  const cited = citedIndexesForMessage(message.content, message.text ?? '');
  const out = new Set<number>();
  for (const entry of message.sources ?? []) {
    if (cited.has(entry.index) && isDbSource(entry.citation.source)) {
      out.add(entry.index);
    }
  }
  return out;
}

/**
 * feat/message-ui-polish: the message's cited source entries — the subset of
 * `message.sources` whose index appears in the prose `[n]` grammar. Single-
 * sourced here (shared by MessageSources' strip/panel and MessageContent's
 * inline-pill activate handler) so the two can never disagree about which
 * sources an answer used.
 */
export function citedSourcesForMessage(message: {
  content?: ReadonlyArray<{ kind: string; text?: string }>;
  text?: string;
  sources?: ReadonlyArray<SourceEntry>;
}): SourceEntry[] {
  const sources = message.sources ?? [];
  if (sources.length === 0) {
    return [];
  }
  const indexes = citedIndexesForMessage(message.content, message.text ?? '');
  return sources.filter((s) => indexes.has(s.index));
}

/**
 * The DB source entries an answer actually used — DB facts carry NO inline
 * `[n]` (figures live in viz cards / the panel), so DB inclusion is derived
 * from the authoritative signals, NOT the prose `[n]` scan: (a) any viz block,
 * or (b) any DB-class source entry on the message. Returns the DB SourceEntry
 * subset (may be empty). Single-sourced so the strip count, panel header,
 * panel card, and dbSchools cannot disagree (honesty — FE-H4).
 */
export function dbSourcesForMessage(message: {
  content?: ReadonlyArray<{ kind: string }>;
  sources?: ReadonlyArray<SourceEntry>;
}): SourceEntry[] {
  const dbEntries = (message.sources ?? []).filter((s) => isDbSource(s.citation.source));
  if (dbEntries.length > 0) {
    return dbEntries;
  }
  // No DB SourceEntry rows. A viz-only answer still USED Counselle data, but it
  // has no per-row source entries to render in the panel — the card's existence
  // is driven by `usedDbData()` (the boolean) and its school names by
  // `dbSchoolsForMessage` (the viz blocks), NOT by source entries. So there are
  // simply no DB rows to return here.
  return [];
}

/** Did this answer use Counselle's own data? (viz card OR a DB source entry.) */
export function usedDbData(message: {
  content?: ReadonlyArray<{ kind: string }>;
  sources?: ReadonlyArray<SourceEntry>;
}): boolean {
  if ((message.sources ?? []).some((s) => isDbSource(s.citation.source))) {
    return true;
  }
  return (message.content ?? []).some((b) => b.kind === 'viz');
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
