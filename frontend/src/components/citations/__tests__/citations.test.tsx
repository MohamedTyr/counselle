/**
 * The §34 honesty-surface tests for the citation system: popover content
 * matches the envelope; tier-chip fidelity in chips and the sources footer;
 * CitationRef materializes before sources arrive.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Citation, SourceEntry } from '@/api/protocol';
import CitationPopover from '@/components/citations/CitationPopover';
import CitationRef from '@/components/citations/CitationRef';
import SourcesFooter from '@/components/citations/SourcesFooter';
import { SourcesProvider } from '@/components/citations/SourcesContext';
import TierChip from '@/components/citations/TierChip';

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
        <TierChip tier={c.tier}>IPEDS</TierChip>
      </CitationPopover>,
    );
    fireEvent.click(screen.getByText('IPEDS'));
    // The popover shows citation.source verbatim (display-name mapping is B5).
    expect(screen.getByText('ipeds', { selector: 'span.font-semibold' })).toBeInTheDocument();
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
        <TierChip tier={c.tier}>.edu</TierChip>
      </CitationPopover>,
    );
    fireEvent.click(screen.getByText('.edu'));
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', 'https://admissions.nyu.edu/apply');
    expect(link).toHaveAttribute('target', '_blank');
  });
});

describe('tier chips always match the envelope tier', () => {
  test("tier 'official' renders official; 'community' renders community", () => {
    render(
      <>
        <TierChip tier="official">CDS</TierChip>
        <TierChip tier="official">IPEDS</TierChip>
        <TierChip tier="community">Reddit</TierChip>
      </>,
    );
    expect(screen.getByText('CDS')).toHaveAttribute('data-tier', 'official');
    expect(screen.getByText('IPEDS')).toHaveAttribute('data-tier', 'official');
    expect(screen.getByText('Reddit')).toHaveAttribute('data-tier', 'community');
  });
});

describe('CitationRef materializes as the text streams', () => {
  test('renders a bare official chip before sources arrive', () => {
    render(<CitationRef index={1} />);
    const chip = screen.getByText('1');
    expect(chip).toHaveAttribute('data-tier', 'official');
  });

  test('binds to the SourceEntry once sources stream in', () => {
    const entry = sourceEntry({
      index: 2,
      citation: citation({ source: 'reddit', tier: 'community', vintage: '2026' }),
    });
    render(
      <SourcesProvider value={[entry]}>
        <CitationRef index={2} />
      </SourcesProvider>,
    );
    const chip = screen.getByText('2');
    expect(chip).toHaveAttribute('data-tier', 'community');
    fireEvent.click(chip);
    expect(screen.getByText('reddit')).toBeInTheDocument();
    expect(screen.getByText('2026')).toBeInTheDocument();
  });
});

describe('remarkCitations (beyond §34 — the plugin the markdown pipeline depends on)', () => {
  test('replaces [n] in prose with citation-ref chips, leaves code untouched', async () => {
    const { default: ReactMarkdown } = await import('react-markdown');
    const { default: remarkCitations, CitationRefMarkdown } = await import(
      '@/components/citations/remarkCitations'
    );
    render(
      <ReactMarkdown
        remarkPlugins={[remarkCitations]}
        components={{ 'citation-ref': CitationRefMarkdown } as never}
      >
        {'Acceptance sits at 12.5% [1] per the CDS. `code [2] stays` literal.'}
      </ReactMarkdown>,
    );
    const chip = screen.getByText('1');
    expect(chip).toHaveAttribute('data-tier', 'official');
    // [2] inside inline code is not transformed.
    expect(screen.getByText('code [2] stays')).toBeInTheDocument();
    expect(screen.queryByLabelText('Citation 2')).toBeNull();
  });
});

describe('sources footer groups by tier', () => {
  test('official and community blocks, vintages shown; empty → null', () => {
    const sources = [
      sourceEntry({ index: 1 }),
      sourceEntry({
        index: 2,
        label: 'r/nyu',
        citation: citation({ source: 'reddit', tier: 'community', vintage: 'June 2026' }),
      }),
    ];
    const { container, rerender } = render(<SourcesFooter sources={sources} />);
    expect(screen.getByText('Official sources')).toBeInTheDocument();
    expect(
      screen.getByText('Community voice — experiences, not statistics'),
    ).toBeInTheDocument();
    expect(screen.getByText('IPEDS 2024-25 (provisional)')).toBeInTheDocument();
    expect(screen.getByText('June 2026')).toBeInTheDocument();
    expect(screen.getByText('1')).toHaveAttribute('data-tier', 'official');
    expect(screen.getByText('2')).toHaveAttribute('data-tier', 'community');

    rerender(<SourcesFooter sources={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  // B5d (wire-contract §5, PINNED): the footer filters to only the markers
  // cited in this message — never a source the message didn't cite.
  test('citedIndexes filters the footer to the markers in this message', () => {
    const sources = [
      sourceEntry({ index: 1 }),
      sourceEntry({ index: 2, citation: citation({ source: 'scorecard' }) }),
      sourceEntry({ index: 7, citation: citation({ source: 'cds' }) }),
    ];
    // The message cited only [1] and [7]; [2] must NOT appear.
    render(<SourcesFooter sources={sources} citedIndexes={new Set([1, 7])} />);
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.queryByText('2')).toBeNull();
  });

  test('citedIndexes that match nothing → footer renders null', () => {
    const { container } = render(
      <SourcesFooter sources={[sourceEntry({ index: 1 })]} citedIndexes={new Set([9])} />,
    );
    expect(container).toBeEmptyDOMElement();
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
