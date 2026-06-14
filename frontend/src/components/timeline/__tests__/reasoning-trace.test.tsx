/**
 * ReasoningTrace render states (feat/reasoning-experience): collapsed shows the
 * current activity; expanding reveals the steps + source chips; a finished turn
 * collapses to its receipt and re-expands to the same chips.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { StepData } from '@/api/protocol';
import type { TimelineEntry } from '@/api/turn-reducer';
import ReasoningTrace from '@/components/timeline/ReasoningTrace';

function step(over: Partial<StepData> = {}): StepData {
  return {
    step_id: 's1',
    status: 'end',
    kind: 'web_search',
    label: 'Searching the web',
    tier: null,
    detail: { query: 'best CS schools', result_count: 6 },
    sources: [{ label: 'usnews.com', favicon: 'https://cdn/f.png', url: 'https://usnews.com/x' }],
    ...over,
  };
}

const timeline: TimelineEntry[] = [
  { type: 'thinking', text: 'Let me check the rankings first.' },
  { type: 'step', step: step() },
];

describe('ReasoningTrace', () => {
  test('renders nothing for a finished turn with no work', () => {
    const { container } = render(<ReasoningTrace timeline={[]} status="complete" />);
    expect(container).toBeEmptyDOMElement();
  });

  test('collapsed live header shows the current activity; rail is hidden', () => {
    render(
      <ReasoningTrace timeline={timeline} status="streaming" activities={['Searching the web']} />,
    );
    expect(screen.getAllByText('Searching the web').length).toBeGreaterThan(0);
    // Collapsed (Radix unmounts content): the thinking narration isn't shown yet.
    expect(screen.queryByText('Let me check the rankings first.')).toBeNull();
  });

  test('expanding reveals the steps, thinking line, and source chips', () => {
    render(
      <ReasoningTrace timeline={timeline} status="streaming" activities={['Searching the web']} />,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('Let me check the rankings first.')).toBeInTheDocument();
    expect(screen.getByText('usnews.com')).toBeInTheDocument();
  });

  test('a finished turn collapses to "Thought for Ns" and re-expands to the chips', () => {
    render(<ReasoningTrace timeline={timeline} status="complete" durationMs={3400} />);
    // Mockup-identical done state: "Thought for Ns" (no step-count receipt).
    expect(screen.getByText(/Thought for/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('usnews.com')).toBeInTheDocument();
  });

  test('a broken favicon hides without dropping the chip label', () => {
    render(<ReasoningTrace timeline={timeline} status="complete" />);
    fireEvent.click(screen.getByRole('button'));
    const img = document.querySelector('img');
    expect(img).not.toBeNull();
    fireEvent.error(img as HTMLImageElement);
    expect(screen.getByText('usnews.com')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});

describe('ReasoningTrace activity ticker (dwell)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('queued labels surface one per dwell, in order (none skipped)', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ReasoningTrace timeline={timeline} status="streaming" activities={['Pulling Stanford']} />,
    );
    expect(screen.getByText('Pulling Stanford')).toBeInTheDocument();

    // A burst of fast tools lands during the first dwell — queued, not skipped.
    rerender(
      <ReasoningTrace
        timeline={timeline}
        status="streaming"
        activities={['Pulling Stanford', 'Pulling MIT', 'Comparing']}
      />,
    );
    expect(screen.getByText('Pulling Stanford')).toBeInTheDocument();
    expect(screen.queryByText('Pulling MIT')).toBeNull();

    // They surface one per dwell, in arrival order — the mockup's setNow cadence.
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByText('Pulling MIT')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByText('Comparing')).toBeInTheDocument();
  });

  test('finishing the turn flushes the ticker — the receipt shows, no queued drain', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <ReasoningTrace timeline={timeline} status="streaming" activities={['Pulling Stanford']} />,
    );
    rerender(
      <ReasoningTrace
        timeline={timeline}
        status="streaming"
        activities={['Pulling Stanford', 'Pulling MIT']}
      />,
    );

    // Turn finishes: header switches to the settled "Thought for Ns"; the ticker
    // must not later drain a queued activity over it.
    rerender(<ReasoningTrace timeline={timeline} status="complete" />);
    expect(screen.getByText(/Thought for/)).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText(/Thought for/)).toBeInTheDocument();
    expect(screen.queryByText('Pulling MIT')).toBeNull();
  });
});

describe('ReasoningTrace interactivity', () => {
  test('a web source chip links out to the result in a new tab', () => {
    render(<ReasoningTrace timeline={timeline} status="complete" durationMs={3400} />);
    fireEvent.click(screen.getByRole('button')); // expand (header is the only button while collapsed)
    const link = screen.getByRole('link', { name: /open source: usnews\.com/i });
    expect(link).toHaveAttribute('href', 'https://usnews.com/x');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  test('a search step reveals its query + result count on click (hidden by default)', () => {
    render(<ReasoningTrace timeline={timeline} status="complete" durationMs={3400} />);
    fireEvent.click(screen.getByRole('button')); // expand the trace
    expect(screen.queryByText(/best CS schools/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /searching the web/i }));
    expect(screen.getByText(/best CS schools/)).toBeInTheDocument();
    expect(screen.getByText(/6 results/)).toBeInTheDocument();
  });

  test('a db step links its school out but exposes NO internals (no fields/rows/tables)', () => {
    const dbStep = step({
      step_id: 'db1',
      kind: 'db_tool',
      label: 'Pulling cds data',
      detail: { tool: 'read_fields', field_keys: ['cds.c1', 'cds.c2'], row_count: 47 },
      sources: [{ label: 'Stanford', favicon: 'https://cdn/s.png', url: 'https://stanford.edu' }],
    });
    render(
      <ReasoningTrace
        timeline={[{ type: 'step', step: dbStep }]}
        status="complete"
        durationMs={1000}
      />,
    );
    fireEvent.click(screen.getByRole('button')); // expand the trace
    // The db label is NOT a toggle (no receipt): the header stays the only button.
    expect(screen.queryByRole('button', { name: /pulling cds data/i })).toBeNull();
    // None of the internal receipt fields render anywhere.
    expect(screen.queryByText(/cds\.c1/)).toBeNull();
    expect(screen.queryByText(/read_fields/)).toBeNull();
    expect(screen.queryByText(/47/)).toBeNull();
    // The public school chip still links to its website.
    expect(screen.getByRole('link', { name: /stanford — visit website/i })).toHaveAttribute(
      'href',
      'https://stanford.edu',
    );
  });
});
