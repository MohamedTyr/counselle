/**
 * Keyboard / Enter-key tests (plan §3 behaviors 1, 2, 3, 4).
 *
 * Renders the controlled `CounselleComposer` directly with the props the
 * container would pass, and exercises the `PromptInputTextarea` key handler:
 *   - enterToSend=true  : Enter sends, Shift+Enter newlines
 *   - enterToSend=false : plain Enter newlines, Ctrl/Cmd+Enter sends
 *   - IME composition   : never sends
 *   - isLoading         : never sends (no double-send while streaming)
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CounselleComposer } from '@/components/composer/CounselleComposer';
import { SUBREDDITS } from '@/api/sourceConfigStore';

function renderComposer(over: Partial<React.ComponentProps<typeof CounselleComposer>> = {}) {
  const onSend = vi.fn();
  const onValueChange = vi.fn();
  render(
    <CounselleComposer
      value="hello"
      onValueChange={onValueChange}
      onSend={onSend}
      isLoading={false}
      enterToSend={true}
      active={new Set(['web'])}
      subs={[...SUBREDDITS]}
      onSourcesChange={vi.fn()}
      {...over}
    />,
  );
  const textarea = screen.getByRole('textbox') as HTMLTextAreaElement;
  return { onSend, onValueChange, textarea };
}

beforeEach(() => {
  localStorage.clear();
});

describe('enterToSend=true (behaviors 1, 2)', () => {
  test('Enter without shift sends', () => {
    const { onSend, textarea } = renderComposer({ enterToSend: true });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test('Shift+Enter inserts a newline (does not send)', () => {
    const { onSend, textarea } = renderComposer({ enterToSend: true });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('enterToSend=false (behavior 2)', () => {
  test('plain Enter does NOT send (newline)', () => {
    const { onSend, textarea } = renderComposer({ enterToSend: false });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  test('Ctrl+Enter sends', () => {
    const { onSend, textarea } = renderComposer({ enterToSend: false });
    fireEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  test('Meta+Enter (Cmd) sends', () => {
    const { onSend, textarea } = renderComposer({ enterToSend: false });
    fireEvent.keyDown(textarea, { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
  });
});

describe('IME composition guard (behavior 3)', () => {
  test('keyCode 229 (IME composing) Enter does NOT send', () => {
    const { onSend, textarea } = renderComposer({ enterToSend: true });
    fireEvent.keyDown(textarea, { key: 'Enter', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
  });

  test("key 'Process' (Safari IME) does NOT send", () => {
    const { onSend, textarea } = renderComposer({ enterToSend: true });
    fireEvent.keyDown(textarea, { key: 'Process' });
    expect(onSend).not.toHaveBeenCalled();
  });
});

describe('isLoading guard — no double-send while streaming (behavior 4)', () => {
  test('Enter while isLoading does NOT send', () => {
    const { onSend, textarea } = renderComposer({ enterToSend: true, isLoading: true });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });
});
