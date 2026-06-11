/**
 * Fixture helper: split prose into small `delta` events so the mock stream
 * has a realistic token cadence. The split preserves the exact source text
 * (chunks concatenate back byte-identically).
 */
import type { ProtocolEvent } from '@/api/protocol';

const WORDS_PER_DELTA = 3;

export function deltas(text: string): ProtocolEvent[] {
  const pieces = text.match(/\S+\s*|\s+/g) ?? [];
  const events: ProtocolEvent[] = [];
  for (let i = 0; i < pieces.length; i += WORDS_PER_DELTA) {
    events.push({
      v: 1,
      type: 'delta',
      data: { text: pieces.slice(i, i + WORDS_PER_DELTA).join('') },
    });
  }
  return events;
}
