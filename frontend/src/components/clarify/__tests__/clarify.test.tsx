/**
 * B5d: the frozen clarify widget seeds its selection from the persisted answer
 * (PRD 25 — the transcript record shows what was asked AND chosen). An answer
 * that matches no option label is a free-text ("Other") response and is shown.
 *
 * Deep research: when spec.header === 'Deep research', the ResearchPlanPanel
 * renders instead of the chip widget.
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ClarifySpec } from '@/api/protocol';
import ClarifyWidget from '@/components/clarify/ClarifyWidget';

function spec(over: Partial<ClarifySpec> = {}): ClarifySpec {
  return {
    v: 1,
    question: 'Which programs?',
    header: 'Narrow it down',
    multi_select: false,
    options: [
      { label: 'Computer Science', hint: 'CS' },
      { label: 'Biology', hint: 'Bio' },
    ],
    ...over,
  };
}

function researchSpec(over: Partial<ClarifySpec> = {}): ClarifySpec {
  return {
    v: 1,
    question: 'Review the plan below, then choose Run deep research or Cancel.',
    header: 'Deep research',
    multi_select: false,
    options: [
      { label: 'Run deep research', hint: '' },
      { label: 'Cancel', hint: '' },
    ],
    research_plan: {
      summary: 'Compare MIT and Stanford for CS admissions, aid, and testing.',
      planner: 'model',
      planner_note: null,
      schools: ['Massachusetts Institute of Technology', 'Stanford University'],
      topics: ['CS admissions', 'Financial aid', 'Testing policy'],
      tasks: [
        {
          label: 'Check official admissions policies',
          reason: 'Current testing policy needs school-owned sources.',
          sources: ['official'],
          queries: ['MIT Stanford admissions test policy'],
        },
      ],
      source_policy: ['Reddit only for qualitative sentiment.'],
      limitations: ['Unsupported claims will be labeled.'],
      max_runtime_seconds: 90,
    },
    ...over,
  };
}

describe('frozen clarify widget seeds from the persisted answer', () => {
  test('single-select: the chosen option chip is pressed', () => {
    render(<ClarifyWidget spec={spec()} frozen answer="Biology" onAnswer={vi.fn()} />);
    expect(screen.getByText('Biology').closest('button')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Computer Science').closest('button')).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('multi-select: every chosen option chip is pressed', () => {
    render(
      <ClarifyWidget
        spec={spec({ multi_select: true })}
        frozen
        answer="Computer Science, Biology"
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText('Computer Science').closest('button')).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByText('Biology').closest('button')).toHaveAttribute('aria-pressed', 'true');
  });

  test('free-text answer (no matching option) renders as the "Other" response', () => {
    render(<ClarifyWidget spec={spec()} frozen answer="Astrophysics" onAnswer={vi.fn()} />);
    expect(screen.getByText('Astrophysics')).toBeInTheDocument();
  });

  test('answer=null (unanswered/parked-frozen) seeds nothing', () => {
    render(<ClarifyWidget spec={spec()} frozen answer={null} onAnswer={vi.fn()} />);
    expect(screen.getByText('Biology').closest('button')).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('deep research plan panel', () => {
  test('renders the backend-provided structured plan and action buttons', () => {
    render(
      <ClarifyWidget spec={researchSpec()} frozen={false} onAnswer={vi.fn()} />,
    );
    expect(
      screen.getByText('Compare MIT and Stanford for CS admissions, aid, and testing.'),
    ).toBeInTheDocument();
    expect(screen.getByText('Massachusetts Institute of Technology')).toBeInTheDocument();
    expect(screen.getByText('Stanford University')).toBeInTheDocument();
    expect(screen.getByText('Check official admissions policies')).toBeInTheDocument();
    expect(screen.getByText('Reddit only for qualitative sentiment.')).toBeInTheDocument();
    expect(screen.getByText('Verification and source limits')).toBeInTheDocument();
    expect(screen.getByText('Maximum runtime: 90 seconds.')).toBeInTheDocument();
    expect(screen.getByText('Review before running')).toBeInTheDocument();
    expect(screen.queryByText('8 phases', { exact: false })).toBeNull();
    expect(screen.getByText('Run deep research')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
  });

  test('keeps detailed queries collapsed until the user expands them', () => {
    render(<ClarifyWidget spec={researchSpec()} frozen={false} onAnswer={vi.fn()} />);

    expect(screen.getByText('Search details')).toBeInTheDocument();
    expect(screen.getByText('MIT Stanford admissions test policy')).not.toBeVisible();

    fireEvent.click(screen.getByText('Search details'));

    expect(screen.getByText('MIT Stanford admissions test policy')).toBeVisible();
  });

  test('shows a loading skeleton before the plan arrives', () => {
    render(
      <ClarifyWidget
        spec={researchSpec({ research_plan: null })}
        frozen={false}
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByRole('status', { name: 'Preparing research plan' })).toBeInTheDocument();
  });

  test('calls onAnswer with the run option label when Run is clicked', () => {
    const onAnswer = vi.fn();
    render(<ClarifyWidget spec={researchSpec()} frozen={false} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText('Run deep research'));
    expect(onAnswer).toHaveBeenCalledWith('Run deep research');
  });

  test('calls onAnswer with cancel label when Cancel is clicked', () => {
    const onAnswer = vi.fn();
    render(<ClarifyWidget spec={researchSpec()} frozen={false} onAnswer={onAnswer} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onAnswer).toHaveBeenCalledWith('Cancel');
  });

  test('frozen panel hides buttons and shows chosen answer', () => {
    render(
      <ClarifyWidget
        spec={researchSpec()}
        frozen
        answer="Run deep research"
        turnStatus="complete"
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Run deep research' })).toBeNull();
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  test('frozen panel shows running status while the resumed research turn streams', () => {
    render(
      <ClarifyWidget
        spec={researchSpec()}
        frozen
        answer="Run deep research"
        turnStatus="streaming"
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.getByText('Running')).toBeInTheDocument();
  });

  test('does not render chip buttons (routes away from standard widget)', () => {
    render(<ClarifyWidget spec={researchSpec()} frozen={false} onAnswer={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Other' })).toBeNull();
  });

  test('labels fallback plans instead of presenting them as model-planned', () => {
    render(
      <ClarifyWidget
        spec={researchSpec({
          research_plan: {
            ...researchSpec().research_plan!,
            planner: 'fallback',
            planner_note: 'The model planner was unavailable, so this is a bounded fallback plan.',
          },
        })}
        frozen={false}
        onAnswer={vi.fn()}
      />,
    );

    expect(screen.getByText(/bounded fallback plan/i)).toBeInTheDocument();
  });
});
