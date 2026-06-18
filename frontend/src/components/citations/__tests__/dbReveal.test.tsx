/**
 * dbReveal — current-message reveal eligibility for "Show what's from Counselle".
 *
 * The key contract: reveal is about visible DB-backed content in this message,
 * not cumulative session sources.
 */
import { describe, expect, test } from 'vitest';
import type { Citation, CitationEnvelope, RenderSpec, SourceEntry } from '@/api/protocol';
import {
  hasRevealableDbContent,
  isRevealableDbCell,
  renderedCellsForSpec,
} from '@/components/citations/dbReveal';

function citation(over: Partial<Citation> = {}): Citation {
  return { source: 'cds', tier: 'official', vintage: 'CDS 2025-26', ...over };
}

function env(over: Partial<CitationEnvelope> = {}): CitationEnvelope {
  return {
    v: 1,
    field: 'adm.acceptance_rate',
    label: 'Acceptance rate',
    display: '12.5%',
    raw: 0.125,
    available: true,
    citation: citation(),
    ...over,
  };
}

function sourceEntry(index: number, source: Citation['source']): SourceEntry {
  return { index, label: `src-${index}`, citation: citation({ source }) };
}

function comparison(cells: CitationEnvelope[], schoolCount = cells.length): RenderSpec {
  return {
    v: 1,
    type: 'comparison_table',
    title: 'Comparison',
    schools: Array.from({ length: schoolCount }, (_, i) => ({ unitid: i + 1, name: `S${i + 1}` })),
    rows: [{ label: 'Metric', cells }],
  };
}

function stat(cell: CitationEnvelope): RenderSpec {
  return {
    v: 1,
    type: 'stat_block',
    title: 'Stats',
    schools: [{ unitid: 1, name: 'S1' }],
    rows: [{ label: 'Metric', cells: [cell] }],
  };
}

describe('isRevealableDbCell', () => {
  test('requires an available DB-sourced cell', () => {
    expect(isRevealableDbCell(env())).toBe(true);
    expect(isRevealableDbCell(env({ available: false, display: 'not available' }))).toBe(false);
    expect(
      isRevealableDbCell(env({ citation: citation({ source: 'web', tier: 'official' }) })),
    ).toBe(false);
    expect(isRevealableDbCell(undefined)).toBe(false);
  });
});

describe('renderedCellsForSpec', () => {
  test('comparison table mirrors rendered school columns only', () => {
    const visible = env({ display: 'visible', citation: citation({ source: 'web' }) });
    const hidden = env({ display: 'hidden-db' });
    const spec = comparison([visible, hidden], 1);
    expect(renderedCellsForSpec(spec)).toEqual([visible]);
    expect(hasRevealableDbContent({ content: [{ kind: 'viz', spec }] })).toBe(false);
  });

  test('unknown fallback mirrors row.cells[0]', () => {
    const hiddenDb = env({ display: 'hidden-db' });
    const visibleExternal = env({
      display: 'visible-external',
      citation: citation({ source: 'web' }),
    });
    const spec = {
      ...comparison([visibleExternal, hiddenDb], 2),
      type: 'future_card',
    } as unknown as RenderSpec;
    expect(renderedCellsForSpec(spec)).toEqual([visibleExternal]);
    expect(hasRevealableDbContent({ content: [{ kind: 'viz', spec }] })).toBe(false);
  });

  test('malformed rows-less specs do not throw', () => {
    const malformed = { type: 'stat_block', title: 'Broken', schools: [] } as unknown as RenderSpec;
    expect(renderedCellsForSpec(malformed)).toEqual([]);
    expect(hasRevealableDbContent({ content: [{ kind: 'viz', spec: malformed }] })).toBe(false);
  });

  test('malformed spec-less viz blocks do not throw', () => {
    const malformed = [{ kind: 'viz' }] as unknown as Parameters<typeof hasRevealableDbContent>[0]['content'];
    expect(hasRevealableDbContent({ content: malformed })).toBe(false);
  });
});

describe('hasRevealableDbContent', () => {
  test('true for viz-only DB content with no DB prose citation', () => {
    expect(hasRevealableDbContent({ content: [{ kind: 'viz', spec: comparison([env()]) }] })).toBe(
      true,
    );
  });

  test('true for DB-cited prose', () => {
    expect(
      hasRevealableDbContent({
        content: [{ kind: 'markdown', text: 'Acceptance is 12.5% [1].' }],
        sources: [sourceEntry(1, 'cds')],
      }),
    ).toBe(true);
  });

  test('false for external-only prose', () => {
    expect(
      hasRevealableDbContent({
        content: [{ kind: 'markdown', text: 'Per the school site [1].' }],
        sources: [sourceEntry(1, 'edu')],
      }),
    ).toBe(false);
  });

  test('false for external-only rendered viz cells', () => {
    const spec = comparison([env({ citation: citation({ source: 'web' }) })]);
    expect(hasRevealableDbContent({ content: [{ kind: 'viz', spec }] })).toBe(false);
  });

  test('false for unavailable DB cells', () => {
    const spec = stat(env({ available: false, display: 'not available', raw: null }));
    expect(hasRevealableDbContent({ content: [{ kind: 'viz', spec }] })).toBe(false);
  });

  test('false for cumulative historical DB sources without current DB content', () => {
    expect(
      hasRevealableDbContent({
        content: [{ kind: 'markdown', text: 'Per the school site [1].' }],
        sources: [sourceEntry(1, 'edu'), sourceEntry(2, 'scorecard')],
      }),
    ).toBe(false);
  });

  test('false for prose whose cited source index is duplicated', () => {
    expect(
      hasRevealableDbContent({
        content: [{ kind: 'markdown', text: 'Ambiguous claim [1].' }],
        sources: [sourceEntry(1, 'web'), sourceEntry(1, 'cds')],
      }),
    ).toBe(false);
  });

  test('true for fallback specs when row.cells[0] is DB-backed', () => {
    const spec = { ...comparison([env()]), type: 'future_card' } as unknown as RenderSpec;
    expect(hasRevealableDbContent({ content: [{ kind: 'viz', spec }] })).toBe(true);
  });
});
