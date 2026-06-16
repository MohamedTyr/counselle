/**
 * RevealStateContext — the per-message reveal flag owned by MessageRender and
 * shared with both the message body and the action-row toggle.
 *
 * Tested in isolation (a stateful provider + a consumer) rather than through a
 * full vendored MessageRender render — the contract is "toggling flips revealed".
 */
import { useState } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';
import {
  RevealStateProvider,
  useRevealState,
} from '@/components/citations/RevealStateContext';

function Consumer() {
  const { revealed, setRevealed } = useRevealState();
  return (
    <button type="button" onClick={() => setRevealed(!revealed)}>
      {revealed ? 'on' : 'off'}
    </button>
  );
}

function Host() {
  const [revealed, setRevealed] = useState(false);
  return (
    <RevealStateProvider value={{ revealed, setRevealed }}>
      <Consumer />
    </RevealStateProvider>
  );
}

describe('RevealStateContext', () => {
  test('default (no provider) reads revealed=false and setRevealed is a no-op', () => {
    render(<Consumer />);
    expect(screen.getByRole('button')).toHaveTextContent('off');
    // No provider: the no-op setter must not throw on click.
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByRole('button')).toHaveTextContent('off');
  });

  test('toggling through the provider flips revealed', () => {
    render(<Host />);
    const button = screen.getByRole('button');
    expect(button).toHaveTextContent('off');
    fireEvent.click(button);
    expect(button).toHaveTextContent('on');
    fireEvent.click(button);
    expect(button).toHaveTextContent('off');
  });
});
