/**
 * remarkDbSpans — wraps the clause preceding each citation into a db-claim node.
 *
 * It runs AFTER remarkCitations, so we render through the real pipeline
 * (remarkCitations → remarkDbSpans) and assert on the emitted DOM, mirroring the
 * remarkCitations integration test in citations.test.tsx. The db-claim renderer
 * here is a stub that exposes the stamped hProperties.index as data-index, so we
 * can assert clause boundaries and the index round-trip without DbClaim's gating.
 */
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, test } from 'vitest';
import ReactMarkdown from 'react-markdown';
import type { Citation, SourceEntry } from '@/api/protocol';
import remarkCitations from '@/components/citations/remarkCitations';
import remarkDbSpans from '@/components/citations/remarkDbSpans';
import DbClaim from '@/components/citations/DbClaim';
import { SourcesProvider } from '@/components/citations/SourcesContext';
import { RevealStateProvider } from '@/components/citations/RevealStateContext';

function DbClaimStub({
  index,
  children,
}: {
  index?: string | number;
  children?: React.ReactNode;
}) {
  return (
    <span data-db-claim="" data-index={index === undefined ? undefined : String(index)}>
      {children}
    </span>
  );
}

function CitationStub({ index }: { index?: string | number }) {
  return <sup data-citation={String(index)} />;
}

function renderMarkdown(source: string) {
  return render(
    <ReactMarkdown
      remarkPlugins={[remarkCitations, remarkDbSpans]}
      components={
        { 'db-claim': DbClaimStub, 'citation-ref': CitationStub } as never
      }
    >
      {source}
    </ReactMarkdown>,
  );
}

/** All db-claim spans, in document order. */
function claims(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-db-claim]'));
}

describe('remarkDbSpans wraps the clause each citation annotates', () => {
  test('wraps the clause for a cited marker and stamps its index', () => {
    const { container } = renderMarkdown('Acceptance sits at 12.5% [1].');
    const wrapped = claims(container);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].textContent).toBe('Acceptance sits at 12.5% ');
    expect(wrapped[0]).toHaveAttribute('data-index', '1');
  });

  test('.?! trim cuts a leading sentence — only the cited clause is wrapped', () => {
    const { container } = renderMarkdown('Intro fact. Acceptance is 12.5% [1].');
    const wrapped = claims(container);
    expect(wrapped).toHaveLength(1);
    // The leading "Intro fact." sentence is NOT inside the db-claim.
    expect(wrapped[0].textContent).toBe('Acceptance is 12.5% ');
    // The leading sentence still renders as plain prose.
    expect(container.textContent).toContain('Intro fact.');
  });

  test('multiple markers in one sentence each get their own clause', () => {
    const { container } = renderMarkdown('Yield is 40% [1] and aid is high [2].');
    const wrapped = claims(container);
    expect(wrapped).toHaveLength(2);
    expect(wrapped[0]).toHaveAttribute('data-index', '1');
    expect(wrapped[0].textContent).toBe('Yield is 40% ');
    expect(wrapped[1]).toHaveAttribute('data-index', '2');
    // Second clause is bounded on the left by the first citation, not the period.
    expect(wrapped[1].textContent).toBe(' and aid is high ');
  });

  test('a marker at text start wraps the whole preceding clause', () => {
    const { container } = renderMarkdown('[1] leads the sentence.');
    // No preceding text sibling → nothing to wrap; the marker stands alone.
    expect(claims(container)).toHaveLength(0);
  });

  test('marker with only a leading clause (no trailing period) wraps it all', () => {
    const { container } = renderMarkdown('The figure is 12.5% [1]');
    const wrapped = claims(container);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].textContent).toBe('The figure is 12.5% ');
  });

  test('no-citation input is a no-op', () => {
    const { container } = renderMarkdown('Just plain prose with no markers.');
    expect(claims(container)).toHaveLength(0);
    expect(container.textContent).toContain('Just plain prose with no markers.');
  });

  test('an abbreviation dot ("U.S. ") is not a boundary — the full clause wraps', () => {
    const { container } = renderMarkdown('The U.S. acceptance rate is 9% [1]');
    const wrapped = claims(container);
    expect(wrapped).toHaveLength(1);
    // The "S. " in "U.S. " must NOT clip the clause.
    expect(wrapped[0].textContent).toBe('The U.S. acceptance rate is 9% ');
  });

  test('a real sentence boundary still trims the leading sentence', () => {
    const { container } = renderMarkdown('X is true. Acceptance is 9% [1]');
    const wrapped = claims(container);
    expect(wrapped).toHaveLength(1);
    expect(wrapped[0].textContent).toBe('Acceptance is 9% ');
  });
});

/**
 * FE-C1: render through the REAL pipeline (remarkCitations → remarkDbSpans) AND
 * the REAL DbClaim source gate (not a stub), so these assert the live honesty
 * behavior: a clause lights ONLY when its `[n]` resolves to a streamed DB source
 * and reveal is on. `citation-ref` stays a stub (it carries no clause text).
 */
