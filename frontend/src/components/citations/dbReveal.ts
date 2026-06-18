/**
 * dbReveal — the reveal-toggle eligibility rules.
 *
 * This is deliberately narrower than "the session has a DB source": sources are
 * cumulative, while reveal is about visible content in this one message.
 */
import type { ChatMessage } from '@/app/ChatContext';
import type { CitationEnvelope, RenderSpec } from '@/api/protocol';
import { dbIndicesForMessage } from '@/components/citations/remarkCitations';
import { isDbSource } from '@/components/citations/sourceName';

type RevealMessage = {
  content?: ChatMessage['content'];
  text?: string;
  sources?: ChatMessage['sources'];
};

export function isRevealableDbCell(cell: CitationEnvelope | undefined): boolean {
  return cell?.available === true && isDbSource(cell.citation.source);
}

export function renderedCellsForSpec(spec: RenderSpec): Array<CitationEnvelope | undefined> {
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

export function hasDbVizCells(message: { content?: ChatMessage['content'] }): boolean {
  return (message.content ?? []).some(
    (block) => {
      if (block.kind !== 'viz') {
        return false;
      }
      const spec = (block as { spec?: RenderSpec }).spec;
      return spec !== undefined && renderedCellsForSpec(spec).some(isRevealableDbCell);
    },
  );
}

export function hasDbCitedProse(message: RevealMessage): boolean {
  return dbIndicesForMessage(message).size > 0;
}

export function hasRevealableDbContent(message: RevealMessage): boolean {
  return hasDbCitedProse(message) || hasDbVizCells(message);
}
