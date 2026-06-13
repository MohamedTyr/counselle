/**
 * ChatContext — the single seam between the chat surfaces and the transport.
 *
 * FE-3: submitMessage streams real mock protocol events through the pure turn
 * reducer (src/api/turn-reducer.ts); the reducer's view-state is projected
 * into the TMessage-ish shape the vendored message components render. The
 * surface mirrors upstream useChatHelpers, trimmed: ask/regenerate implement
 * truncate-and-re-ask (PRD decision 4), stopGenerating is transport.cancel
 * (§27.4), and transcripts reload through the SAME reducer (§27.5/§34).
 *
 * ChatContext is the ONLY place that knows which transport is active.
 */
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useAtom } from 'jotai';
import { useQueryClient } from '@tanstack/react-query';
import { activeConversationIdAtom } from '@/app/state';
import { createChat, getChat } from '@/api/mock/store';
import { QueryKeys } from '@/api/hooks';
import { mockTransport } from '@/api/mock/transport';
import * as messagesStore from '@/api/mock/messagesStore';
import { getFeedback } from '@/api/mock/feedbackStore';
import {
  deriveDurationMs,
  initialTurnState,
  proseOf,
  reduce,
  reduceTranscriptEntry,
  toStepRecord,
  type ContentBlock,
  type TimelineEntry,
  type TurnState,
  type TurnStatus,
} from '@/api/turn-reducer';
import type {
  AssistantContentPart,
  ClarifySpec,
  ErrorData,
  SourceEntry,
  StepRecord,
  TranscriptAssistantEntry,
  TranscriptEntry,
} from '@/api/protocol';
import type { Transport } from '@/api/transport';

// ── Message shape (what the vendored components consume) ─────────────────────

export type ChatMessage = {
  messageId: string;
  conversationId: string;
  parentMessageId: string | null;
  /** Concatenated prose (user text, or the turn's markdown joined). */
  text: string;
  isCreatedByUser: boolean;
  sender: string;
  error: boolean;
  unfinished: boolean;
  /** Ordered render blocks (assistant only) — reference-stable when unchanged. */
  content?: ContentBlock[];
  stepRecord?: StepRecord;
  /** Live-turn receipt line: the latest activity while streaming. */
  activity?: string;
  /** FE-4: the activity timeline (steps + thinking, arrival order). */
  timeline?: TimelineEntry[];
  /** FE-4: the derived one-line receipt the timeline collapses to at done. */
  receipt?: string;
  /** FE-4: total worked time (sum of step receipt durations). */
  durationMs?: number;
  sources?: SourceEntry[];
  clarify?: ClarifySpec;
  turnStatus?: TurnStatus;
  streamError?: ErrorData;
  feedback?: { rating: 'thumbsUp' | 'thumbsDown'; tag?: { key: string }; text?: string };
  ts: string | null;
};

export type AskProps = {
  text: string;
  /** When re-asking an edited user message: the message being replaced. */
  messageId?: string | null;
  parentMessageId?: string | null;
  conversationId?: string | null;
};