beforeAll(() => {
  // DbClaim's HoverCard trigger has no layout in jsdom; harmless for assertions.
  Element.prototype.scrollIntoView = () => {};
});

function entry(index: number, source: Citation['source']): SourceEntry {
  const tier: Citation['tier'] = source === 'cds' || source === 'edu' ? 'official' : 'community';
  return {
    index,
    label: source === 'cds' ? 'NYU — CDS 2025-26' : 'Web',
    citation: { source, tier, vintage: 'v', url: source === 'web' ? 'https://x.com/a' : undefined },
  };
}

function renderGated(source: string, sources: SourceEntry[]) {
  return render(
    <SourcesProvider value={sources}>
      <RevealStateProvider value={{ revealed: true, setRevealed: () => {} }}>
        <ReactMarkdown
          remarkPlugins={[remarkCitations, remarkDbSpans]}
          components={{ 'db-claim': DbClaim, 'citation-ref': CitationStub } as never}
        >
          {source}
        </ReactMarkdown>
      </RevealStateProvider>
    </SourcesProvider>,
  );
}

/** The lit clauses — db-claim spans the source gate marked as revealed. */
function litClaims(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-db-claim][data-revealed]'));
}

describe('FE-C1 — reveal lights only DB clauses, bounded honestly', () => {
  test('keeps adjacent bracketed different-class citations bounded (already correct — regression guard)', () => {
    // remarkCitations splits the text node at [5], so [1]'s clause never reaches
    // back over the [5] (web) attribution. No code change makes this pass.
    const { container } = renderGated(
      'US News reports 1480–1570 [5], close to our own figure of 1490 [1].',
      [entry(5, 'web'), entry(1, 'cds')],
    );
    const lit = litClaims(container);
    // Only the [1] (cds) clause lights; the [5] (web) clause is inert.
    expect(lit).toHaveLength(1);
    expect(lit[0].textContent).toBe(', close to our own figure of 1490 ');
    // No lit element carries the external "US News" attribution.
    for (const el of lit) {
      expect(el.textContent).not.toContain('US News');
    }
  });

  test('an unmatched 3-digit marker [999] bounds the clause (the EMBEDDED_MARKER fix)', () => {
    // [999] is never a citationRef (1–2 digits only), so it stays as text inside
    // [1]'s preceding text node. The leftover bracket must bound [1]'s clause.
    const { container } = renderGated(
      'Source 999 lists 1480–1570 [999], close to our figure of 1490 [1].',
      [entry(1, 'cds')],
    );
    const lit = litClaims(container);
    expect(lit).toHaveLength(1);
    expect(lit[0].textContent).toBe(', close to our figure of 1490 ');
    // The external "Source 999" attribution and "1480–1570" are NOT lit.
    for (const el of lit) {
      expect(el.textContent).not.toContain('Source 999');
      expect(el.textContent).not.toContain('1480–1570');
    }
  });

  test('bare-prose external attribution — KNOWN ADR-0006 LIMITATION (asserts only the source-gate floor)', () => {
    // KNOWN LIMITATION (ADR 0006): bare external attribution with no [n] and no
    // sentence boundary co-mingled with a DB clause cannot be bounded at the
    // remark layer; the model must mark it. The DbClaim source gate only prevents
    // non-DB indices from lighting.
    const prose = 'US News reports 1480–1570, close to our own figure of 1490 [1].';

    // ACHIEVABLE FLOOR: resolve [1] to a NON-DB (web) source ⇒ the source gate
    // prevents ANY clause from lighting — zero revealed elements.
    const { container: external } = renderGated(prose, [entry(1, 'web')]);
    expect(litClaims(external)).toHaveLength(0);

    // With [1]→'cds' the clause DOES light AND still contains "US News reports"
    // (the bare attribution carries no marker/boundary). We do NOT assert it is
    // bounded — that is impossible at this layer and is the model's
    // responsibility per ADR 0006.
    const { container: db } = renderGated(prose, [entry(1, 'cds')]);
    expect(litClaims(db)).toHaveLength(1);
  });
});

describe('remarkDbSpans plugin shape', () => {
  test('the emitted node carries hProperties.index', () => {
    const tree: { type: 'root'; children: unknown[] } = {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [
            { type: 'text', value: 'Acceptance is 12.5% ' },
            {
              type: 'citationRef',
              data: { hName: 'citation-ref', hProperties: { index: 7 } },
            },
          ],
        },
      ],
    };
    remarkDbSpans()(tree as never);
    const paragraph = tree.children[0] as { children: Array<{ type: string; data?: unknown }> };
    const dbClaim = paragraph.children.find((n) => n.type === 'dbClaim');
    expect(dbClaim).toBeDefined();
    expect((dbClaim as { data: { hName: string; hProperties: { index: number } } }).data).toEqual({
      hName: 'db-claim',
      hProperties: { index: 7 },
    });
  });
});
