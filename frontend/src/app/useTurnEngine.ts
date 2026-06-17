/**
 * useTurnEngine — the stream-loop + turn-lifecycle hook extracted from
 * ChatContext (Phase 5 / FE-CHATCONTEXT-GOD). It owns:
 *   - the live turn (`turn`), `turnError`, `pendingText`
 *   - the lifecycle refs (`turnRef`, `cancelledRef`, `cancelInFlightRef`,
 *     `isMountedRef`)
 *   - the stream loop (`consumeStream`, now thin — uses the streamReconcile
 *     helpers) and the turn orchestration (`runTurn`, `attachTurn`,
 *     `cancelAndAwaitClear`, `submitMessage`, `startSend`, `retryLastSend`,
 *     `ask`, `regenerate`, `stopGenerating`).
 *
 * It does NOT own the persisted projection / conversation id / transcript load —
 * those stay in the provider and are passed in via `UseTurnEngineDeps`. The
 * extraction is behavior-preserving: the logic moved byte-for-byte (the honesty
 * guard, the 5s cancel poll, the 409 cancel-then-retry-once, the pre-meta vs
 * post-meta catch split, the temp-echo drop in retry).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NavigateFunction } from 'react-router-dom';
import type { QueryClient } from '@tanstack/react-query';
import { QueryKeys } from '@/api/hooks';
import { transport } from '@/api/selectTransport';
import { isTransportError, TransportError } from '@/api/http/errors';
import { toWire } from '@/api/source-config';
import type { SourceConfig } from '@/api/sourceConfigStore';
import {
  initialTurnState,
  reduce,
  type TurnState,
} from '@/api/turn-reducer';
import type { ProtocolEvent } from '@/api/protocol';
import { userMessage, type AskProps, type ChatMessage } from '@/api/projectTranscript';
import {
  persistErroredTurn,
  persistTerminalTurn,
  reconcileMetaIds,
} from '@/api/streamReconcile';
import { turnErrorOf, type TurnError } from '@/api/errorMessages';
import { CANCEL_WAIT_TIMEOUT_MS } from '@/config';

export type { AskProps };

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

/** The collaborators the engine reads/writes but does NOT own (provider-owned). */
export interface UseTurnEngineDeps {
  persistedRef: React.MutableRefObject<ChatMessage[]>;
  setPersisted: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  conversationId: string | null;
  conversationIdRef: React.MutableRefObject<string | null>;
  setConversationId: (id: string | null) => void;
  freshSessionsRef: React.MutableRefObject<Set<string>>;
  loadTranscript: (convoId: string) => Promise<void>;
  navigate: NavigateFunction;
  queryClient: QueryClient;
  /** The per-conversation source config (post FE-SOURCECFG-DUAL: the reactive
   *  query cache value; `null` convoId → the new-chat default). */
  getSourceConfig: (convoId: string | null) => SourceConfig;
  /** Re-engages scroll-follow on send so the view follows the streaming answer
   *  even if the user had scrolled up (provider-owned scroll state). */
  setAbortScroll: (value: boolean) => void;
}

export interface TurnEngine {
  turn: LiveTurn | null;
  isSubmitting: boolean;
  turnError: TurnError | null;
  submitMessage: (text: string, replaceMessageId?: string) => Promise<boolean>;
  ask: (props: AskProps) => void;
  regenerate: (message: ChatMessage) => void;
  stopGenerating: () => void;
  retryLastSend: () => void;
  attachTurn: (convoId: string) => Promise<void>;
  runTurn: (
    convoId: string,
    tempUserMessageId: string,
    text: string,
    replaceMessageId?: string,
  ) => Promise<void>;
  /** Cleared by the provider's newConversation (it resets the projection). */
  clearTurnState: () => void;
}

