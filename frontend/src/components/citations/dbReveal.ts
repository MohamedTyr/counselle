/**
 * dbReveal — the reveal-toggle eligibility rules.
 *
 * This is deliberately narrower than "the session has a DB source": sources are
 * cumulative, while reveal is about visible content in this one message.
 */
import type { ChatMessage } from '@/app/ChatContext';
import type { RenderSpec } from '@/api/protocol';
import {
  isRevealableDbCell,
  renderedCellsForSpec,
} from '@/components/citations/renderedCells';
import { dbIndicesForMessage } from '@/components/citations/remarkCitations';

export { isRevealableDbCell, renderedCellsForSpec } from '@/components/citations/renderedCells';

type RevealMessage = {
  content?: ChatMessage['content'];
  text?: string;
  sources?: ChatMessage['sources'];
};

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
