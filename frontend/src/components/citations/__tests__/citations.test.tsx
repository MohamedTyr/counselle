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
    source: 'IPEDS',
    tier: 'ipeds',
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
    expect(screen.getByText('IPEDS', { selector: 'span.font-semibold' })).toBeInTheDocument();
    expect(screen.getByText('IPEDS 2024-25 (provisional)')).toBeInTheDocument();
    expect(screen.getByText('Provisional release — final figures may shift.')).toBeInTheDocument();
  });

  test('renders the url as an external link when present', () => {
    const c = citation({
      source: 'admissions.nyu.edu',
      tier: 'edu',
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
  test('official tiers render official; reddit renders community', () => {
    render(
      <>
        <TierChip tier="cds">CDS</TierChip>
        <TierChip tier="ipeds">IPEDS</TierChip>
        <TierChip tier="reddit">Reddit</TierChip>
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
      citation: citation({ source: 'r/nyu', tier: 'reddit', vintage: '2026' }),
    });
    render(
      <SourcesProvider value={[entry]}>
        <CitationRef index={2} />
      </SourcesProvider>,
    );
    const chip = screen.getByText('2');
    expect(chip).toHaveAttribute('data-tier', 'community');
    fireEvent.click(chip);
    expect(screen.getByText('r/nyu')).toBeInTheDocument();
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
        citation: citation({ source: 'r/nyu', tier: 'reddit', vintage: 'June 2026' }),
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
});
