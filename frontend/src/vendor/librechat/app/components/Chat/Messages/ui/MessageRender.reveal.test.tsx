import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, test, vi } from 'vitest';
import type { ChatMessage } from '@/api/projectTranscript';

vi.mock('~/components/Chat/Messages/Content/MessageContent', () => ({
  default: ({ text }: { text: string }) => <div>{text}</div>,
}));

vi.mock('~/components/Chat/Messages/ui/PlaceholderRow', () => ({
  default: () => <div data-testid="placeholder-row" />,
}));

vi.mock('~/components/Chat/Messages/HoverButtons', () => ({
  default: () => <div data-testid="hover-buttons" />,
}));

vi.mock('~/components/Chat/Messages/SubRow', () => ({
  default: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/citations/MessageSources', () => ({
  default: () => <div data-testid="message-sources" />,
}));

vi.mock('~/hooks/Messages/useMessageActions', () => ({
  default: () => ({
    ask: vi.fn(),
    edit: false,
    enterEdit: vi.fn(),
    messageLabel: 'assistant',
    handleFeedback: vi.fn(),
    copyToClipboard: vi.fn(),
    latestMessageId: 'm1',
    regenerateMessage: vi.fn(),
  }),
}));

vi.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

import MessageRender from './MessageRender';

function source(index: number, sourceName: 'ipeds' | 'edu') {
  return {
    index,
    label: sourceName === 'ipeds' ? 'Counselle data' : 'School site',
    citation: {
      source: sourceName,
      tier: 'official',
      vintage: '2026',
    },
  };
}

function assistantMessage(sources = [source(1, 'ipeds')]): ChatMessage {
  return {
    messageId: 'm1',
    conversationId: 'c1',
    isCreatedByUser: false,
    text: 'Admission rate is 42% [1].',
    content: [{ kind: 'markdown', text: 'Admission rate is 42% [1].' }],
    sources,
  } as unknown as ChatMessage;
}

function renderMessage(message: ChatMessage) {
  return render(
    <MessageRender
      message={message}
      currentEditId={null}
      setCurrentEditId={vi.fn()}
      isLatestMessage={false}
    />,
  );
}

describe('MessageRender reveal toggle', () => {
  test('shows for DB-cited assistant prose and toggles its pressed state', () => {
    renderMessage(assistantMessage());

    const toggle = screen.getByRole('button', { name: "Show what's from Counselle" });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute('aria-pressed', 'true');
  });

  test('stays hidden for external-only cited assistant prose', () => {
    renderMessage(assistantMessage([source(1, 'edu')]));

    expect(
      screen.queryByRole('button', { name: "Show what's from Counselle" }),
    ).not.toBeInTheDocument();
  });
});
