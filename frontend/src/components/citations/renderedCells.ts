import type { CitationEnvelope, RenderSpec } from '@/api/protocol';
import { isDbSource } from '@/components/citations/sourceName';

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
