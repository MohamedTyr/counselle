/**
 * SourceFavicon — real favicon via the same-origin proxy (/v1/favicon) when a
 * host resolves, falling back to the source-tier glyph otherwise (no host, or
 * the image failed to load).
 */
import { fireEvent, render } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Citation } from '@/api/protocol';
import SourceFavicon, { citationDomain } from '@/components/citations/SourceFavicon';

function citation(over: Partial<Citation> = {}): Citation {
  return { source: 'web', tier: 'official', vintage: 'Fetched 2026-06-11', ...over };
}

describe('citationDomain', () => {
  test('derives the host from a safe url', () => {
    expect(citationDomain(citation({ url: 'https://www.usnews.com/a' }))).toBe('usnews.com');
  });

  test('falls back to the known federal-authority domain when there is no url', () => {
    expect(citationDomain(citation({ source: 'scorecard', url: null }))).toBe(
      'collegescorecard.ed.gov',
    );
    expect(citationDomain(citation({ source: 'ipeds', url: null }))).toBe('nces.ed.gov');
  });

  test('null for a source with neither a url nor a known domain (CDS)', () => {
    expect(citationDomain(citation({ source: 'cds', url: null }))).toBeNull();
  });
});

describe('SourceFavicon', () => {
  test('renders a proxied <img> when a host resolves', () => {
    const { container } = render(
      <SourceFavicon citation={citation({ url: 'https://www.usnews.com/a' })} />,
    );
    const img = container.querySelector('img');
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute('src', '/v1/favicon?host=usnews.com&sz=64');
    expect(container.querySelector('svg')).not.toBeInTheDocument();
  });

  test('falls back to the glyph when no host resolves', () => {
    const { container } = render(<SourceFavicon citation={citation({ source: 'cds', url: null })} />);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });

  test('falls back to the glyph if the proxied image fails to load', () => {
    const { container } = render(
      <SourceFavicon citation={citation({ url: 'https://www.usnews.com/a' })} />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    fireEvent.error(img);
    expect(container.querySelector('img')).not.toBeInTheDocument();
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