type ChatContextValue = {
  conversationId: string | null;
  isSubmitting: boolean;
  messages: ChatMessage[];
  latestMessage: ChatMessage | null;
  latestMessageId: string | undefined;
  submitMessage: (text: string) => Promise<void>;
  /** Truncate-and-re-ask (PRD decision 4) — EditMessage's save-and-submit. */
  ask: (props: AskProps) => void;
  /** Re-run the turn that produced `message` (an assistant message). */
  regenerate: (message: ChatMessage) => void;
  /** Edit-in-place without re-asking — EditMessage's plain save. */
  updateMessageText: (messageId: string, text: string) => void;
  stopGenerating: () => void;
  newConversation: () => void;
  /** True while the open conversation's latest turn is parked on a clarifying
   *  question (PRD 23–25) — typing is answering; the composer swaps placeholder. */
  awaitingClarify: boolean;
  /** Vendored scroll hooks read/set this (user scroll detaches auto-follow). */
  abortScroll: boolean;
  setAbortScroll: (value: boolean) => void;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

// ── Projection helpers ───────────────────────────────────────────────────────

function feedbackOf(
  conversationId: string,
  messageId: string,
): ChatMessage['feedback'] {
  const stored = getFeedback(conversationId, messageId);
  if (stored === undefined) {
    return undefined;
  }
  return {
    rating: stored.rating,
    tag: stored.tag !== undefined ? { key: stored.tag } : undefined,
    text: stored.text,
  };
}

/** Project a persisted transcript into ChatMessages — assistant entries reduce
 * through the SAME turn reducer the live stream used. */
function messagesFromTranscript(conversationId: string, entries: TranscriptEntry[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  entries.forEach((entry, i) => {
    const messageId = entry.message_id ?? `msg-${conversationId}-${i}`;
    const parentMessageId = i > 0 ? (messages[i - 1]?.messageId ?? null) : null;
    if (entry.role === 'user') {
      messages.push({
        messageId,
        conversationId,
        parentMessageId,
        text: entry.text,
        isCreatedByUser: true,
        sender: '',
        error: false,
        unfinished: false,
        ts: entry.ts,
      });
      return;
    }
    const state = reduceTranscriptEntry(entry);
    messages.push(assistantMessage(conversationId, messageId, parentMessageId, state, entry.ts));
  });
  return messages;
}

function assistantMessage(
  conversationId: string,
  messageId: string,
  parentMessageId: string | null,
  state: TurnState,
  ts: string | null,
): ChatMessage {
  const record = toStepRecord(state);
  const activeStep = [...state.steps].reverse().find((s) => s.status === 'start');
  const lastThinking = state.thinking[state.thinking.length - 1];
  return {
    messageId,
    conversationId,
    parentMessageId,
    text: proseOf(state),
    isCreatedByUser: false,
    sender: 'Counselle',
    error: false,
    unfinished: state.status === 'cancelled',
    content: state.blocks,
    stepRecord: record,
    activity:
      state.status === 'streaming' || state.status === 'idle'
        ? (activeStep?.label ?? lastThinking ?? record?.receipt)
        : record?.receipt,
    timeline: state.timeline,
    receipt: record?.receipt,
    durationMs: deriveDurationMs(state.steps),
    sources: state.sources.length > 0 ? state.sources : undefined,
    clarify: state.clarify ?? undefined,
    turnStatus: state.status,
    streamError: state.error ?? undefined,
    feedback: feedbackOf(conversationId, messageId),
    ts,
  };
}

/** Map the reducer's final status to the persisted §27.5 status field. */
function entryStatusOf(status: TurnStatus): TranscriptAssistantEntry['status'] {
  if (status === 'error') {
    return 'error';
  }
  if (status === 'cancelled') {
    return 'cancelled';
  }
  if (status === 'awaiting_input') {
    return 'awaiting_input';
  }
  return 'complete';
}

function blocksToParts(blocks: ContentBlock[]): AssistantContentPart[] {
  return blocks.map((block) =>
    block.kind === 'markdown'
      ? { type: 'text' as const, text: block.text }
      : { type: 'viz' as const, spec: block.spec },
  );
}

// ── Provider ─────────────────────────────────────────────────────────────────

type LiveTurn = {
  conversationId: string;
  assistantMessageId: string;
  parentMessageId: string;
  state: TurnState;
};

export function ChatProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useAtom(activeConversationIdAtom);
  const [persisted, setPersisted] = useState<ChatMessage[]>([]);
  const [turn, setTurn] = useState<LiveTurn | null>(null);
  const [abortScroll, setAbortScroll] = useState(false);

  /** The single transport in use — MockTransport until FE-7. */
  const transport: Transport = mockTransport;

  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const turnRef = useRef(turn);
  turnRef.current = turn;

  const loadTranscript = useCallback((convoId: string) => {
    setPersisted(messagesFromTranscript(convoId, messagesStore.getTranscript(convoId)));
  }, []);

  // Reload persisted messages when the open conversation changes.
  useEffect(() => {
    if (conversationId !== null) {
      loadTranscript(conversationId);
    } else {
      setPersisted([]);
    }
    setAbortScroll(false);
  }, [conversationId, loadTranscript]);

  const isSubmitting =
    turn !== null &&
    turn.conversationId === conversationId &&
    (turn.state.status === 'streaming' || turn.state.status === 'idle');

  // ── The turn loop ───────────────────────────────────────────────────────────

  const runTurn = useCallback(
    async (convoId: string, userMessageId: string, text: string) => {
      const assistantMessageId = `msg-${crypto.randomUUID()}`;
      let state = initialTurnState();
      setTurn({
        conversationId: convoId,
        assistantMessageId,
        parentMessageId: userMessageId,
        state,
      });
      try {
        for await (const event of transport.sendMessage(convoId, { text })) {
          state = reduce(state, event);
          setTurn({
            conversationId: convoId,
            assistantMessageId,
            parentMessageId: userMessageId,
            state,
          });
        }
      } finally {
        const entry: TranscriptAssistantEntry = {
          role: 'assistant',
          message_id: assistantMessageId,
          text: proseOf(state),
          ts: new Date().toISOString(),
          step_record: toStepRecord(state),
          parts: blocksToParts(state.blocks),
          // FE-4: a clarify-parked turn persists its spec + awaiting status so
          // the widget freezes into the transcript record (PRD 25) and the
          // composer placeholder survives a reload (PRD 24). B2: the entry
          // shape is {spec, answer} — a just-parked turn is unanswered (null);
          // B5 threads the persisted answer end-to-end.
          clarify: state.clarify ? { spec: state.clarify, answer: null } : undefined,
          sources: state.sources.length > 0 ? state.sources : undefined,
          usage: state.usage ?? undefined,
          status: entryStatusOf(state.status),
          error: state.error ?? undefined,
        };
        messagesStore.appendEntry(convoId, entry);
        setPersisted((prev) => [
          ...prev,
          assistantMessage(
            convoId,
            assistantMessageId,
            userMessageId,
            // Project from the persisted entry — the same path a reload takes.
            reduceTranscriptEntry(entry),
            entry.ts,
          ),
        ]);
        setTurn(null);
      }
    },
    [transport],
  );

  const submitMessage = useCallback(
    async (text: string) => {
      if (turnRef.current !== null) {
        return;
      }
      let activeId = conversationIdRef.current;
      if (activeId === null || getChat(activeId) === undefined) {
        const newChat = createChat(text.slice(0, 60) || 'New chat');
        activeId = newChat.conversationId;
        setConversationId(activeId);
        void queryClient.invalidateQueries([QueryKeys.chats]);
        navigate(`/c/${activeId}`, { replace: false });
      }

      const userMessageId = `msg-${crypto.randomUUID()}`;
      const ts = new Date().toISOString();
      messagesStore.appendEntry(activeId, {
        role: 'user',
        message_id: userMessageId,
        text,
        ts,
      });
      setPersisted((prev) => [
        ...prev,
        {
          messageId: userMessageId,
          conversationId: activeId,
          parentMessageId: prev[prev.length - 1]?.messageId ?? null,
          text,
          isCreatedByUser: true,
          sender: '',
          error: false,
          unfinished: false,
          ts,
        },
      ]);
      setAbortScroll(false);
      await runTurn(activeId, userMessageId, text);
    },
    [navigate, queryClient, runTurn, setConversationId],
  );

  // ── Truncate-and-re-ask (edit / regenerate) ────────────────────────────────

  const truncateAt = useCallback(
    (messageId: string): boolean => {
      const convoId = conversationIdRef.current;
      if (convoId === null) {
        return false;
      }
      const entries = messagesStore.getTranscript(convoId);
      const idx = entries.findIndex((e) => e.message_id === messageId);
      if (idx === -1) {
        return false;
      }
      messagesStore.truncateFrom(convoId, idx);
      loadTranscript(convoId);
      return true;
    },
    [loadTranscript],
  );

  const ask = useCallback(
    ({ text, messageId }: AskProps) => {
      if (turnRef.current !== null) {
        return;
      }
      if (messageId !== undefined && messageId !== null) {
        truncateAt(messageId);
      }
      void submitMessage(text);
    },
    [submitMessage, truncateAt],
  );

  const regenerate = useCallback(
    (message: ChatMessage) => {
      if (turnRef.current !== null || message.isCreatedByUser) {
        return;
      }
      const convoId = conversationIdRef.current;
      if (convoId === null) {
        return;
      }
      const entries = messagesStore.getTranscript(convoId);
      const idx = entries.findIndex((e) => e.message_id === message.messageId);
      // The user turn that produced this answer precedes it.
      const userEntry = idx > 0 ? entries[idx - 1] : undefined;
      if (userEntry === undefined || userEntry.role !== 'user') {
        return;
      }
      messagesStore.truncateFrom(convoId, idx - 1);
      loadTranscript(convoId);
      void submitMessage(userEntry.text);
    },
    [loadTranscript, submitMessage],
  );

  const updateMessageText = useCallback(
    (messageId: string, text: string) => {
      const convoId = conversationIdRef.current;
      if (convoId === null) {
        return;
      }
      const entries = messagesStore.getTranscript(convoId);
      const idx = entries.findIndex((e) => e.message_id === messageId);
      if (idx === -1) {
        return;
      }
      messagesStore.updateEntryText(convoId, idx, text);
      loadTranscript(convoId);
    },
    [loadTranscript],
  );

  const stopGenerating = useCallback(() => {
    const active = turnRef.current;
    if (active !== null) {
      void transport.cancel(active.conversationId);
    }
  }, [transport]);

  const newConversation = useCallback(() => {
    setConversationId(null);
    setPersisted([]);
    navigate('/');
  }, [navigate, setConversationId]);

  // ── Projection: persisted + the live streaming message ─────────────────────

  const messages = useMemo<ChatMessage[]>(() => {
    if (turn === null || turn.conversationId !== conversationId) {
      return persisted;
    }
    return [
      ...persisted,
      assistantMessage(
        turn.conversationId,
        turn.assistantMessageId,
        turn.parentMessageId,
        turn.state,
        null,
      ),
    ];
  }, [persisted, turn, conversationId]);

  const latestMessage = messages.length > 0 ? messages[messages.length - 1] : null;

  // The open conversation is awaiting a clarify answer when its latest turn —
  // live or just-persisted (the stream ends at done(awaiting_input)) — parked
  // with a clarify spec. `messages` only ever holds the open conversation.
  const awaitingClarify =
    latestMessage !== null &&
    !latestMessage.isCreatedByUser &&
    latestMessage.turnStatus === 'awaiting_input' &&
    latestMessage.clarify !== undefined;

  const value = useMemo<ChatContextValue>(
    () => ({
      conversationId,
      isSubmitting,
      messages,
      latestMessage,
      latestMessageId: latestMessage?.messageId,
      submitMessage,
      ask,
      regenerate,
      updateMessageText,
      stopGenerating,
      newConversation,
      awaitingClarify,
      abortScroll,
      setAbortScroll,
    }),
    [
      conversationId,
      isSubmitting,
      messages,
      latestMessage,
      submitMessage,
      ask,
      regenerate,
      updateMessageText,
      stopGenerating,
      newConversation,
      awaitingClarify,
      abortScroll,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (ctx === undefined) {
    throw new Error('useChatContext must be used within ChatProvider');
  }
  return ctx;
}
