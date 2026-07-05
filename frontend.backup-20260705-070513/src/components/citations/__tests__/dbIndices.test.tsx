/**
 * dbIndicesForMessage — the prose `[n]` indices that resolve to a DB source,
 * and the reveal-toggle visibility gate (`size > 0`) built on it.
 *
 * It MUST mirror citedIndexesForMessage's exact scan path (content blocks, else
 * the `text` fallback) so the toggle's visibility is identical between streaming
 * and completed states, then intersect with the message's DB-source entries.
 */
import { describe, expect, test } from 'vitest';
import type { Citation, SourceEntry } from '@/api/protocol';
import { dbIndicesForMessage } from '@/components/citations/remarkCitations';

function citation(over: Partial<Citation> = {}): Citation {
  return { source: 'cds', tier: 'official', vintage: 'CDS 2025-26', ...over };
}

function entry(index: number, source: Citation['source']): SourceEntry {
  return { index, label: `src-${index}`, citation: citation({ source }) };
}

type Msg = {
  content?: ReadonlyArray<{ kind: string; text?: string }>;
  text?: string;
  sources?: ReadonlyArray<SourceEntry>;
};

describe('dbIndicesForMessage', () => {
  test('returns only the cited indices that resolve to a DB source', () => {
    const msg: Msg = {
      content: [{ kind: 'markdown', text: 'NYU admits [1] and a forum says [2].' }],
      sources: [entry(1, 'cds'), entry(2, 'reddit')],
    };
    expect([...dbIndicesForMessage(msg)]).toEqual([1]);
  });

  test('mirrors the content-block scan path (multiple markdown blocks)', () => {
    const msg: Msg = {
      content: [
        { kind: 'markdown', text: 'First [1].' },
        { kind: 'viz' },
        { kind: 'markdown', text: 'Second [3].' },
      ],
      sources: [entry(1, 'ipeds'), entry(3, 'scorecard')],
    };
    expect([...dbIndicesForMessage(msg)].sort()).toEqual([1, 3]);
  });

  test('falls back to `text` when there are no content blocks', () => {
    const msg: Msg = {
      text: 'A figure [5].',
      sources: [entry(5, 'cds')],
    };
    expect([...dbIndicesForMessage(msg)]).toEqual([5]);
  });

  test('excludes a DB source whose marker is not cited in the prose', () => {
    const msg: Msg = {
      content: [{ kind: 'markdown', text: 'Only [1] is cited.' }],
      sources: [entry(1, 'cds'), entry(2, 'cds')],
    };
    expect([...dbIndicesForMessage(msg)]).toEqual([1]);
  });

  test('empty when no DB citations (external-only)', () => {
    const msg: Msg = {
      content: [{ kind: 'markdown', text: 'Per the site [1] and Reddit [2].' }],
      sources: [entry(1, 'edu'), entry(2, 'reddit')],
    };
    expect(dbIndicesForMessage(msg).size).toBe(0);
  });

  test('empty when a cited source index is duplicated', () => {
    const msg: Msg = {
      content: [{ kind: 'markdown', text: 'Ambiguous claim [1].' }],
      sources: [entry(1, 'edu'), entry(1, 'cds')],
    };
    expect(dbIndicesForMessage(msg).size).toBe(0);
  });

  test('empty when there are no citations at all', () => {
    const msg: Msg = {
      content: [{ kind: 'markdown', text: 'Plain prose, no markers.' }],
      sources: [entry(1, 'cds')],
    };
    expect(dbIndicesForMessage(msg).size).toBe(0);
  });
});

describe('reveal-toggle visibility gate (dbIndicesForMessage(msg).size > 0)', () => {
  const gate = (msg: Msg): boolean => dbIndicesForMessage(msg).size > 0;

  test('true for a DB-cited message', () => {
    const msg: Msg = {
      content: [{ kind: 'markdown', text: 'NYU admits [1].' }],
      sources: [entry(1, 'cds')],
    };
    expect(gate(msg)).toBe(true);
  });

  test('false for an external-only-cited message', () => {
    const msg: Msg = {
      content: [{ kind: 'markdown', text: 'Per the site [1].' }],
      sources: [entry(1, 'edu')],
    };
    expect(gate(msg)).toBe(false);
  });

  test('false for a no-citation message', () => {
    const msg: Msg = {
      content: [{ kind: 'markdown', text: 'No markers here.' }],
      sources: [entry(1, 'cds')],
    };
    expect(gate(msg)).toBe(false);
  });
});
