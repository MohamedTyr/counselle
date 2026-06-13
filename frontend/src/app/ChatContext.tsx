/**
 * ChatContext — the single seam between the chat surfaces and the transport.
 *
 * B5a: the mock-store bypass is removed. The transcript comes from
 * `transport.transcript(sessionId)`; the server persists (no client-side
 * transcript writes). The new-chat flow awaits `transport.createSession()`.
 * Identity is backend-owned: the optimistic user echo and the assistant
 * message get temp ids, reconciled to `meta.user_message_id` / `meta.message_id`
 * when the stream opens — feedback/edit then address backend ids only. The turn
 * loop has error handling: a failed send keeps the composer text (the composer
 * clears only after `meta` arrives) and offers retry; 409 → cancel-then-retry-
 * once; 429 → a Retry-After message; a stream error → the error card.
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
import { QueryKeys } from '@/api/hooks';
import { transport } from '@/api/selectTransport';
import { isTransportError, TransportError } from '@/api/http/errors';
import { toWire, fromWire } from '@/api/source-config';
import { getSourceConfig, updateSourceConfig } from '@/api/mock/sourceStore';
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
  ClarifySpec,
  ErrorData,
  SourceEntry,
  StepRecord,
  TranscriptEntry,
} from '@/api/protocol';

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
  feedback?: { rating: 'thumbsUp' | 'thumbsDown' };
  ts: string | null;
};

/** A surfaced turn error the composer renders (retry keeps the kept text). */
export type TurnError =
  | { kind: 'rate_limited'; message: string; retryAfter?: number }
  | { kind: 'unauthorized' | 'network' | 'server' | 'stream'; message: string };

/** A transcript-load failure — opening an existing chat couldn't read it.
 *  Surfaced as an honest banner + retry, never a silently-blank conversation. */
export type TranscriptError = {
  kind: 'unauthorized' | 'network' | 'server';
  message: string;
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
  /** Returns false if the send failed before/at stream start (composer keeps text). */
  submitMessage: (text: string) => Promise<boolean>;
  /** Truncate-and-re-ask (PRD decision 4) — EditMessage's save-and-submit. */
  ask: (props: AskProps) => void;
  /** Re-run the turn that produced `message` (an assistant message). */
  regenerate: (message: ChatMessage) => void;
  /** Edit-in-place without re-asking — EditMessage's plain save. */
  updateMessageText: (messageId: string, text: string) => void;
  stopGenerating: () => void;
  newConversation: () => void;
  /** The last turn's surfaced error, if any — cleared on the next submit/retry. */
  turnError: TurnError | null;
  /** Re-submit the text the last failed send kept (inline retry). */
  retryLastSend: () => void;
  /** Set when opening this conversation's transcript failed — render an honest
   *  banner instead of a blank chat. Null when the load succeeded. */
  transcriptError: TranscriptError | null;
  /** Re-attempt the failed transcript load for the open conversation. */
  retryTranscript: () => void;
  /** True while the open conversation's latest turn is parked on a clarifying
   *  question (PRD 23–25) — typing is answering; the composer swaps placeholder. */
  awaitingClarify: boolean;
  /** Vendored scroll hooks read/set this (user scroll detaches auto-follow). */
  abortScroll: boolean;
  setAbortScroll: (value: boolean) => void;
};

const ChatContext = createContext<ChatContextValue | undefined>(undefined);

// ── Projection helpers ───────────────────────────────────────────────────────

/** Project a persisted transcript into ChatMessages — assistant entries reduce
 * through the SAME turn reducer the live stream used. Feedback hydrates from the
 * entry's own `feedback` field (B5a: server-joined; no client feedback store). */
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
    const message = assistantMessage(conversationId, messageId, parentMessageId, state, entry.ts);
    // Thumbs survive reload: map the entry's wire rating ('up'/'down') to the
    // component's thumbsUp/thumbsDown (mirrors the prior feedbackOf seam).
    message.feedback =
      entry.feedback !== undefined
        ? { rating: entry.feedback.rating === 'up' ? 'thumbsUp' : 'thumbsDown' }
        : undefined;
    messages.push(message);
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
    feedback: undefined,
    ts,
  };
}

