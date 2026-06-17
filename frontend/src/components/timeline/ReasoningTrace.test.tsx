/**
 * ReasoningTrace correctness (Phase 4, Group A):
 *  - FE-H2/FE-M4: the live wall-clock resets to 0 when a reused trace instance
 *    goes idle→live→idle→live (no carry-over from a previous turn), and ticks
 *    coarsely under reduced motion.
 *  - FE-M2: the "+N more" source overflow is a focusable button that reveals the
 *    hidden chips on click.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { StepData, StepSource } from '@/api/protocol';
import type { TimelineEntry } from '@/api/turn-reducer';
import ReasoningTrace from '@/components/timeline/ReasoningTrace';

// framer-motion's useReducedMotion is mocked per-suite so we can drive the gate.
const reduceMotionMock = vi.fn((): boolean => false);
vi.mock('framer-motion', () => ({
  useReducedMotion: () => reduceMotionMock(),
}));

function step(over: Partial<StepData> = {}): StepData {
  return {
    step_id: 's1',
    status: 'end',
    kind: 'web_search',
    label: 'Searching the web',
    tier: null,
    detail: { query: 'best CS schools', result_count: 6 },
    sources: [{ label: 'usnews.com', url: 'https://usnews.com/x' }],
    ...over,
  };
}

const baseTimeline: TimelineEntry[] = [
  { type: 'thinking', id: 'think-0', text: 'Let me check the rankings first.' },
  { type: 'step', step: step() },
];

/** Monotonic performance.now stub we can advance deterministically. */
function installClock() {
  let now = 0;
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
  return {
    spy,
    advance(ms: number) {
      now += ms;
    },
  };
}

describe('ReasoningTrace useElapsed reset (FE-H2)', () => {
  beforeEach(() => {
    reduceMotionMock.mockReturnValue(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('resets elapsed to 0 when a reused trace goes idle→live→idle→live', () => {
    vi.useFakeTimers();
    const clock = installClock();

    const { rerender } = render(
      <ReasoningTrace timeline={baseTimeline} status="streaming" />,
    );

    // Run the first turn ~2s.
    act(() => {
      clock.advance(2000);
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('2.0s')).toBeInTheDocument();

    // Turn completes: the timer freezes (no live timer rendered).
    rerender(<ReasoningTrace timeline={baseTimeline} status="complete" />);

    // The SAME instance is reused for a NEW live turn — the timer must RESTART
    // from ~0, not resume at the previous ~2s.
    rerender(<ReasoningTrace timeline={baseTimeline} status="streaming" />);
    act(() => {
      clock.advance(0);
      vi.advanceTimersByTime(0);
    });
    // Live timer shows 0.0s, not 2.0s (the previous turn's frozen elapsed).
    expect(screen.getByText('0.0s')).toBeInTheDocument();
    expect(screen.queryByText('2.0s')).toBeNull();
  });

  test('ticks at the coarse cadence under reduced motion (FE-M4)', () => {
    reduceMotionMock.mockReturnValue(true);
    vi.useFakeTimers();
    const clock = installClock();

    render(<ReasoningTrace timeline={baseTimeline} status="streaming" />);

    // Advance 500ms: with the coarse 1000ms tick, the displayed timer has not
    // fired yet, so it stays at 0.0s (the fine 100ms tick would have updated).
    act(() => {
      clock.advance(500);
      vi.advanceTimersByTime(500);
    });
    expect(screen.getByText('0.0s')).toBeInTheDocument();

    // Cross the 1000ms boundary: the coarse tick fires and the timer updates.
    act(() => {
      clock.advance(600);
      vi.advanceTimersByTime(600);
    });
    expect(screen.getByText('1.1s')).toBeInTheDocument();
  });
});

describe('ReasoningTrace "+N more" overflow (FE-M2)', () => {
  beforeEach(() => {
    reduceMotionMock.mockReturnValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function sourcesTimeline(n: number): TimelineEntry[] {
    const sources: StepSource[] = Array.from({ length: n }, (_, i) => ({
      label: `source-${i}`,
      url: `https://example.com/${i}`,
    }));
    return [{ type: 'step', step: step({ sources }) }];
  }

  test('+N more reveals the hidden chips on click', () => {
    render(<ReasoningTrace timeline={sourcesTimeline(6)} status="complete" durationMs={1000} />);
    // Expand the trace (header is the only button while collapsed).
    fireEvent.click(screen.getByRole('button'));

    // 4 chips visible + a "+2 more" focusable button.
    const overflow = screen.getByRole('button', { name: /show 2 more sources/i });
    expect(overflow).toBeInTheDocument();
    expect(overflow.tagName).toBe('BUTTON');
    expect(screen.getByText('source-0')).toBeInTheDocument();
    expect(screen.getByText('source-3')).toBeInTheDocument();
    expect(screen.queryByText('source-4')).toBeNull();
    expect(screen.queryByText('source-5')).toBeNull();

    // Click reveals the remaining chips; the overflow button is gone.
    fireEvent.click(overflow);
    expect(screen.getByText('source-4')).toBeInTheDocument();
    expect(screen.getByText('source-5')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /more sources/i })).toBeNull();
  });
});

describe('ReasoningTrace stable node keys (FE-H3)', () => {
  beforeEach(() => {
    reduceMotionMock.mockReturnValue(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('inserting a step before a thinking line preserves the thinking DOM node', () => {
    const original: TimelineEntry[] = [
      { type: 'thinking', id: 'think-stable', text: 'I am checking the data.' },
      { type: 'step', step: step({ step_id: 'step-old', label: 'Fetched values' }) },
    ];
    const inserted: TimelineEntry[] = [
      { type: 'step', step: step({ step_id: 'step-new', label: 'Resolved schools' }) },
      ...original,
    ];

    const { rerender } = render(<ReasoningTrace timeline={original} status="complete" />);
    fireEvent.click(screen.getByRole('button'));
    const thinkingNode = screen.getByText('I am checking the data.');

    rerender(<ReasoningTrace timeline={inserted} status="complete" />);

    expect(screen.getByText('I am checking the data.')).toBe(thinkingNode);
  });
});
