/**
 * B5d: the frozen clarify widget seeds its selection from the persisted answer
 * (PRD 25 — the transcript record shows what was asked AND chosen). An answer
 * that matches no option label is a free-text ("Other") response and is shown.
 */
import { render, screen } from '@testing-library/react';
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
