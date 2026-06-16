/**
 * DbClaim — the honesty decision point for the reveal.
 *
 * A clause highlights ONLY when its citation resolves to a streamed DB source
 * AND the reveal is on. Undefined (not yet streamed) or external ⇒ inert prose,
 * even with the reveal on. Off ⇒ always inert.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Citation, SourceEntry } from '@/api/protocol';
import DbClaim from '@/components/citations/DbClaim';
import { SourcesProvider } from '@/components/citations/SourcesContext';
import { RevealDbProvider } from '@/components/citations/RevealDbContext';

function citation(over: Partial<Citation> = {}): Citation {
  return { source: 'cds', tier: 'official', vintage: 'CDS 2025-26', ...over };
}

function sourceEntry(over: Partial<SourceEntry> = {}): SourceEntry {
  return { index: 1, label: 'Counselle data', citation: citation(), ...over };
}

function renderClaim(opts: {
  index?: string | number;
  sources: SourceEntry[];
  revealed: boolean;
}) {
  return render(
    <SourcesProvider value={opts.sources}>
      <RevealDbProvider value={{ revealed: opts.revealed, style: 'wash' }}>
        <DbClaim index={opts.index}>cited clause</DbClaim>
      </RevealDbProvider>
    </SourcesProvider>,
  );
}

/** The db-claim span; data-revealed marks the highlighted state. */
function claim(container: HTMLElement): HTMLElement {
  return container.querySelector('[data-db-claim]') as HTMLElement;
}

describe('DbClaim highlights only a streamed DB source under reveal', () => {
  test('DB source + revealed ⇒ highlighted (wash + hovercard trigger)', () => {
    const { container } = renderClaim({
      index: 1,
      sources: [sourceEntry({ index: 1, citation: citation({ source: 'cds' }) })],
      revealed: true,
    });
    const span = claim(container);
    expect(span).toHaveAttribute('data-revealed', '');
    expect(span).toHaveAttribute('aria-label', "From Counselle's verified data");
    expect(span).toHaveAttribute('role', 'button');
  });

  test('DB source but revealed=false ⇒ inert', () => {
    const { container } = renderClaim({
      index: 1,
      sources: [sourceEntry({ index: 1, citation: citation({ source: 'cds' }) })],
      revealed: false,
    });
    const span = claim(container);
    expect(span).not.toHaveAttribute('data-revealed');
    expect(span).not.toHaveAttribute('role');
    expect(span.textContent).toBe('cited clause');
  });

  test('external source + revealed ⇒ inert (never highlight external)', () => {
    const { container } = renderClaim({
      index: 1,
      sources: [
        sourceEntry({ index: 1, citation: citation({ source: 'reddit', tier: 'community' }) }),
      ],
      revealed: true,
    });
    const span = claim(container);
    expect(span).not.toHaveAttribute('data-revealed');
    expect(span.textContent).toBe('cited clause');
  });

  test('undefined entry (source not yet streamed) + revealed ⇒ inert', () => {
    const { container } = renderClaim({ index: 9, sources: [], revealed: true });
    const span = claim(container);
    expect(span).not.toHaveAttribute('data-revealed');
    expect(span.textContent).toBe('cited clause');
  });

  test('index entirely undefined (no prop) + revealed ⇒ inert', () => {
    const { container } = renderClaim({
      index: undefined,
      sources: [sourceEntry({ index: 1, citation: citation({ source: 'cds' }) })],
      revealed: true,
    });
    const span = claim(container);
    expect(span).not.toHaveAttribute('data-revealed');
    expect(span.textContent).toBe('cited clause');
  });

  test.each(['cds', 'ipeds', 'scorecard'] as const)(
    '%s DB source + revealed ⇒ highlighted (all three DB tiers light up)',
    (source) => {
      const { container } = renderClaim({
        index: 1,
        sources: [sourceEntry({ index: 1, citation: citation({ source }) })],
        revealed: true,
      });
      const span = claim(container);
      expect(span).toHaveAttribute('data-revealed', '');
      expect(span).toHaveAttribute('role', 'button');
    },
  );
});
