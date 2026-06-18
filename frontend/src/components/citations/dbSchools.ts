/**
 * dbSchoolsForMessage — the school names that the Counselle-data card names in
 * its subline ("Counselle data on NYU, Yale…").
 *
 * Two truthful sources, in order of fidelity:
 *  1. The answer's viz blocks — `RenderSpec.schools[].name` is the exact set of
 *     schools the figures cover. De-duplicated, original order preserved.
 *  2. Fallback (prose-only DB answers, no viz): `schoolFromDbLabel(entry.label)`
 *     for CDS sources ONLY — CDS labels are reliably "School — CDS…", so the
 *     head is a real school name. IPEDS/Scorecard labels aren't school-prefixed
 *     (e.g. "Common Data Set — Section C9"), so their heads are never trusted as
 *     schools. A bare dataset vintage yields `null` and is dropped regardless.
 *
 * Returns `[]` when nothing is derivable — the card then shows its generic,
 * truthful "…from our own college database." subline instead of inventing names.
 */
import type { ChatMessage } from '@/app/ChatContext';
import type { RenderSpec } from '@/api/protocol';
import { dbSourcesForMessage } from '@/components/citations/remarkCitations';
import {
  isRevealableDbCell,
  renderedCellsForSpec,
} from '@/components/citations/renderedCells';
import { schoolFromDbLabel } from '@/components/citations/sourceName';

function addDbVizSchools(spec: RenderSpec, push: (name: string) => void): void {
  const schools = spec.schools ?? [];

  if (spec.type === 'stat_block') {
    const school = schools[0];
    if (school !== undefined && renderedCellsForSpec(spec).some(isRevealableDbCell)) {
      push(school.name);
    }
    return;
  }

  if (spec.type === 'comparison_table') {
    schools.forEach((school, index) => {
      if ((spec.rows ?? []).some((row) => isRevealableDbCell(row.cells[index]))) {
        push(school.name);
      }
    });
    return;
  }

  const school = schools[0];
  if (school !== undefined && renderedCellsForSpec(spec).some(isRevealableDbCell)) {
    push(school.name);
  }
}

export function dbSchoolsForMessage(message: ChatMessage): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  };

  // 1. Viz blocks carry the authoritative school set per figure.
  for (const block of message.content ?? []) {
    if (block.kind === 'viz') {
      const spec = (block as { spec?: RenderSpec }).spec;
      if (spec !== undefined) {
        addDbVizSchools(spec, push);
      }
    }
  }
  if (ordered.length > 0) {
    return ordered;
  }

  // 2. Fallback: recover names from the fail-closed DB prose subset only. CDS
  //    labels lead with the school; IPEDS/Scorecard labels do not, so their
  //    em-dash heads must never masquerade as a school name (honesty).
  for (const entry of dbSourcesForMessage(message)) {
    if (entry.citation.source !== 'cds') {
      continue;
    }
    const name = schoolFromDbLabel(entry.label);
    if (name !== null) {
      push(name);
    }
  }
  return ordered;
}