export function useTurnEngine(deps: UseTurnEngineDeps): TurnEngine {
  const {
    persistedRef,
    setPersisted,
    conversationId,
    conversationIdRef,
    setConversationId,
    freshSessionsRef,
    loadTranscript,
    navigate,
    queryClient,
    getSourceConfig,
    setAbortScroll,
  } = deps;

  const [turn, setTurn] = useState<LiveTurn | null>(null);
  const [turnError, setTurnError] = useState<TurnError | null>(null);
  /** The text of a failed send, kept for inline retry. */
  const [pendingText, setPendingText] = useState<string | null>(null);

  const turnRef = useRef(turn);
  turnRef.current = turn;
  /** Committed cancel: set only once `transport.cancel` RESOLVES (so we never
   *  claim "stopped" for a failed cancel). */
  const cancelledRef = useRef(false);
  /** A cancel request is in flight — guards a rapid double-click. */
  const cancelInFlightRef = useRef(false);
  /** False once the provider unmounts — the up-to-5s cancel poll loop can
   *  outlive it; short-circuit so its continuations don't setState post-unmount. */
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
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
  // never projected as a finished answer). DRY: the loop lives once.
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
      const publishTurn = () =>
        setTurn({
          conversationId: convoId,
          assistantMessageId,
          userMessageId,
          parentMessageId: userMessageId,
          hasBackendId,
          state,
        });
      publishTurn();
      try {
        for await (const event of stream) {
          if (event.type === 'meta') {
            metaSeen = true;
            hasBackendId = true;
            assistantMessageId = event.data.message_id;
            const backendUserId = event.data.user_message_id;
            if (reconcileTempUserId && backendUserId !== userMessageId) {
              const prevUserId = userMessageId;
              setPersisted((prev) => reconcileMetaIds(prev, prevUserId, backendUserId).next);
            }
            userMessageId = backendUserId;
          }
          state = reduce(state, event);
          publishTurn();
        }
        // Honesty guard: the stream ended WITHOUT a terminal `done`/`error`
        // (the server crashed / the connection dropped mid-turn). `parseSseStream`
        // returned cleanly, so the loop exited with the turn still `streaming`/
        // `idle` — never project that as a finished answer. Route it through the
        // SAME error path.
        if (state.status === 'streaming' || state.status === 'idle') {
          throw new TransportError('network', 'Connection lost before the answer completed.');
        }
        // The completed turn stays in view from reducer state (a reload re-
        // fetches via transport.transcript). Project it into `persisted` with the
        // reconciled ids; the server already persisted it.
        const done = persistTerminalTurn(
          convoId,
          assistantMessageId,
          userMessageId,
          hasBackendId,
          state,
        );
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
          const card = persistErroredTurn(
            convoId,
            assistantMessageId,
            userMessageId,
            hasBackendId,
            state,
            turnErrorOf(error).message,
          );
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
    [queryClient, setPersisted],
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
    [consumeStream, loadTranscript, getSourceConfig],
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
    [consumeStream, persistedRef],
  );

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
          userMessage(activeId as string, tempUserId, prev[prev.length - 1]?.messageId ?? null, text, ts),
        ]);
      } else {
        // On a replace the meta reconcile has nothing to swap; pass the canonical
        // id so the live turn parents correctly until the transcript re-read.
        tempUserId = replaceMessageId;
      }
      // Re-engage scroll-follow so the view follows the streaming answer even if
      // the user had scrolled up before sending (matches pre-Phase-5 behavior).
      setAbortScroll(false);
      await runTurn(activeId, tempUserId, text, replaceMessageId);
    },
    [
      navigate,
      queryClient,
      runTurn,
      setConversationId,
      conversationIdRef,
      freshSessionsRef,
      getSourceConfig,
      setPersisted,
      setAbortScroll,
    ],
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
    while (
      isMountedRef.current &&
      turnRef.current !== null &&
      Date.now() - start < CANCEL_WAIT_TIMEOUT_MS
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
    [startSend, cancelAndAwaitClear, conversationIdRef],
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
  }, [pendingText, submitMessage, setPersisted]);

  // ── Edit / regenerate (G3, B5d): real via `replace_message_id` ──────────────
  //
  // The backend rewrites history from the replaced user_message_id, dropping the
  // now-orphaned messages; `runTurn` re-sources the projection from
  // `transport.transcript()` after a successful replace. No client-side
  // truncation — the server rewrite + transcript re-read is the source of truth.

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
      const prev = persistedRef.current;
      const idx = prev.findIndex((m) => m.messageId === message.messageId);
      const userMsg = idx > 0 ? prev[idx - 1] : undefined;
      if (userMsg === undefined || !userMsg.isCreatedByUser) {
        return;
      }
      const replaceMessageId = userMsg.hasBackendId === true ? userMsg.messageId : undefined;
      void submitMessage(userMsg.text, replaceMessageId);
    },
    [submitMessage, persistedRef],
  );

  const stopGenerating = useCallback(() => {
    const active = turnRef.current;
    // Guard double-cancel: only fire for a still-running turn, and not while a
    // cancel is already committed or in flight.
    if (active === null || cancelledRef.current || cancelInFlightRef.current) {
      return;
    }
    const finished = active.state.status !== 'streaming' && active.state.status !== 'idle';
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

  const clearTurnState = useCallback(() => {
    setTurnError(null);
    setPendingText(null);
  }, []);

  return {
    turn,
    isSubmitting,
    turnError,
    submitMessage,
    ask,
    regenerate,
    stopGenerating,
    retryLastSend,
    attachTurn,
    runTurn,
    clearTurnState,
  };
}

export type { LiveTurn };
