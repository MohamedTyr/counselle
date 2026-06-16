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
import { describe, expect, test } from 'vitest';
import ReactMarkdown from 'react-markdown';
import remarkCitations from '@/components/citations/remarkCitations';
import remarkDbSpans from '@/components/citations/remarkDbSpans';

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
