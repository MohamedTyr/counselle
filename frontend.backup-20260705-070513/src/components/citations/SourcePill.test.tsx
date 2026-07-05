/**
 * SourcePill — FE-M7: the pill seats on the text baseline via CSS vertical-align
 * (align-[-0.18em]) instead of a fixed transform, so it sits correctly in both
 * prose flow and inside table cells. This test guards that the pill renders
 * inside a real table-cell context without throwing (the DOM nesting that broke
 * the old transform-based seating).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Citation, SourceEntry } from '@/api/protocol';
import SourcePill from '@/components/citations/SourcePill';

function entry(over: Partial<Citation> = {}): SourceEntry {
  return {
    index: 1,
    label: 'NYU Admissions',
    citation: {
      source: 'web',
      tier: 'official',
      vintage: 'Fetched 2026-06-11',
      url: 'https://www.usnews.com/best-colleges/new-york-university-2785',
      ...over,
    },
  };
}

describe('SourcePill (FE-M7)', () => {
  test('renders inside a <table><tbody><tr><td> without throwing', () => {
    expect(() =>
      render(
        <table>
          <tbody>
            <tr>
              <td>
                <SourcePill entry={entry()} onActivate={() => {}} />
              </td>
            </tr>
          </tbody>
        </table>,
      ),
    ).not.toThrow();
    // The pill's button is present and accessible inside the cell.
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  test('seats via vertical-align utility, not a transform', () => {
    render(<SourcePill entry={entry()} onActivate={() => {}} />);
    const button = screen.getByRole('button');
    expect(button.className).toContain('align-[-0.18em]');
    expect(button.className).not.toContain('translate-y-[0.12em]');
  });
});
