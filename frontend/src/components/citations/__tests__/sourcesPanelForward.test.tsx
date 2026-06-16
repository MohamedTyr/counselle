/**
 * SourcesPanel / SourcesSheet forward `activeIndex` + `dbSchools` into
 * SourcesList: the active row flashes, and the Counselle-data card names the
 * passed schools. (T4 wiring — the panel atom carries all three.)
 */
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Citation, SourceEntry } from '@/api/protocol';
import { SourcesPanel, SourcesSheet } from '@/components/citations/SourcesPanel';

// jsdom has no layout engine, so the active-row scroll effect needs a stub.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

function webEntry(index: number, url: string, snippet: string): SourceEntry {
  const citation: Citation = {
    source: 'web',
    tier: 'official',
    vintage: 'Fetched 2026-06-11',
    url,
  };
  return { index, label: 'Web', citation, snippet };
}

function dbEntry(index: number): SourceEntry {
  return {
    index,
    label: 'NYU — CDS 2025-26',
    citation: { source: 'cds', tier: 'official', vintage: 'CDS 2025-26' },
  };
}

const SOURCES: SourceEntry[] = [
  dbEntry(1),
  webEntry(2, 'https://usnews.com/a', 'A ranking page'),
  webEntry(3, 'https://forbes.com/b', 'Another page'),
];

describe('SourcesPanel forwards activeIndex + dbSchools', () => {
  test('the active external row gets the source-flash animation', () => {
    render(
      <SourcesPanel sources={SOURCES} activeIndex={2} dbSchools={['NYU']} onClose={() => {}} />,
    );
    const flashed = document.querySelector('[class*="source-flash"]');
    expect(flashed).not.toBeNull();
  });

  test('dbSchools name the schools in the Counselle-data card subline', () => {
    render(
      <SourcesPanel
        sources={SOURCES}
        activeIndex={null}
        dbSchools={['NYU', 'Yale']}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/NYU and Yale/)).toBeInTheDocument();
  });
});

describe('SourcesSheet forwards activeIndex + dbSchools', () => {
  test('passes schools through to the Counselle card', () => {
    render(
      <SourcesSheet
        sources={SOURCES}
        activeIndex={null}
        dbSchools={['Stanford']}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/Stanford/)).toBeInTheDocument();
  });
});
