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
  ProtocolEvent,
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
  /** Ordered step labels the collapsed header cycles through while streaming. */
  activities?: string[];
  /** FE-4: the activity timeline (steps + thinking, arrival order). */
  timeline?: TimelineEntry[];
  /** FE-4: the derived one-line receipt the timeline collapses to at done. */
  receipt?: string;
  /** FE-4: total worked time (sum of step receipt durations). */
  durationMs?: number;
  sources?: SourceEntry[];
  clarify?: ClarifySpec;
  /** The persisted clarify answer (transcript only): non-null = the chosen
   *  resume text (the widget freezes seeded to it); null/undefined = unanswered
   *  / the live parked widget. Threaded outside the reducer event replay
   *  (wire-contract §8b) — carried in view-state. */
  clarifyAnswer?: string | null;
  turnStatus?: TurnStatus;
  streamError?: ErrorData;
  /** B5d dead-air cover: the turn is live but nothing is visibly progressing
   *  (no active step, no streaming prose tail) — render the "Thinking…" shimmer.
   *  Truthful: the model IS thinking; it vanishes the instant a real event lands. */
  isThinking?: boolean;
  feedback?: { rating: 'thumbsUp' | 'thumbsDown' };
  /** G4: a synthesized clarify-answer user bubble — never an edit target (the
   *  backend returns 422). Surfaced so HoverButtons hides Edit on it. */
  synthesized?: boolean;
  /** Whether the backend assigned this message a real id (vs a temp/derived
   *  one). Edit is hidden on id-less entries (pre-MVP2 / not yet reconciled). */
  hasBackendId?: boolean;
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
  /** Returns false if the send failed before/at stream start (composer keeps text).
   *  `replaceMessageId` (G3) rewrites server history from that user message. */
  submitMessage: (text: string, replaceMessageId?: string) => Promise<boolean>;
  /** Truncate-and-re-ask (PRD decision 4) — EditMessage's save-and-submit; now a
   *  real `replace_message_id` history rewrite (G3). */
  ask: (props: AskProps) => void;
  /** Re-run the turn that produced `message` (an assistant message). */
  regenerate: (message: ChatMessage) => void;
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
    const hasBackendId = entry.message_id !== undefined;
    const messageId = entry.message_id ?? `msg-${conversationId}-${i}`;
    const parentMessageId = i > 0 ? (messages[i - 1]?.messageId ?? null) : null;
    if (entry.role === 'user') {
      messages.push({
        ...userMessage(conversationId, messageId, parentMessageId, entry.text, entry.ts),
        synthesized: entry.synthesized === true,
        hasBackendId,
      });
      return;
    }
    const state = reduceTranscriptEntry(entry);
    const message = assistantMessage(conversationId, messageId, parentMessageId, state, entry.ts);
    message.hasBackendId = hasBackendId;
    // The persisted clarify answer is threaded outside the reducer's event
    // replay (the event carries only the bare spec, wire-contract §8b): the
    // frozen widget seeds its selection from it.
    message.clarifyAnswer = entry.clarify !== undefined ? entry.clarify.answer : undefined;
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

/** The generic collapsed-header label for narration gaps (mockup parity). */
const THINKING_LABEL = 'Thinking…';

