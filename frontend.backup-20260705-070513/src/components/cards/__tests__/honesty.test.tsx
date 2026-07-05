/**
 * The §34 honesty-surface tests for the cards (architecture.md §34):
 * NA states, tier-chip fidelity, no-1600, no-winner-highlight,
 * unknown-card → markdown fallback.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import type { Citation, CitationEnvelope, RenderSpec } from '@/api/protocol';
import VizCard from '@/components/cards/VizCard';
import { DejargonProvider } from '@/components/citations/dejargon';
import { RevealStateProvider } from '@/components/citations/RevealStateContext';

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

function renderWithReveal(specArg: RenderSpec, revealed: boolean, dejargon = false) {
  return render(
    <RevealStateProvider value={{ revealed, setRevealed: () => {} }}>
      <DejargonProvider value={dejargon}>
        <VizCard spec={specArg} expandable={false} />
      </DejargonProvider>
    </RevealStateProvider>,
  );
}

function revealedVizCells(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll('[data-db-viz-cell][data-revealed]'));
}

describe('reveal highlights only DB-backed card values', () => {
  test('comparison table reveals DB cells but not external cells', () => {
    const { container } = renderWithReveal(
      spec({
        type: 'comparison_table',
        schools: [
          { unitid: 1, name: 'School A' },
          { unitid: 2, name: 'School B' },
        ],
        rows: [
          {
            label: 'Acceptance rate',
            cells: [
              env({ display: '12.5%' }),
              env({
                display: 'External value',
                citation: citation({ source: 'web', tier: 'official', vintage: 'Fetched today' }),
              }),
            ],
          },
        ],
      }),
      true,
    );

    const revealed = revealedVizCells(container);
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toHaveTextContent('12.5%');
    expect(screen.getByText('External value').closest('[data-revealed]')).toBeNull();
    expect(screen.getByText('CDS').closest('[data-revealed]')).toBeNull();
    expect(screen.getByText('web').closest('[data-revealed]')).toBeNull();
  });

  test('unavailable cells and reveal-off cells do not reveal', () => {
    const { container: unavailable } = renderWithReveal(
      spec({ rows: [{ label: 'Missing', cells: [naEnv()] }] }),
      true,
    );
    expect(revealedVizCells(unavailable)).toHaveLength(0);

    const { container: off } = renderWithReveal(
      spec({ rows: [{ label: 'Acceptance rate', cells: [env()] }] }),
      false,
    );
    expect(revealedVizCells(off)).toHaveLength(0);
  });

  test('stat block values reveal in dejargon and legacy modes', () => {
    const legacy = renderWithReveal(spec({ rows: [{ label: 'Acceptance rate', cells: [env()] }] }), true);
    expect(revealedVizCells(legacy.container)).toHaveLength(1);
    expect(screen.getByText('CDS').closest('[data-revealed]')).toBeNull();
    legacy.unmount();

    const dejargon = renderWithReveal(
      spec({ rows: [{ label: 'Acceptance rate', cells: [env()] }] }),
      true,
      true,
    );
    expect(revealedVizCells(dejargon.container)).toHaveLength(1);
  });

  test('unknown-card fallback reveals only the visible DB value', () => {
    const futureSpec = {
      ...spec({
        rows: [
          { label: 'Visible', cells: [env({ display: '42' })] },
          {
            label: 'External',
            cells: [
              env({
                display: 'External fallback',
                citation: citation({ source: 'web', tier: 'official' }),
              }),
            ],
          },
        ],
      }),
      type: 'future_thing',
    } as unknown as RenderSpec;

    const { container } = renderWithReveal(futureSpec, true);
    const revealed = revealedVizCells(container);
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toHaveTextContent('42');
  });
});

describe('stat block Counselle-verified badge is honest', () => {
  test('appears for all-DB available rows in inline dejargon mode', () => {
    renderWithReveal(
      spec({
        rows: [
          { label: 'Acceptance rate', cells: [env()] },
          { label: 'Yield', cells: [env({ display: '45%' })] },
        ],
      }),
      false,
      true,
    );
    expect(screen.getByText('Counselle-verified')).toBeInTheDocument();
  });

  test('does not appear for mixed, external-only, unavailable-only, or panel stat blocks', () => {
    const mixed = renderWithReveal(
      spec({
        rows: [
          { label: 'Acceptance rate', cells: [env()] },
          {
            label: 'External',
            cells: [env({ citation: citation({ source: 'web', tier: 'official' }) })],
          },
        ],
      }),
      false,
      true,
    );
    expect(screen.queryByText('Counselle-verified')).not.toBeInTheDocument();
    mixed.unmount();

    const unavailable = renderWithReveal(spec({ rows: [{ label: 'Missing', cells: [naEnv()] }] }), false, true);
    expect(screen.queryByText('Counselle-verified')).not.toBeInTheDocument();
    unavailable.unmount();

    render(
      <RevealStateProvider value={{ revealed: false, setRevealed: () => {} }}>
        <DejargonProvider value={true}>
          <VizCard spec={spec({ rows: [{ label: 'Acceptance rate', cells: [env()] }] })} variant="panel" />
        </DejargonProvider>
      </RevealStateProvider>,
    );
    expect(screen.queryByText('Counselle-verified')).not.toBeInTheDocument();
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
    expect(document.body).toHaveTextContent('Some metric: 42');
    expect(screen.getByText('Missing metric: not available')).toBeInTheDocument();
  });
});
