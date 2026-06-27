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
    question: 'Research CS programs at MIT and Stanford.',
    header: 'Deep research',
    multi_select: false,
    options: [
      { label: 'Run deep research', hint: '' },
      { label: 'Cancel', hint: '' },
    ],
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
  test('renders the phase list and action buttons when not frozen', () => {
    render(
      <ClarifyWidget spec={researchSpec()} frozen={false} onAnswer={vi.fn()} />,
    );
    expect(screen.getByText('Deep research plan')).toBeInTheDocument();
    expect(screen.getByText('8 phases', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('Run deep research')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
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
        onAnswer={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Run deep research' })).toBeNull();
    expect(screen.getByText('Run deep research')).toBeInTheDocument();
  });

  test('does not render chip buttons (routes away from standard widget)', () => {
    render(<ClarifyWidget spec={researchSpec()} frozen={false} onAnswer={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Other' })).toBeNull();
  });
});
