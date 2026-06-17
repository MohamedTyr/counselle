/**
 * ChatContext — the single seam between the chat surfaces and the transport.
 *
 * B5a: the mock-store bypass is removed. The transcript comes from
 * `transport.transcript(sessionId)`; the server persists (no client-side
 * transcript writes). The new-chat flow awaits `transport.createSession()`.
 * Identity is backend-owned: the optimistic user echo and the assistant
 * message get temp ids, reconciled to `meta.user_message_id` / `meta.message_id`
 * when the stream opens — feedback/edit then address backend ids only.
 *
 * ChatContext is the ONLY place that knows which transport is active.
 *
 * Phase 5 (FE-CHATCONTEXT-GOD): de-godded. The stream loop + turn lifecycle live
 * in `useTurnEngine`; the projection helpers in `@/api/projectTranscript`; the
 * stream-reconcile helpers in `@/api/streamReconcile`. This provider owns the
 * persisted projection, the conversation/transcript lifecycle, the reactive
 * per-session source-config query (FE-SOURCECFG-DUAL), the `messages` memo, and
 * composes the engine. The public `useChatContext()` shape is unchanged — it
 * reads two internal contexts (stable actions / changing data) and spreads them.
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
import { transport } from '@/api/selectTransport';
import { fromWire } from '@/api/source-config';
import {
  getDefaultSourceConfig,
  type SourceConfig,
} from '@/api/sourceConfigStore';
import { assistantMessage, messagesFromTranscript, type ChatMessage } from '@/api/projectTranscript';
import { transcriptErrorOf, type TranscriptError, type TurnError } from '@/api/errorMessages';
import { useTurnEngine, type AskProps } from '@/app/useTurnEngine';

// `ChatMessage`/`AskProps`/`TurnError`/`TranscriptError` are re-exported so the
// public symbol paths `@/app/ChatContext` → those types are preserved exactly
// (the vendored tree imports them from here).
export type { ChatMessage, AskProps, TurnError, TranscriptError };

/** The query key the per-session source config lives under (FE-SOURCECFG-DUAL).
 *  The composer reads it reactively; `loadTranscript` seeds it from server truth. */
export function sourceConfigKey(sessionId: string): [string, string] {
  return ['sourceConfig', sessionId];
}

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

/** (E) The stable callbacks — its memo changes ~never (all useCallback-stable). */
type ChatActionsValue = Pick<
  ChatContextValue,
  | 'submitMessage'
  | 'ask'
  | 'regenerate'
  | 'stopGenerating'
  | 'newConversation'
  | 'retryLastSend'
  | 'retryTranscript'
  | 'setAbortScroll'
>;

/** (E) The changing data — re-evaluates as the turn/projection changes. */
type ChatDataValue = Pick<
  ChatContextValue,
  | 'conversationId'
  | 'isSubmitting'
  | 'messages'
  | 'latestMessage'
  | 'latestMessageId'
  | 'turnError'
  | 'transcriptError'
  | 'awaitingClarify'
  | 'abortScroll'
>;

const ChatActionsContext = createContext<ChatActionsValue | undefined>(undefined);
const ChatDataContext = createContext<ChatDataValue | undefined>(undefined);

