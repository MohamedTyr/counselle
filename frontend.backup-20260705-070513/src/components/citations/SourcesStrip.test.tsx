/**
 * SourcesStrip — FE-M1: when the cited set includes a Counselle-data card, the
 * button's accessible name explains the extra count ("…including Counselle
 * data"), since the announced count exceeds the external favicons a screen-reader
 * user perceives. With no DB card the accessible name is the plain count.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Citation, SourceEntry } from '@/api/protocol';
import SourcesStrip from '@/components/citations/SourcesStrip';

function citation(over: Partial<Citation> = {}): Citation {
  return { source: 'web', tier: 'official', vintage: 'Fetched 2026-06-11', ...over };
}

function webEntry(index: number, url: string): SourceEntry {
  return { index, label: 'Web', citation: citation({ url }) };
}

describe('SourcesStrip aria (FE-M1)', () => {
  test('announces "including Counselle data" when displayCount exceeds the external cited count', () => {
    render(
      <SourcesStrip
        sources={[webEntry(1, 'https://usnews.com/a')]}
        displayCount={2}
        onOpen={() => {}}
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName(/including Counselle data/);
  });

  test('announces a plain count when there is no DB card (displayCount equals externals)', () => {
    render(
      <SourcesStrip
        sources={[
          webEntry(1, 'https://usnews.com/a'),
          webEntry(2, 'https://forbes.com/b'),
        ]}
        displayCount={2}
        onOpen={() => {}}
      />,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAccessibleName('View 2 sources for this answer');
    expect(button).not.toHaveAccessibleName(/including Counselle data/);
  });

  test('plain count when displayCount is omitted entirely', () => {
    render(
      <SourcesStrip sources={[webEntry(1, 'https://usnews.com/a')]} onOpen={() => {}} />,
    );
    expect(screen.getByRole('button')).toHaveAccessibleName('View 1 source for this answer');
  });

  test('DB-only answer: announces "including Counselle data" with zero external favicons', () => {
    // No externals, but the Counselle card is counted (displayCount = 1 > 0).
    render(<SourcesStrip sources={[]} displayCount={1} onOpen={() => {}} />);
    expect(screen.getByRole('button')).toHaveAccessibleName(/including Counselle data/);
  });
});
