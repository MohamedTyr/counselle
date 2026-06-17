/**
 * FE-M3 — the composer hides the dead upload + voice affordances (no image/voice
 * channel exists in the MVP2 turn endpoint). With both off: no upload button,
 * and the send button is NOT a voice/mic fallback when there's no content — it
 * is disabled until the user types something.
 */
import { describe, expect, test, vi } from 'vitest';
import { render } from '@testing-library/react';
import { CounselleComposer } from './CounselleComposer';
import type { SourceId } from './SourcesControl';

function renderComposer(value: string) {
  return render(
    <CounselleComposer
      value={value}
      onValueChange={vi.fn()}
      onSend={vi.fn()}
      active={new Set<SourceId>(['web'])}
      subs={[]}
      onSourcesChange={vi.fn()}
    />,
  );
}

/** The single action (send) button — the only `rounded-full h-8 w-8` Button once
 *  the upload affordance is gated off (FE-M3). */
function sendButton(container: HTMLElement): HTMLButtonElement {
  const btn = container.querySelector<HTMLButtonElement>('button.h-8.w-8.rounded-full');
  if (btn === null) {
    throw new Error('send action button not found');
  }
  return btn;
}

describe('FE-M3 — composer hides dead upload/voice affordances', () => {
  test('renders no upload affordance while upload is disabled', () => {
    const { container } = renderComposer('');
    // No Paperclip upload button and no file <input> is mounted.
    expect(container.querySelector('input[type="file"]')).toBeNull();
    expect(container.querySelector('.lucide-paperclip')).toBeNull();
  });

  test('send button is disabled (not a mic/voice fallback) with empty content', () => {
    const { container } = renderComposer('');
    // The send icon is the up-arrow, never the mic — and the button is disabled.
    expect(container.querySelector('.lucide-mic')).toBeNull();
    const send = sendButton(container);
    expect(send).toBeDisabled();
    expect(send.querySelector('.lucide-arrow-up')).not.toBeNull();
  });

  test('send button is enabled once there is text content', () => {
    const { container } = renderComposer('hello');
    const send = sendButton(container);
    expect(send).toBeEnabled();
    expect(send.querySelector('.lucide-arrow-up')).not.toBeNull();
  });
});