function assistantMessage(
  conversationId: string,
  messageId: string,
  parentMessageId: string | null,
  state: TurnState,
  ts: string | null,
): ChatMessage {
  const record = toStepRecord(state);
  const activeStep = [...state.steps].reverse().find((s) => s.status === 'start');
  // The ordered labels the collapsed header cycles through (the mockup's
  // setNow-per-step): each step's label in arrival order, with a generic
  // "Thinking…" for narration gaps (never the narration text). The ticker dwells
  // ≥850ms on each, so a burst of fast local-DB tools still plays one at a time
  // rather than skipping straight to the last. Consecutive dups collapse.
  const activities = state.timeline
    .map((entry) => (entry.type === 'step' ? entry.step.label : THINKING_LABEL))
    .filter((label, i, arr) => i === 0 || label !== arr[i - 1]);
  const isLive = state.status === 'streaming' || state.status === 'idle';
  // Dead air: live, no step currently in progress (an active step row already
  // shimmers), no streaming prose tail (a growing answer is its own motion), and
  // no thinking lines (the ReasoningTrace rail already renders a thinking row —
  // the orb "Thinking…" must not double up on it). It is the mount trigger for
  // ReasoningTrace at zero entries (the send→first-event / step-end→next gaps).
  const lastBlock = state.blocks[state.blocks.length - 1];
  const hasProseTail = lastBlock !== undefined && lastBlock.kind === 'markdown';
  const isThinking =
    isLive && activeStep === undefined && !hasProseTail && state.thinking.length === 0;
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
    activities,
    timeline: state.timeline,
    receipt: record?.receipt,
    durationMs: deriveDurationMs(state.steps),
    sources: state.sources.length > 0 ? state.sources : undefined,
    clarify: state.clarify ?? undefined,
    turnStatus: state.status,
    streamError: state.error ?? undefined,
    isThinking,
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
  /** True once `meta` reconciled the assistant id to a backend id. */
  hasBackendId: boolean;
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
  /** Mirrors `persisted` for callbacks that must read the latest projection
   *  without depending on it (reattach reads the in-flight user echo's id). */
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  /** Committed cancel: set only once `transport.cancel` RESOLVES (so we never
   *  claim "stopped" for a failed cancel). */
  const cancelledRef = useRef(false);
  /** A cancel request is in flight — guards a rapid double-click. */
  const cancelInFlightRef = useRef(false);
  /** False once the provider unmounts — the up-to-5s cancel poll loop can
   *  outlive it; short-circuit so its continuations don't setState post-unmount. */
  const isMountedRef = useRef(true);
  /** Sessions created locally for an in-flight first send. The conversation-change
   *  effect must NOT blank+reload these: their projection is the optimistic turn,
   *  not a (still-empty) server transcript — reloading would wipe the user echo
   *  before `meta` reconciles its id (G1). Consumed once, then they reload normally. */
  const freshSessionsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

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

  const isSubmitting =
    turn !== null &&
    turn.conversationId === conversationId &&
    (turn.state.status === 'streaming' || turn.state.status === 'idle');

  // ── The turn loop ───────────────────────────────────────────────────────────

  // The shared stream-consumption core — `runTurn` (send) and `attachTurn`
  // (reattach) both drive it. It reconciles meta ids, updates the live turn from
  // the reducer, and persists the terminal/error entry HONESTLY (a stream that
  // ends without a terminal `done`/`error` is routed through the error path,
  // never projected as a finished answer). DRY: the ~80-line loop lives once.
  //
  //  - `reconcileTempUserId`: true for send (a temp user echo is in `persisted`,
  //    swap its id to meta.user_message_id); false for attach (the user echo
  //    merged from the transcript already carries the backend id).
  //  - returns `true` if a `meta` event was seen (the turn was accepted), so the
  //    caller can decide composer-text retention on a thrown error.
  const consumeStream = useCallback(
    async (
      convoId: string,
      stream: AsyncIterable<ProtocolEvent>,
      initialUserMessageId: string,
      reconcileTempUserId: boolean,
    ): Promise<boolean> => {
      const tempAssistantId = `temp-asst-${crypto.randomUUID()}`;
      let state = initialTurnState();
      let assistantMessageId = tempAssistantId;
      let userMessageId = initialUserMessageId;
      let hasBackendId = false;
      let metaSeen = false;
      cancelledRef.current = false;
      cancelInFlightRef.current = false;
      setTurn({
        conversationId: convoId,
        assistantMessageId,
        userMessageId,
        parentMessageId: userMessageId,
        hasBackendId,
        state,
      });
      try {
        for await (const event of stream) {
          // Identity adoption (G1): the stream's meta carries the canonical
          // backend ids. On send the temp user echo's id swaps in `persisted`
          // exactly once; on attach the ids are simply adopted (the echo came
          // from the transcript already canonical).
          if (event.type === 'meta') {
            metaSeen = true;
            hasBackendId = true;
            assistantMessageId = event.data.message_id;
            const backendUserId = event.data.user_message_id;
            if (reconcileTempUserId && backendUserId !== userMessageId) {
              const prevUserId = userMessageId;
              setPersisted((prev) => {
                let matched = false;
                const next = prev.map((m) => {
                  if (m.messageId === prevUserId) {
                    matched = true;
                    return { ...m, messageId: backendUserId, hasBackendId: true };
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
            userMessageId = backendUserId;
          }
          state = reduce(state, event);
          setTurn({
            conversationId: convoId,
            assistantMessageId,
            userMessageId,
            parentMessageId: userMessageId,
            hasBackendId,
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
        const done = assistantMessage(
          convoId,
          assistantMessageId,
          userMessageId,
          state,
          new Date().toISOString(),
        );
        done.hasBackendId = hasBackendId;
        setPersisted((prev) => [...prev, done]);
        // The sidebar title may now exist (cheap-model title) — refresh the list.
        void queryClient.invalidateQueries([QueryKeys.chats]);
        return metaSeen;
      } catch (error: unknown) {
        setTurnError(turnErrorOf(error));
        if (metaSeen) {
          // The turn was accepted (meta seen) then the transport threw mid-stream.
          // Persist the partial answer as an error entry so the error card
          // renders; the composer text is NOT restored.
          const errored: TurnState = {
            ...state,
            status: 'error',
            error: state.error ?? { message: turnErrorOf(error).message, trace_id: '' },
          };
          const card = assistantMessage(
            convoId,
            assistantMessageId,
            userMessageId,
            errored,
            new Date().toISOString(),
          );
          card.hasBackendId = hasBackendId;
          setPersisted((prev) => [...prev, card]);
          // Accepted-then-failed: the error card renders; do not re-throw.
          return true;
        }
        // Pre-meta failure: re-throw so the send path can keep the composer text.
        throw error;
      } finally {
        setTurn(null);
      }
    },
    [queryClient],
  );

  const runTurn = useCallback(
    async (
      convoId: string,
      tempUserMessageId: string,
      text: string,
      replaceMessageId?: string,
    ): Promise<void> => {
      // Story 17: every send carries the conversation's current source config
      // (wire shape, mapped at the seam). The backend upserts it per send, so
      // per-conversation stickiness is automatic; toggling Reddit off here means
      // `reddit:false` on the wire and no reddit step can appear.
      const body = {
        text,
        source_config: toWire(getSourceConfig(convoId)),
        ...(replaceMessageId !== undefined ? { replace_message_id: replaceMessageId } : {}),
      };
      try {
        await consumeStream(convoId, transport.sendMessage(convoId, body), tempUserMessageId, true);
      } catch (error: unknown) {
        // Pre-stream failure: keep the composer text for inline retry. No
        // fabricated entry — the optimistic user echo is dropped on retry.
        setPendingText(text);
        throw error;
      }
      // A successful replace (edit/regenerate) rewrote history server-side: the
      // now-orphaned messages were dropped. Re-source the projection from the
      // server so the FE matches the canonical transcript. No `turnRef.current`
      // guard: `setTurn(null)` runs in consumeStream's finally (async), so the
      // ref isn't synchronously null here — guarding on it skipped every reload
      // and left orphaned messages in the projection after each edit.
      if (replaceMessageId !== undefined) {
        void loadTranscript(convoId);
      }
    },
    [consumeStream, loadTranscript],
  );

  // Reattach to an in-flight turn this tab didn't start (B5d). `attach` replays
  // events after the transport's internal cursor; on a 204 / no-active-turn it
  // completes with ZERO events (the generator just ends). We can't tell 204 from
  // a fully-replayed-then-ended stream except by peeking, so we pull the first
  // event manually: none → no active turn (the already-loaded transcript stands);
  // one → drive `consumeStream` (reconcile=false: the user echo merged from the
  // transcript already carries the backend id). A reattach that errors mid-stream
  // takes the same error path as send — never a fabricated empty "complete".
  const attachTurn = useCallback(
    async (convoId: string): Promise<void> => {
      if (turnRef.current !== null) {
        return;
      }
      const iterator = transport.attach(convoId)[Symbol.asyncIterator]();
      let first: IteratorResult<ProtocolEvent>;
      try {
        first = await iterator.next();
      } catch {
        // Attach failed to open — leave the loaded transcript in place (honest:
        // no active turn surfaced, the history is intact).
        return;
      }
      if (first.done === true) {
        // 204 / no active turn — the transcript read already populated the view.
        return;
      }
      // Re-emit the peeked first event, then the rest, into the shared core. The
      // userMessageId seed is the last persisted user bubble (canonical from the
      // transcript); meta will adopt the backend ids without reconciling a temp.
      const firstEvent = first.value;
      async function* replay(): AsyncGenerator<ProtocolEvent, void, undefined> {
        yield firstEvent;
        while (true) {
          const next = await iterator.next();
          if (next.done === true) {
            return;
          }
          yield next.value;
        }
      }
      const lastUser = [...persistedRef.current].reverse().find((m) => m.isCreatedByUser);
      const seedUserId = lastUser?.messageId ?? `temp-user-${crypto.randomUUID()}`;
      try {
        await consumeStream(convoId, replay(), seedUserId, false);
      } catch {
        // Pre-meta attach failure — `consumeStream` already surfaced the error
        // via `setTurnError`. The loaded transcript stays; never fabricate.
      }
    },
    [consumeStream],
  );

  // Reload persisted messages when the open conversation changes. On open we
  // reattach FIRST (pick up an in-flight turn another tab/page-load started),
  // then the transcript: load the transcript for the user echo + history, then
  // attach — a non-empty attach streams the in-flight answer live here.
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
    void (async () => {
      // Transcript first (user echo + history), then attach to any in-flight turn.
      await loadTranscript(convoId);
      if (conversationIdRef.current === convoId) {
        await attachTurn(convoId);
      }
    })();
  }, [conversationId, loadTranscript, attachTurn]);

  const startSend = useCallback(
    async (text: string, replaceMessageId?: string): Promise<void> => {
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

      // A replace (edit/regenerate) rewrites server history from the replaced
      // user message: the optimistic echo would duplicate the kept user bubble,
      // so we add no echo — the post-turn transcript re-read is the truth.
      let tempUserId = `temp-user-${crypto.randomUUID()}`;
      if (replaceMessageId === undefined) {
        const ts = new Date().toISOString();
        setPersisted((prev) => [
          ...prev,
          userMessage(activeId, tempUserId, prev[prev.length - 1]?.messageId ?? null, text, ts),
        ]);
      } else {
        // On a replace the meta reconcile has nothing to swap; pass the canonical
        // id so the live turn parents correctly until the transcript re-read.
        tempUserId = replaceMessageId;
      }
      setAbortScroll(false);
      await runTurn(activeId, tempUserId, text, replaceMessageId);
    },
    [navigate, queryClient, runTurn, setConversationId],
  );

  /** Send-mid-stream (B5d): if a turn is streaming, cancel → await the stream's
   *  `done` (the turn clears in consumeStream's finally) → then send. Never fire
   *  two concurrent turns. Returns false if the running turn didn't stop within
   *  the timeout (cancel failed) — the caller must NOT send, and must keep the
   *  composer text + surface the honest error rather than silently drop it. */
  const cancelAndAwaitClear = useCallback(async (): Promise<boolean> => {
    const active = turnRef.current;
    if (active === null) {
      return true;
    }
    try {
      await transport.cancel(active.conversationId);
    } catch {
      // Cancel failed — the existing turn keeps running; don't start a second.
      // Fall through to the wait, which will time out and surface a conflict.
    }
    // Poll the ref the streaming loop nulls on its terminal event.
    const start = Date.now();
    const TIMEOUT_MS = 5000;
    while (
      isMountedRef.current &&
      turnRef.current !== null &&
      Date.now() - start < TIMEOUT_MS
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    // Still running after the wait: cancel didn't take. Surface it honestly so
    // the new message isn't silently dropped (mirrors stopGenerating's grammar).
    if (turnRef.current !== null) {
      if (isMountedRef.current) {
        setTurnError({
          kind: 'network',
          message: "Couldn't stop the previous response — try again.",
        });
      }
      return false;
    }
    return true;
  }, []);

  const submitMessage = useCallback(
    async (text: string, replaceMessageId?: string): Promise<boolean> => {
      setPendingText(null);
      // Send-mid-stream: cancel the running turn and wait for it to terminate
      // before opening a new one (no two concurrent turns). If it didn't clear,
      // bail without sending — keep the composer text and the surfaced error
      // rather than falling through startSend's turn guard and lying success.
      if (turnRef.current !== null) {
        const cleared = await cancelAndAwaitClear();
        if (!cleared) {
          setPendingText(text);
          return false;
        }
      }
      try {
        await startSend(text, replaceMessageId);
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
              await startSend(text, replaceMessageId);
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
    [startSend, cancelAndAwaitClear],
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

  // ── Edit / regenerate (G3, B5d): real via `replace_message_id` ──────────────
  //
  // The backend rewrites history from the replaced user_message_id, dropping the
  // now-orphaned messages; `runTurn` re-sources the projection from
  // `transport.transcript()` after a successful replace. No client-side
  // truncation — the server rewrite + transcript re-read is the source of truth.
  // (`updateMessageText` is gone: PRD decision 4 gives a silent text mutation no
  // meaning, and post-seam it would be a client-side lie.)

  /** Truncate-and-re-ask — EditMessage's Save&Submit, now a real replace. */
  const ask = useCallback(
    ({ text, messageId }: AskProps) => {
      if (turnRef.current !== null) {
        return;
      }
      // `messageId` is the edited user bubble's backend id (canonical post-G1).
      // A temp/derived id (no backend id yet) can't replace history — refuse
      // rather than send a bogus replace_message_id (Edit is hidden on those).
      const replaceMessageId =
        messageId !== undefined && messageId !== null && !messageId.startsWith('temp-')
          ? messageId
          : undefined;
      void submitMessage(text, replaceMessageId);
    },
    [submitMessage],
  );

  const regenerate = useCallback(
    (message: ChatMessage) => {
      if (turnRef.current !== null || message.isCreatedByUser) {
        return;
      }
      // The user turn that produced this answer precedes it in the projection;
      // its backend id is the replace anchor.
      const idx = persisted.findIndex((m) => m.messageId === message.messageId);
      const userMsg = idx > 0 ? persisted[idx - 1] : undefined;
      if (userMsg === undefined || !userMsg.isCreatedByUser) {
        return;
      }
      const replaceMessageId =
        userMsg.hasBackendId === true ? userMsg.messageId : undefined;
      void submitMessage(userMsg.text, replaceMessageId);
    },
    [persisted, submitMessage],
  );

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
    const live = assistantMessage(
      turn.conversationId,
      turn.assistantMessageId,
      turn.parentMessageId,
      turn.state,
      null,
    );
    live.hasBackendId = turn.hasBackendId;
    // A live parked clarify is the interactive widget (answer not yet chosen);
    // `clarifyAnswer` stays undefined so it isn't frozen-seeded.
    //
    // A clarify resume re-emits the parked turn's assistant id (wire-contract §1),
    // and reattach can replay a turn already in `persisted` — both leave a stale
    // copy of the live id in `persisted`. Drop it so the live turn renders exactly
    // once (no duplicate React key / double render); filter-and-append also keeps
    // the chronological order (question → answer echo → resumed response).
    const deduped = persisted.filter((m) => m.messageId !== turn.assistantMessageId);
    return [...deduped, live];
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
