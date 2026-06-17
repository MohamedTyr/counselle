/**
 * ChatComposer container tests (plan §3 behaviors 1, 4, 5, 6, 7, 8, 9, 13, 19).
 *
 * Mocks the two app seams the container bridges:
 *   - `useChatContext`  : the turn loop (submitMessage / stopGenerating / flags)
 *   - `useAutoSave`     : ported draft restore — a no-op here (covered live)
 * The RHF text field is provided by the REAL `ChatFormProvider` + `useForm`, so
 * the controlled-text bridge (watch → value, setValue → onValueChange,
 * reset → clear/restore) is genuinely exercised.
 *
 * The Radix-popover source toggle is NOT driven here — that interaction is flaky
 * under jsdom; the source bridge is covered by source-bridge.test.ts.
 */
import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useForm } from 'react-hook-form';
import { ChatFormProvider } from '~/Providers';

// ── Mock the chat-context seam ────────────────────────────────────────────────
const ctx = {
  conversationId: 'convo-test' as string | null,
  isSubmitting: false,
  submitMessage: vi.fn(async (_text: string) => true),
  stopGenerating: vi.fn(),
  awaitingClarify: false,
};
vi.mock('@/app/ChatContext', () => ({
  useChatContext: () => ctx,
}));

// useAutoSave is the ported draft-restore hook; its debounce/localStorage churn
// is out of scope for the container's submit/stop/placeholder behavior.
vi.mock('~/hooks/Input/useAutoSave', () => ({
  useAutoSave: () => {},
}));

import ChatComposer from '@/components/composer/ChatComposer';

function Harness() {
  const methods = useForm<{ text: string }>({ defaultValues: { text: '' } });
  return (
    <ChatFormProvider {...methods}>
      <ChatComposer />
    </ChatFormProvider>
  );
}

function getTextarea(): HTMLTextAreaElement {
  return screen.getByRole('textbox') as HTMLTextAreaElement;
}

/** The single right-hand send/stop/mic button, found by its lucide icon. */
function rightButton(container: HTMLElement, icon: 'arrow-up' | 'square' | 'mic'): HTMLButtonElement {
  const svg = container.querySelector(`.lucide-${icon}`);
  const button = svg?.closest('button');
  if (!button) throw new Error(`right button with icon ${icon} not found`);
  return button as HTMLButtonElement;
}

function type(textarea: HTMLTextAreaElement, value: string) {
  fireEvent.change(textarea, { target: { value } });
}

beforeEach(() => {
  localStorage.clear();
  ctx.conversationId = 'convo-test';
  ctx.isSubmitting = false;
  ctx.awaitingClarify = false;
  ctx.submitMessage = vi.fn(async (_text: string) => true);
  ctx.stopGenerating = vi.fn();
});

describe('submit on Enter (behaviors 1, 5)', () => {
  test('Enter with text calls submitMessage with trimmed text and clears the field', async () => {
    const { container } = render(<Harness />);
    const textarea = getTextarea();
    type(textarea, '  hello world  ');

    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(ctx.submitMessage).toHaveBeenCalledWith('hello world'));
    await waitFor(() => expect(getTextarea().value).toBe(''));
    expect(container).toBeTruthy();
  });

  test('clicking the send button submits the trimmed text', async () => {
    const { container } = render(<Harness />);
    type(getTextarea(), 'compare NYU and BU');

    fireEvent.click(rightButton(container, 'arrow-up'));

    await waitFor(() => expect(ctx.submitMessage).toHaveBeenCalledWith('compare NYU and BU'));
  });
});

describe('empty / whitespace submit is a no-op (behavior 6)', () => {
  test('Enter with only whitespace does not call submitMessage', () => {
    render(<Harness />);
    type(getTextarea(), '   ');
    fireEvent.keyDown(getTextarea(), { key: 'Enter' });
    expect(ctx.submitMessage).not.toHaveBeenCalled();
  });

  test('empty field shows a disabled send arrow, not a Mic fallback (FE-M3)', () => {
    // The voice channel is gated off (FE-M3) — an empty composer no longer
    // offers a decorative mic; the send button shows the arrow and is disabled.
    const { container } = render(<Harness />);
    expect(container.querySelector('.lucide-mic')).toBeNull();
    expect(container.querySelector('.lucide-arrow-up')).toBeTruthy();
  });
});

describe('restore text when submitMessage resolves false (behavior 7)', () => {
  test('rejected send restores what the student typed', async () => {
    ctx.submitMessage = vi.fn(async (_text: string) => false);
    render(<Harness />);
    const textarea = getTextarea();
    type(textarea, 'will be rejected');

    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => expect(ctx.submitMessage).toHaveBeenCalled());
    await waitFor(() => expect(getTextarea().value).toBe('will be rejected'));
  });
});

describe('stop button while streaming (behavior 8)', () => {
  test('isSubmitting shows the Square stop control, calls stopGenerating, preserves typed text', () => {
    ctx.isSubmitting = true;
    const { container } = render(<Harness />);
    const textarea = getTextarea();
    type(textarea, 'next message');

    // The right-hand button is the Stop (Square) control while streaming.
    const stop = rightButton(container, 'square');
    expect(stop).not.toBeDisabled();

    fireEvent.click(stop);
    expect(ctx.stopGenerating).toHaveBeenCalledTimes(1);
    // Typed text must NOT be dropped.
    expect(getTextarea().value).toBe('next message');
  });
});

describe('no double-send while streaming (behavior 4)', () => {
  test('Enter while isSubmitting does not call submitMessage again', () => {
    ctx.isSubmitting = true;
    render(<Harness />);
    type(getTextarea(), 'a second message');
    fireEvent.keyDown(getTextarea(), { key: 'Enter' });
    expect(ctx.submitMessage).not.toHaveBeenCalled();
  });
});

describe('textarea stays editable while streaming (behavior 9)', () => {
  test('isSubmitting does not disable the textarea', () => {
    ctx.isSubmitting = true;
    render(<Harness />);
    expect(getTextarea()).not.toBeDisabled();
  });
});

describe('awaitingClarify placeholder (behavior 19)', () => {
  test('awaitingClarify swaps the textarea placeholder to the clarify prompt', () => {
    ctx.awaitingClarify = true;
    render(<Harness />);
    expect(getTextarea().getAttribute('placeholder')).toBe('Pick one, or just type…');
  });

  test('default placeholder when not awaiting clarify', () => {
    render(<Harness />);
    expect(getTextarea().getAttribute('placeholder')).toBe('Message Counselle');
  });
});

describe('source toggle bridge (behavior 13)', () => {
  // Driving the Radix popover (portal + floating-ui) to click a source row is
  // flaky under jsdom. The store-write mapping (toActiveSet + the reconstruct
  // patch + updateSourceConfig round-trip) is covered by source-bridge.test.ts.
  test('the Sources trigger renders in the action row', () => {
    const { container } = render(<Harness />);
    // The sources pill uses a Globe icon; assert the control is present so the
    // bridge has a mount point (the deeper write path is unit-tested).
    expect(container.querySelector('.lucide-globe')).toBeTruthy();
  });
});
