/**
 * SourcesPanel focus management (FE-M8): opening the docked panel moves focus to
 * the heading so AT users land inside the panel rather than nowhere.
 */
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, test } from 'vitest';
import type { Citation, SourceEntry } from '@/api/protocol';
import { SourcesPanel } from '@/components/citations/SourcesPanel';

// jsdom has no layout engine; the active-row scroll effect calls scrollIntoView.
beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
});

function webEntry(index: number, url: string): SourceEntry {
  const citation: Citation = {
    source: 'web',
    tier: 'official',
    vintage: 'Fetched 2026-06-11',
    url,
  };
  return { index, label: 'Web', citation, snippet: 'A page' };
}

const SOURCES: SourceEntry[] = [webEntry(1, 'https://usnews.com/a')];

describe('SourcesPanel focus management', () => {
  test('moves focus to the heading on open', () => {
    render(
      <SourcesPanel
        sources={SOURCES}
        activeIndex={null}
        dbSchools={[]}
        dbUsed={false}
        onClose={() => {}}
      />,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(document.activeElement).toBe(heading);
  });
});
