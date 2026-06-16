/**
 * SourcesStrip — the collapsed favicon stack + "{n} sources" label.
 *
 * The caller (MessageSources) passes EXTERNAL-only sources for the favicons but
 * a `displayCount` for the label that reflects the full cited set (the Counselle
 * card counting as one). Without `displayCount` the label falls back to the
 * favicons shown.
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

describe('SourcesStrip', () => {
  test('favicons reflect the passed (external) sources only', () => {
    const { container } = render(
      <SourcesStrip
        sources={[
          webEntry(1, 'https://usnews.com/a'),
          webEntry(2, 'https://forbes.com/b'),
        ]}
        onOpen={() => {}}
      />,
    );
    // Each external source with a resolvable domain renders a favicon <img>
    // (aria-hidden, so it has no a11y role — query by tag).
    expect(container.querySelectorAll('img')).toHaveLength(2);
  });

  test('displayCount overrides the label without changing favicons', () => {
    const { container } = render(
      <SourcesStrip
        sources={[webEntry(1, 'https://usnews.com/a')]}
        displayCount={3}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('3 sources')).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(1);
  });

  test('without displayCount the label falls back to the favicon count', () => {
    render(
      <SourcesStrip
        sources={[
          webEntry(1, 'https://usnews.com/a'),
          webEntry(2, 'https://forbes.com/b'),
        ]}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText('2 sources')).toBeInTheDocument();
  });

  test('singular label when the count is one', () => {
    render(
      <SourcesStrip sources={[webEntry(1, 'https://usnews.com/a')]} onOpen={() => {}} />,
    );
    expect(screen.getByText('1 source')).toBeInTheDocument();
  });

  test('renders nothing when there are no favicons to show', () => {
    const { container } = render(<SourcesStrip sources={[]} onOpen={() => {}} />);
    expect(container.firstChild).toBeNull();
  });

  test('DB-only answer: renders a clickable strip with zero favicons', () => {
    // All cited sources are DB, so externals are empty but displayCount is the
    // full cited count (Counselle card = 1). The strip must still appear so the
    // student can open the panel's Counselle card.
    let opened = false;
    const { container } = render(
      <SourcesStrip sources={[]} displayCount={1} onOpen={() => { opened = true; }} />,
    );
    const button = screen.getByRole('button');
    expect(button).toBeInTheDocument();
    expect(screen.getByText('1 source')).toBeInTheDocument();
    expect(container.querySelectorAll('img')).toHaveLength(0);
    button.click();
    expect(opened).toBe(true);
  });
});