function userMessage(
  conversationId: string,
  messageId: string,
  parentMessageId: string | null,
  text: string,
  ts: string | null,
): ChatMessage {
  return {
    messageId,
    conversationId,
    parentMessageId,
    text,
    isCreatedByUser: true,
    sender: '',
    error: false,
    unfinished: false,
    ts,
  };
}

// ── Provider ─────────────────────────────────────────────────────────────────

type LiveTurn = {
  conversationId: string;
  assistantMessageId: string;
  /** The optimistic user echo's id — reconciled to meta.user_message_id. */
  userMessageId: string;
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
  const [turnError, setTurnError] = useState<TurnError | null>(null);
  /** The text of a failed send, kept for inline retry. */
  const [pendingText, setPendingText] = useState<string | null>(null);
  /** A transcript-load failure for the open conversation (honest error, not a
   *  blank chat). Cleared when the load succeeds or the conversation changes. */
  const [transcriptError, setTranscriptError] = useState<TranscriptError | null>(null);

  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  const turnRef = useRef(turn);
  turnRef.current = turn;
  /** Committed cancel: set only once `transport.cancel` RESOLVES (so we never
   *  claim "stopped" for a failed cancel). */
  const cancelledRef = useRef(false);
  /** A cancel request is in flight — guards a rapid double-click. */
  const cancelInFlightRef = useRef(false);
  /** Sessions created locally for an in-flight first send. The conversation-change
   *  effect must NOT blank+reload these: their projection is the optimistic turn,
   *  not a (still-empty) server transcript — reloading would wipe the user echo
   *  before `meta` reconciles its id (G1). Consumed once, then they reload normally. */
  const freshSessionsRef = useRef<Set<string>>(new Set());

  // Load the open conversation's transcript (server read). Extracted so the
  // FIX-3 retry banner can re-run it. A failure surfaces `transcriptError` and
  // does NOT blank `persisted` — opening an existing chat must never look like
  // a lost (empty) conversation.
  const loadTranscript = useCallback(async (convoId: string): Promise<void> => {
    setTranscriptError(null);
    try {
      const { entries, sourceConfig } = await transport.transcript(convoId);
      if (conversationIdRef.current === convoId) {
        setPersisted(messagesFromTranscript(convoId, entries));
        // Seed the source dropdown from server truth (B5c): the session's
        // persisted config wins over whatever localStorage held for this id.
        if (sourceConfig !== null) {
          updateSourceConfig(convoId, fromWire(sourceConfig));
        }
      }
    } catch (error: unknown) {
      if (conversationIdRef.current === convoId) {
        setTranscriptError(transcriptErrorOf(error));
        // Keep whatever projection was already shown; never fabricate or blank.
      }
    }
  }, []);

  // Reload persisted messages when the open conversation changes.
  useEffect(() => {
    const convoId = conversationId;
    if (convoId === null) {
      setPersisted([]);
      setTranscriptError(null);
      setAbortScroll(false);
      return;
    }
    // A just-created session with an in-flight first send owns its projection
    // (the optimistic echo + live turn); skip the blank+reload that would wipe
    // the echo before `meta` reconciles its id. Consume the flag so a later
    // reopen reloads from the server normally.
    if (freshSessionsRef.current.has(convoId)) {
      freshSessionsRef.current.delete(convoId);
      setTranscriptError(null);
      setAbortScroll(false);
      return;
    }
    // A fresh conversation starts from an empty projection; a failed load then
    // shows the banner over an empty (but honestly-flagged) view.
    setPersisted([]);
    setAbortScroll(false);
    void loadTranscript(convoId);
  }, [conversationId, loadTranscript]);

  const isSubmitting =
    turn !== null &&
    turn.conversationId === conversationId &&
    (turn.state.status === 'streaming' || turn.state.status === 'idle');

  // ── The turn loop ───────────────────────────────────────────────────────────

  const runTurn = useCallback(
    async (convoId: string, tempUserMessageId: string, text: string): Promise<void> => {
      const tempAssistantId = `temp-asst-${crypto.randomUUID()}`;
      let state = initialTurnState();
      let assistantMessageId = tempAssistantId;
      let userMessageId = tempUserMessageId;
      let metaSeen = false;
      cancelledRef.current = false;
      cancelInFlightRef.current = false;
      setTurn({
        conversationId: convoId,
        assistantMessageId,
        userMessageId,
        parentMessageId: userMessageId,
        state,
      });
      try {
        // Story 17: every send carries the conversation's current source config
        // (wire shape, mapped at the seam). The backend upserts it per send, so
        // per-conversation stickiness is automatic; toggling Reddit off here
        // means `reddit:false` on the wire and no reddit step can appear.
        const sourceConfig = toWire(getSourceConfig(convoId));
        for await (const event of transport.sendMessage(convoId, { text, source_config: sourceConfig })) {
          // Identity adoption (G1): the stream's meta reconciles the temp ids
          // to the canonical backend ids. The user echo's id swaps in `persisted`
          // exactly once, the assistant id swaps in the live turn.
          if (event.type === 'meta') {
            metaSeen = true;
            assistantMessageId = event.data.message_id;
            const backendUserId = event.data.user_message_id;
            if (backendUserId !== userMessageId) {
              const prevUserId = userMessageId;
              userMessageId = backendUserId;
              setPersisted((prev) => {
                let matched = false;
                const next = prev.map((m) => {
                  if (m.messageId === prevUserId) {
                    matched = true;
                    return { ...m, messageId: backendUserId };
                  }
                  return m;
                });
                if (!matched) {
                  // The temp user id wasn't found — a permanently-temp id silently
                  // breaks feedback/edit addressing for this user message.
                  console.warn(
                    `[chat] meta.user_message_id arrived but temp id ${prevUserId} ` +
                      'was not found in the projection; identity not reconciled.',
                  );
                }
                return next;
              });
            }
          }
          state = reduce(state, event);
          setTurn({
            conversationId: convoId,
            assistantMessageId,
            userMessageId,
            parentMessageId: userMessageId,
            state,
          });
        }
        // Honesty guard: the stream ended WITHOUT a terminal `done`/`error`
        // (the server crashed / the connection dropped mid-turn). `parseSseStream`
        // returned cleanly, so the loop exited with the turn still `streaming`/
        // `idle` — never project that as a finished answer (a frozen bubble that
        // looks mid-stream forever). Route it through the SAME error path.
        if (state.status === 'streaming' || state.status === 'idle') {
          throw new TransportError(
            'network',
            'Connection lost before the answer completed.',
          );
        }
        // The completed turn stays in view from reducer state (a reload re-
        // fetches via transport.transcript). Project it into `persisted` with
        // the reconciled ids; the server already persisted it.
        setPersisted((prev) => [
          ...prev,
          assistantMessage(convoId, assistantMessageId, userMessageId, state, new Date().toISOString()),
        ]);
        // The sidebar title may now exist (cheap-model title) — refresh the list.
        void queryClient.invalidateQueries([QueryKeys.chats]);
      } catch (error: unknown) {
        setTurnError(turnErrorOf(error));
        if (metaSeen) {
          // The send was accepted (user bubble echoed, stream opened) then the
          // transport threw mid-stream. Persist the partial answer as an error
          // entry so the error card renders; the composer text is NOT restored.
          const errored: TurnState = {
            ...state,
            status: 'error',
            error: state.error ?? { message: turnErrorOf(error).message, trace_id: '' },
          };
          setPersisted((prev) => [
            ...prev,
            assistantMessage(
              convoId,
              assistantMessageId,
              userMessageId,
              errored,
              new Date().toISOString(),
            ),
          ]);
          // Accepted-then-failed: the error card renders; do not re-throw (the
          // composer text stays cleared, the message was sent).
          return;
        }
        // Pre-stream failure: keep the composer text for inline retry. No
        // fabricated entry — the optimistic user echo is dropped on retry.
        setPendingText(text);
        throw error;
      } finally {
        setTurn(null);
      }
    },
    [queryClient],
  );

  const startSend = useCallback(
    async (text: string): Promise<void> => {
      if (turnRef.current !== null) {
        return;
      }
      setTurnError(null);
      let activeId = conversationIdRef.current;
      if (activeId === null) {
        // Persist the user's default source config onto the minted session so
        // the first send (and the dropdown) reflect their chosen sources.
        const created = await transport.createSession(toWire(getSourceConfig(null)));
        activeId = created.session_id;
        // Mark fresh so the conversation-change effect doesn't blank+reload it
        // out from under the optimistic echo we add below (G1 reconciliation).
        freshSessionsRef.current.add(activeId);
        setConversationId(activeId);
        void queryClient.invalidateQueries([QueryKeys.chats]);
        navigate(`/c/${activeId}`, { replace: false });
      }

      const tempUserId = `temp-user-${crypto.randomUUID()}`;
      const ts = new Date().toISOString();
      setPersisted((prev) => [
        ...prev,
        userMessage(activeId, tempUserId, prev[prev.length - 1]?.messageId ?? null, text, ts),
      ]);
      setAbortScroll(false);
      await runTurn(activeId, tempUserId, text);
    },
    [navigate, queryClient, runTurn, setConversationId],
  );

  const submitMessage = useCallback(
    async (text: string): Promise<boolean> => {
      setPendingText(null);
      try {
        await startSend(text);
        return true;
      } catch (error: unknown) {
        // 409 → a turn is already streaming: cancel-then-retry-once.
        if (isTransportError(error) && error.kind === 'conflict') {
          const convoId = conversationIdRef.current;
          if (convoId !== null) {
            try {
              await transport.cancel(convoId);
              setTurnError(null);
              setPendingText(null);
              await startSend(text);
              return true;
            } catch (retryError: unknown) {
              setTurnError(turnErrorOf(retryError));
              setPendingText(text);
              return false;
            }
          }
          // convoId became null mid-flight — can't retry. Fall through to the
          // same surfaced-error path rather than silently returning.
        }
        // Every non-retried error (incl. createSession / pre-`meta` failures that
        // never entered runTurn) surfaces here. runTurn's own setTurnError/
        // setPendingText (when it threw) are idempotent with these.
        setTurnError(turnErrorOf(error));
        setPendingText(text);
        return false;
      }
    },
    [startSend],
  );

  const retryLastSend = useCallback(() => {
    const text = pendingText;
    if (text === null || turnRef.current !== null) {
      return;
    }
    setPendingText(null);
    setTurnError(null);
    // Drop the optimistic user echo from the failed attempt before re-sending
    // (startSend re-appends it). The failed echo is the last user message.
    setPersisted((prev) => {
      const idx = [...prev].reverse().findIndex((m) => m.isCreatedByUser);
      if (idx === -1) {
        return prev;
      }
      const removeAt = prev.length - 1 - idx;
      return [...prev.slice(0, removeAt), ...prev.slice(removeAt + 1)];
    });
    void submitMessage(text);
  }, [pendingText, submitMessage]);

  const retryTranscript = useCallback(() => {
    const convoId = conversationIdRef.current;
    if (convoId === null) {
      return;
    }
    void loadTranscript(convoId);
  }, [loadTranscript]);

  // ── Edit / regenerate (B5a: in-memory only; real replace_message_id is B5d) ──
  //
  // TODO(B5d): edit & regenerate go real via `replace_message_id` from the
  // transcript ids; the local truncate-then-submit path below is deleted, and
  // Edit is hidden on id-less / synthesized entries. For B5a these operate on
  // the in-memory projection only (no client-side persistence) so the affordance
  // still works in-session; a reload re-sources from transport.transcript.

  const truncatePersistedAt = useCallback((messageId: string): boolean => {
    let found = false;
    setPersisted((prev) => {
      const idx = prev.findIndex((m) => m.messageId === messageId);
      if (idx === -1) {
        return prev;
      }
      found = true;
      return prev.slice(0, idx);
    });
    return found;
  }, []);

  const ask = useCallback(
    ({ text, messageId }: AskProps) => {
      if (turnRef.current !== null) {
        return;
      }
      if (messageId !== undefined && messageId !== null) {
        truncatePersistedAt(messageId);
      }
      void submitMessage(text);
    },
    [submitMessage, truncatePersistedAt],
  );

  const regenerate = useCallback(
    (message: ChatMessage) => {
      if (turnRef.current !== null || message.isCreatedByUser) {
        return;
      }
      // The user turn that produced this answer precedes it in the projection.
      const idx = persisted.findIndex((m) => m.messageId === message.messageId);
      const userMsg = idx > 0 ? persisted[idx - 1] : undefined;
      if (userMsg === undefined || !userMsg.isCreatedByUser) {
        return;
      }
      setPersisted((prev) => prev.slice(0, idx - 1));
      void submitMessage(userMsg.text);
    },
    [persisted, submitMessage],
  );

  const updateMessageText = useCallback((messageId: string, text: string) => {
    // TODO(B5d): edit-in-place is removed (PRD decision 4 gives a silent text
    // mutation no meaning post-seam). For B5a it updates the in-memory echo only.
    setPersisted((prev) =>
      prev.map((m) => (m.messageId === messageId ? { ...m, text } : m)),
    );
  }, []);

  const stopGenerating = useCallback(() => {
    const active = turnRef.current;
    // Guard double-cancel: only fire for a still-running turn, and not while a
    // cancel is already committed or in flight.
    if (active === null || cancelledRef.current || cancelInFlightRef.current) {
      return;
    }
    const finished =
      active.state.status !== 'streaming' && active.state.status !== 'idle';
    if (finished) {
      return;
    }
    // In-flight guard so a rapid double-click doesn't fire two cancels; the
    // committed `cancelledRef` is only set once cancel RESOLVES (so we never
    // claim "stopped" for a cancel that failed).
    cancelInFlightRef.current = true;
    void transport
      .cancel(active.conversationId)
      .then(() => {
        cancelledRef.current = true;
      })
      .catch(() => {
        // Cancel failed: the stream is still running. Don't claim it stopped —
        // re-enable the Stop button (a re-click retries) and surface it.
        setTurnError({
          kind: 'network',
          message: 'Could not stop the response. Try again.',
        });
      })
      .finally(() => {
        cancelInFlightRef.current = false;
      });
  }, []);

  const newConversation = useCallback(() => {
    setConversationId(null);
    setPersisted([]);
    setTurnError(null);
    setPendingText(null);
    setTranscriptError(null);
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
      turnError,
      retryLastSend,
      transcriptError,
      retryTranscript,
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
      turnError,
      retryLastSend,
      transcriptError,
      retryTranscript,
      awaitingClarify,
      abortScroll,
    ],
  );

  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

// ── Error mapping ──────────────────────────────────────────────────────────

function turnErrorOf(error: unknown): TurnError {
  if (isTransportError(error)) {
    if (error.kind === 'rate_limited') {
      const wait =
        error.retryAfter !== undefined
          ? `Try again in ${error.retryAfter} second${error.retryAfter === 1 ? '' : 's'}.`
          : 'Try again in a moment.';
      return { kind: 'rate_limited', message: wait, retryAfter: error.retryAfter };
    }
    if (error.kind === 'unauthorized') {
      return { kind: 'unauthorized', message: 'Please sign in to continue.' };
    }
    if (error.kind === 'network') {
      return { kind: 'network', message: 'Could not reach the server. Check your connection.' };
    }
    return { kind: 'server', message: error.message };
  }
  return { kind: 'stream', message: 'Something went wrong. Please try again.' };
}

function transcriptErrorOf(error: unknown): TranscriptError {
  if (isTransportError(error)) {
    if (error.kind === 'unauthorized') {
      return { kind: 'unauthorized', message: 'Please sign in to view this conversation.' };
    }
    if (error.kind === 'network') {
      return {
        kind: 'network',
        message: "Couldn't load this conversation. Check your connection.",
      };
    }
  }
  return { kind: 'server', message: "Couldn't load this conversation." };
}

export function useChatContext(): ChatContextValue {
  const ctx = useContext(ChatContext);
  if (ctx === undefined) {
    throw new Error('useChatContext must be used within ChatProvider');
  }
  return ctx;
}
