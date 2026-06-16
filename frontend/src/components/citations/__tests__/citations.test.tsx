/**
 * The §34 honesty-surface tests for the citation system: popover content
 * matches the envelope; tier fidelity on the in-cell SourceTag; and the
 * remarkCitations plugin still turns `[n]` prose markers into citation-ref
 * nodes (the contract the markdown pipeline depends on).
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Citation, SourceEntry } from '@/api/protocol';
import CitationPopover from '@/components/citations/CitationPopover';
import SourceTag from '@/components/citations/SourceTag';
import { SourcesProvider } from '@/components/citations/SourcesContext';

function citation(over: Partial<Citation> = {}): Citation {
  return {
    // B2/C1 re-pin: the real wire serves source NAMES + the two-value tier
    // ('official' | 'community') — never display strings or source-name tiers.
    source: 'ipeds',
    tier: 'official',
    vintage: 'IPEDS 2024-25 (provisional)',
    ...over,
  };
}

function sourceEntry(over: Partial<SourceEntry> = {}): SourceEntry {
  return { index: 1, label: 'IPEDS', citation: citation(), ...over };
}

describe('citation popover content matches the envelope', () => {
  test('opens on click with source name, vintage, and caveat', () => {
    const c = citation({ caveat: 'Provisional release — final figures may shift.' });
    render(
      <CitationPopover citation={c}>
        <SourceTag tier={c.tier}>IPEDS</SourceTag>
      </CitationPopover>,
    );
    fireEvent.click(screen.getByText('IPEDS'));
    // The popover spells out the source name (sourceDisplayName) + the tier
    // grammar word, never the raw lowercase enum.
    expect(screen.getByText('IPEDS', { selector: 'span.font-semibold' })).toBeInTheDocument();
    expect(screen.getByText('Official source')).toBeInTheDocument();
    expect(screen.getByText('IPEDS 2024-25 (provisional)')).toBeInTheDocument();
    expect(screen.getByText('Provisional release — final figures may shift.')).toBeInTheDocument();
  });

  test('renders the url as an external link when present', () => {
    const c = citation({
      source: 'edu',
      tier: 'official',
      vintage: 'Fetched 2026-06-11',
      url: 'https://admissions.nyu.edu/apply',
    });
    render(
      <CitationPopover citation={c}>
        <SourceTag tier={c.tier}>.edu</SourceTag>
      </CitationPopover>,
    );
    fireEvent.click(screen.getByText('.edu'));
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://admissions.nyu.edu/apply');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('source tags always match the envelope tier', () => {
  test("tier 'official' renders official; 'community' renders community", () => {
    render(
      <>
        <SourceTag tier="official">CDS</SourceTag>
        <SourceTag tier="official">IPEDS</SourceTag>
        <SourceTag tier="community">Reddit</SourceTag>
      </>,
    );
    expect(screen.getByText('CDS')).toHaveAttribute('data-tier', 'official');
    expect(screen.getByText('IPEDS')).toHaveAttribute('data-tier', 'official');
    expect(screen.getByText('Reddit')).toHaveAttribute('data-tier', 'community');
  });
});

describe('remarkCitations (the plugin the markdown pipeline depends on)', () => {
  test('replaces [n] in prose with a citation-ref pill, leaves code untouched', async () => {
    const { default: ReactMarkdown } = await import('react-markdown');
    const { default: remarkCitations } = await import('@/components/citations/remarkCitations');
    const { InlineCitationMarkdown } = await import('@/components/citations/InlineCitation');
    // An external (.edu) source so the inline marker renders a visible pill.
    const entry = sourceEntry({
      index: 1,
      label: 'admissions.nyu.edu',
      citation: citation({ source: 'edu', tier: 'official', url: 'https://admissions.nyu.edu' }),
    });
    render(
      <SourcesProvider value={[entry]}>
        <ReactMarkdown
          remarkPlugins={[remarkCitations]}
          components={{ 'citation-ref': InlineCitationMarkdown } as never}
        >
          {'Acceptance sits at 12.5% [1] per the page. `code [2] stays` literal.'}
        </ReactMarkdown>
      </SourcesProvider>,
    );
    // [1] became a citation-ref → a named SourcePill for the .edu source.
    expect(screen.getByText('admissions.nyu.edu')).toBeInTheDocument();
    // [2] inside inline code is not transformed (stays literal text).
    expect(screen.getByText('code [2] stays')).toBeInTheDocument();
  });
});

describe('citedIndexesIn — the §5 footer-filter grammar (single-sourced with the chips)', () => {
  test('collects 1–2 digit markers; ignores non-markers', async () => {
    const { citedIndexesIn } = await import('@/components/citations/remarkCitations');
    const got = citedIndexesIn('Acceptance is 12.5% [1], yield [12]; not [123] (3 digits), not 4.');
    expect([...got].sort((a, b) => a - b)).toEqual([1, 12]);
  });

  test('empty text → empty set', async () => {
    const { citedIndexesIn } = await import('@/components/citations/remarkCitations');
    expect(citedIndexesIn('').size).toBe(0);
  });
});