export function ChatProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [conversationId, setConversationId] = useAtom(activeConversationIdAtom);
  const [persisted, setPersisted] = useState<ChatMessage[]>([]);
  const [abortScroll, setAbortScroll] = useState(false);
  /** A transcript-load failure for the open conversation (honest error, not a
   *  blank chat). Cleared when the load succeeds or the conversation changes. */
  const [transcriptError, setTranscriptError] = useState<TranscriptError | null>(null);

  const conversationIdRef = useRef(conversationId);
  conversationIdRef.current = conversationId;
  /** Mirrors `persisted` for callbacks that must read the latest projection
   *  without depending on it (reattach reads the in-flight user echo's id). */
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  /** Sessions created locally for an in-flight first send. The conversation-change
   *  effect must NOT blank+reload these: their projection is the optimistic turn,
   *  not a (still-empty) server transcript — reloading would wipe the user echo
   *  before `meta` reconciles its id (G1). Consumed once, then they reload normally. */
  const freshSessionsRef = useRef<Set<string>>(new Set());

  /** FE-SOURCECFG-DUAL: the per-session source config is the single reactive
   *  truth — read from the React Query cache (seeded by loadTranscript), falling
   *  back to the new-chat default when null/new chat. No per-conversation
   *  localStorage read path. */
  const getSourceConfig = useCallback(
    (convoId: string | null): SourceConfig => {
      if (convoId === null) {
        return getDefaultSourceConfig();
      }
      const cached = queryClient.getQueryData<SourceConfig>(sourceConfigKey(convoId));
      return cached ?? getDefaultSourceConfig();
    },
    [queryClient],
  );

  // Load the open conversation's transcript (server read). Extracted so the
  // FIX-3 retry banner can re-run it. A failure surfaces `transcriptError` and
  // does NOT blank `persisted` — opening an existing chat must never look like
  // a lost (empty) conversation.
  const loadTranscript = useCallback(
    async (convoId: string): Promise<void> => {
      setTranscriptError(null);
      try {
        const { entries, sourceConfig } = await transport.transcript(convoId);
        if (conversationIdRef.current === convoId) {
          setPersisted(messagesFromTranscript(convoId, entries));
          // Seed the source dropdown from server truth (B5c): the session's
          // persisted config is the single reactive source (FE-SOURCECFG-DUAL)
          // — write it into the query cache, not localStorage.
          if (sourceConfig !== null) {
            queryClient.setQueryData(sourceConfigKey(convoId), fromWire(sourceConfig));
          }
        }
      } catch (error: unknown) {
        if (conversationIdRef.current === convoId) {
          setTranscriptError(transcriptErrorOf(error));
          // Keep whatever projection was already shown; never fabricate or blank.
        }
      }
    },
    [queryClient],
  );

  const engine = useTurnEngine({
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
  });

  const { turn, attachTurn, clearTurnState } = engine;

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

  const retryTranscript = useCallback(() => {
    const convoId = conversationIdRef.current;
    if (convoId === null) {
      return;
    }
    void loadTranscript(convoId);
  }, [loadTranscript]);

  const newConversation = useCallback(() => {
    setConversationId(null);
    setPersisted([]);
    clearTurnState();
    setTranscriptError(null);
    navigate('/');
  }, [navigate, setConversationId, clearTurnState]);

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

  // (E) Stable callbacks — deps are only callback identities (all useCallback-
  // stable), so this memo changes ~never.
  const actionsValue = useMemo<ChatActionsValue>(
    () => ({
      submitMessage: engine.submitMessage,
      ask: engine.ask,
      regenerate: engine.regenerate,
      stopGenerating: engine.stopGenerating,
      newConversation,
      retryLastSend: engine.retryLastSend,
      retryTranscript,
      setAbortScroll,
    }),
    [
      engine.submitMessage,
      engine.ask,
      engine.regenerate,
      engine.stopGenerating,
      newConversation,
      engine.retryLastSend,
      retryTranscript,
      setAbortScroll,
    ],
  );

  // (E) Changing data — re-evaluates as the turn/projection/error changes.
  const dataValue = useMemo<ChatDataValue>(
    () => ({
      conversationId,
      isSubmitting: engine.isSubmitting,
      messages,
      latestMessage,
      latestMessageId: latestMessage?.messageId,
      turnError: engine.turnError,
      transcriptError,
      awaitingClarify,
      abortScroll,
    }),
    [
      conversationId,
      engine.isSubmitting,
      messages,
      latestMessage,
      engine.turnError,
      transcriptError,
      awaitingClarify,
      abortScroll,
    ],
  );

  return (
    <ChatActionsContext.Provider value={actionsValue}>
      <ChatDataContext.Provider value={dataValue}>{children}</ChatDataContext.Provider>
    </ChatActionsContext.Provider>
  );
}

/** The merged 20-field public shape — reads both contexts and spreads. No
 *  consumer changes (the 15 call sites + 30 vendor importers are untouched). */
export function useChatContext(): ChatContextValue {
  const actions = useContext(ChatActionsContext);
  const data = useContext(ChatDataContext);
  if (actions === undefined || data === undefined) {
    throw new Error('useChatContext must be used within ChatProvider');
  }
  return { ...actions, ...data };
}
