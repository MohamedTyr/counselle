/**
 * The §34 honesty-surface tests for the cards (architecture.md §34):
 * NA states, tier-chip fidelity, no-1600, no-winner-highlight,
 * unknown-card → markdown fallback.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Citation, CitationEnvelope, RenderSpec } from '@/api/protocol';
import VizCard from '@/components/cards/VizCard';

function citation(over: Partial<Citation> = {}): Citation {
  return {
    // B2/C1 re-pin: the real wire serves source NAMES + the two-value tier
    // ('official' | 'community') — never display strings or source-name tiers.
    source: 'cds',
    tier: 'official',
    vintage: 'CDS 2024-25',
    ...over,
  };
}

function env(over: Partial<CitationEnvelope> = {}): CitationEnvelope {
  return {
    v: 1,
    field: 'adm.acceptance_rate',
    label: 'Acceptance rate',
    display: '12.5%',
    raw: 0.125,
    available: true,
    citation: citation(),
    ...over,
  };
}

function naEnv(): CitationEnvelope {
  return env({ display: 'not available', raw: null, available: false });
}

function spec(over: Partial<RenderSpec> = {}): RenderSpec {
  return {
    v: 1,
    type: 'stat_block',
    title: 'NYU at a glance',
    schools: [{ unitid: 193900, name: 'New York University' }],
    rows: [],
    ...over,
  };
}

describe('not available — the designed muted state, never an empty cell', () => {
  test('stat block renders "not available" for an unavailable cell', () => {
    render(
      <VizCard
        spec={spec({
          rows: [
            { label: 'Acceptance rate', cells: [env()] },
            { label: 'Yield', cells: [naEnv()] },
          ],
        })}
      />,
    );
    expect(screen.getByText('not available')).toBeInTheDocument();
    expect(screen.getByText('12.5%')).toBeInTheDocument();
  });

  test('comparison cells render the muted NA state, never empty', () => {
    const { container } = render(
      <VizCard
        spec={spec({
          type: 'comparison_table',
          schools: [
            { unitid: 1, name: 'School A' },
            { unitid: 2, name: 'School B' },
          ],
          rows: [{ label: 'Yield', cells: [env({ display: '45%' }), naEnv()] }],
        })}
      />,
    );
    expect(screen.getByText('not available')).toBeInTheDocument();
    // No value cell may be empty.
    const valueCells = Array.from(container.querySelectorAll('td'));
    expect(valueCells.length).toBe(2);
    for (const cell of valueCells) {
      expect(cell.textContent?.trim()).not.toBe('');
    }
  });

  test('NA is visibly distinct from a zero value', () => {
    render(
      <VizCard
        spec={spec({
          rows: [
            { label: 'Real zero', cells: [env({ display: '0', raw: 0 })] },
            { label: 'Missing', cells: [naEnv()] },
          ],
        })}
      />,
    );
    const zero = screen.getByText('0');
    const na = screen.getByText('not available');
    expect(zero.className).not.toBe(na.className);
    expect(na.className).toContain('italic');
  });
});

describe('tier chips always match the envelope tier', () => {
  test('official envelope → official chip; reddit → community chip', () => {
    render(
      <VizCard
        spec={spec({
          rows: [
            { label: 'Acceptance rate', cells: [env()] },
            {
              label: 'Student take',
              cells: [
                env({
                  display: 'mixed reviews',
                  citation: citation({ source: 'reddit', tier: 'community', vintage: '2026' }),
                }),
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByText('CDS')).toHaveAttribute('data-tier', 'official');
    expect(screen.getByText('Reddit')).toHaveAttribute('data-tier', 'community');
  });
});

describe('comparison table never winner-highlights', () => {
  test('a clearly larger value gets the identical cell treatment', () => {
    const { container } = render(
      <VizCard
        spec={spec({
          type: 'comparison_table',
          schools: [
            { unitid: 1, name: 'School A' },
            { unitid: 2, name: 'School B' },
          ],
          rows: [
            {
              label: 'Median earnings',
              cells: [
                env({ display: '$45,000', raw: 45000 }),
                env({ display: '$95,000', raw: 95000 }),
              ],
            },
          ],
        })}
      />,
    );
    const cells = Array.from(container.querySelectorAll('td'));
    expect(cells.length).toBe(2);
    expect(cells[0].className).toBe(cells[1].className);
    const values = [screen.getByText('$45,000'), screen.getByText('$95,000')];
    expect(values[0].className).toBe(values[1].className);
  });

  test('the table has an accessible name equal to its title', () => {
    render(
      <VizCard
        spec={spec({
          type: 'comparison_table',
          // A distinct title (not the spec() default) so this asserts the table's
          // aria-label is actually bound to spec.title, not a coincidental match.
          title: 'Cost: MIT vs. Harvard',
          schools: [
            { unitid: 1, name: 'School A' },
            { unitid: 2, name: 'School B' },
          ],
          rows: [
            {
              label: 'Median earnings',
              cells: [
                env({ display: '$45,000', raw: 45000 }),
                env({ display: '$95,000', raw: 95000 }),
              ],
            },
          ],
        })}
      />,
    );
    expect(screen.getByRole('table', { name: 'Cost: MIT vs. Harvard' })).toBeInTheDocument();
  });
});

describe('unknown card type → markdown fallback (the degrade rule)', () => {
  test("type 'future_thing' renders title + row text without throwing", () => {
    const futureSpec = {
      ...spec({
        title: 'A future card',
        rows: [
          { label: 'Some metric', cells: [env({ display: '42' })] },
          { label: 'Missing metric', cells: [naEnv()] },
        ],
      }),
      type: 'future_thing',
    } as unknown as RenderSpec;

    render(<VizCard spec={futureSpec} />);
    expect(screen.getByText('A future card')).toBeInTheDocument();
    expect(screen.getByText('Some metric: 42')).toBeInTheDocument();
    expect(screen.getByText('Missing metric: not available')).toBeInTheDocument();
  });
});
