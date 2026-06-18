import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';
import type { ChatMessage } from '@/app/ChatContext';
import type { Citation, CitationEnvelope, RenderSpec, SourceEntry } from '@/api/protocol';
import MessageRender from './MessageRender';

vi.mock('~/hooks', () => ({
  useLocalize: () => (key: string) => key,
}));

vi.mock('~/hooks/Messages/useMessageActions', () => ({
  default: () => ({
    ask: vi.fn(),
    edit: false,
    enterEdit: vi.fn(),
    messageLabel: 'Counselle',
    handleFeedback: vi.fn(),
    copyToClipboard: vi.fn(),
    latestMessageId: 'm1',
    regenerateMessage: vi.fn(),
  }),
}));

vi.mock('@/app/ChatContext', async () => {
  const actual = await vi.importActual<typeof import('@/app/ChatContext')>('@/app/ChatContext');
  return {
    ...actual,
    useChatContext: () => ({
      ask: vi.fn(),
      regenerate: vi.fn(),
      latestMessageId: 'm1',
      isSubmitting: false,
      conversationId: 'c1',
      submitMessage: vi.fn(),
    }),
  };
});

vi.mock('~/components/Chat/Messages/HoverButtons', () => ({
  default: () => <div data-testid="hover-buttons" />,
}));

function citation(over: Partial<Citation> = {}): Citation {
  return { source: 'cds', tier: 'official', vintage: 'CDS 2025-26', ...over };
}

function source(index: number, sourceName: Citation['source'] = 'ipeds'): SourceEntry {
  return {
    index,
    label: sourceName === 'ipeds' ? 'Counselle data' : 'School site',
    citation: citation({ source: sourceName }),
  };
}

function env(over: Partial<CitationEnvelope> = {}): CitationEnvelope {
  return {
    v: 1,
    field: 'adm.acceptance_rate',
    label: 'Acceptance rate',
    display: '12.5%',
    raw: 0.125,
    available: true,
    citation: citation(),
    ...over,
  };
}

function comparison(cell: CitationEnvelope): RenderSpec {
  return {
    v: 1,
    type: 'comparison_table',
    title: 'Aid comparison',
    schools: [{ unitid: 1, name: 'School A' }],
    rows: [{ label: 'Average aid', cells: [cell] }],
  };
}

function message(over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    messageId: 'm1',
    conversationId: 'c1',
    parentMessageId: null,
    text: '',
    isCreatedByUser: false,
    sender: 'Counselle',
    error: false,
    unfinished: false,
    turnStatus: 'complete',
    ts: null,
    ...over,
  };
}

function renderMessage(msg: ChatMessage, props: { isSubmitting?: boolean } = {}) {
  return render(
    <MessageRender
      message={msg}
      currentEditId={null}
      setCurrentEditId={vi.fn()}
      isLatestMessage
      isSubmitting={props.isSubmitting ?? false}
    />,
  );
}

describe('MessageRender DB reveal toggle', () => {
  test('DB-cited assistant prose shows toggle and toggles pressed state', () => {
    renderMessage(
      message({
        text: 'Admission rate is 42% [1].',
        content: [{ kind: 'markdown', text: 'Admission rate is 42% [1].' }],
        sources: [source(1, 'ipeds')],
      }),
    );

    const toggle = screen.getByRole('button', { name: /show what's from counselle/i });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: /hide/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('completed viz-only DB answer shows toggle and reveals DB card cells', () => {
    const { container } = renderMessage(
      message({ content: [{ kind: 'viz', spec: comparison(env({ display: '$74,310' })) }] }),
    );

    const toggle = screen.getByRole('button', { name: /show what's from counselle/i });
    expect(toggle).toBeInTheDocument();
    expect(container.querySelectorAll('[data-db-viz-cell][data-revealed]')).toHaveLength(0);

    fireEvent.click(toggle);

    expect(screen.getByRole('button', { name: /hide/i })).toBeInTheDocument();
    const revealed = container.querySelectorAll('[data-db-viz-cell][data-revealed]');
    expect(revealed).toHaveLength(1);
    expect(revealed[0]).toHaveTextContent('$74,310');
  });

  test('external-only and unavailable-only content hide the toggle', () => {
    const externalProse = renderMessage(
      message({
        text: 'Admission rate is discussed here [1].',
        content: [{ kind: 'markdown', text: 'Admission rate is discussed here [1].' }],
        sources: [source(1, 'edu')],
      }),
    );
    expect(screen.queryByRole('button', { name: /show what's from counselle/i })).toBeNull();
    externalProse.unmount();

    const externalViz = renderMessage(
      message({
        content: [
          {
            kind: 'viz',
            spec: comparison(
              env({
                display: 'External value',
                citation: citation({ source: 'web', tier: 'official' }),
              }),
            ),
          },
        ],
      }),
    );
    expect(screen.queryByRole('button', { name: /show what's from counselle/i })).toBeNull();
    externalViz.unmount();

    renderMessage(
      message({
        content: [
          {
            kind: 'viz',
            spec: comparison(env({ available: false, display: 'not available', raw: null })),
          },
        ],
      }),
    );
    expect(screen.queryByRole('button', { name: /show what's from counselle/i })).toBeNull();
  });

  test('non-settled, errored, and submitting messages hide the toggle', () => {
    const awaiting = renderMessage(
      message({
        turnStatus: 'awaiting_input',
        content: [{ kind: 'viz', spec: comparison(env()) }],
      }),
    );
    expect(screen.queryByRole('button', { name: /show what's from counselle/i })).toBeNull();
    awaiting.unmount();

    const errored = renderMessage(
      message({
        error: true,
        content: [{ kind: 'viz', spec: comparison(env()) }],
      }),
    );
    expect(screen.queryByRole('button', { name: /show what's from counselle/i })).toBeNull();
    errored.unmount();

    renderMessage(
      message({ content: [{ kind: 'viz', spec: comparison(env()) }] }),
      { isSubmitting: true },
    );
    expect(screen.queryByRole('button', { name: /show what's from counselle/i })).toBeNull();
  });

  test('rerenders reveal gate when turnStatus changes to complete', () => {
    const content = [{ kind: 'viz' as const, spec: comparison(env()) }];
    const setCurrentEditId = vi.fn();
    const first = message({ turnStatus: 'awaiting_input', content });
    const next = message({ turnStatus: 'complete', content });
    const view = render(
      <MessageRender
        message={first}
        currentEditId={null}
        setCurrentEditId={setCurrentEditId}
        isLatestMessage
      />,
    );

    expect(screen.queryByRole('button', { name: /show what's from counselle/i })).toBeNull();

    view.rerender(
      <MessageRender
        message={next}
        currentEditId={null}
        setCurrentEditId={setCurrentEditId}
        isLatestMessage
      />,
    );

    expect(screen.getByRole('button', { name: /show what's from counselle/i })).toBeInTheDocument();
  });
});
