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
import { schoolFromDbLabel } from '@/components/citations/sourceName';

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
      for (const school of block.spec.schools) {
        push(school.name);
      }
    }
  }
  if (ordered.length > 0) {
    return ordered;
  }

  // 2. Fallback: recover names from CDS source labels only (non-null). CDS
  //    labels lead with the school; IPEDS/Scorecard labels do not, so their
  //    em-dash heads must never masquerade as a school name (honesty).
  for (const entry of message.sources ?? []) {
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
