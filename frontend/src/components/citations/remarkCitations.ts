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
import type { CitationEnvelope, RenderSpec, SourceEntry } from '@/api/protocol';
import { uniqueSourceByIndex } from '@/components/citations/sourceIndex';
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
  // The `fallbackText` path is digit-scan-only for legacy entries without
  // `content` blocks; live turns always carry `content`. `fallbackText` comes
  // from `proseOf` (markdown blocks joined with `\n\n`, viz blocks elided), so it
  // does not reflect render order — fine here because we only collect which `[n]`
  // markers appear, never use this string for clause wrapping (FE-M6).
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
  for (const index of cited) {
    const entry = uniqueSourceByIndex(message.sources, index);
    if (entry !== undefined && isDbSource(entry.citation.source)) {
      out.add(index);
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
  return sources.filter(
    (source) => indexes.has(source.index) && uniqueSourceByIndex(sources, source.index) === source,
  );
}

function isDbVizCell(cell: CitationEnvelope | undefined): boolean {
  return cell?.available === true && isDbSource(cell.citation.source);
}

function renderedCellsForSourceSpec(spec: RenderSpec): Array<CitationEnvelope | undefined> {
  const rows = spec.rows ?? [];
  if (spec.type === 'stat_block') {
    return rows.map((row) => row.cells[0]);
  }
  if (spec.type === 'comparison_table') {
    const schoolCount = spec.schools?.length ?? 0;
    return rows.flatMap((row) => row.cells.slice(0, schoolCount));
  }
  return rows.map((row) => row.cells[0]);
}

function hasDbVizCellsForSources(message: {
  content?: ReadonlyArray<{ kind: string; spec?: RenderSpec }>;
}): boolean {
  return (message.content ?? []).some(
    (block) =>
      block.kind === 'viz' &&
      block.spec !== undefined &&
      renderedCellsForSourceSpec(block.spec).some(isDbVizCell),
  );
}

/** DB source entries this message actually cited in prose. Stray cumulative DB
 * rows do not enter the panel; DB-backed viz cards are handled by `usedDbData()`
 * as a separate visible-content signal. */
export function dbSourcesForMessage(message: {
  content?: ReadonlyArray<{ kind: string; text?: string }>;
  text?: string;
  sources?: ReadonlyArray<SourceEntry>;
}): SourceEntry[] {
  const sources = message.sources ?? [];
  const cited = citedIndexesForMessage(message.content, message.text ?? '');
  const dbEntries = sources.filter(
    (source) =>
      cited.has(source.index) &&
      isDbSource(source.citation.source) &&
      uniqueSourceByIndex(sources, source.index) === source,
  );
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

/** Did this answer visibly use Counselle's own data? (DB-cited prose OR DB cell.) */
export function usedDbData(message: {
  content?: ReadonlyArray<{ kind: string; text?: string; spec?: RenderSpec }>;
  text?: string;
  sources?: ReadonlyArray<SourceEntry>;
}): boolean {
  if (dbSourcesForMessage(message).length > 0) {
    return true;
  }
  return hasDbVizCellsForSources(message);
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
