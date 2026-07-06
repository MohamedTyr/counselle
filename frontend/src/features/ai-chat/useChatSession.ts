import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { useQueryClient } from "@tanstack/react-query";

import { chatKeys, useChatSession as useChatSessionQuery } from "@/api/chat/hooks";
import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import type { ChatTransport, SourceConfig } from "@/api/chat/types";
import { chatTransport } from "@/api/chat/transport";
import { messagesFromTranscript, type ChatMessage } from "./model";
import { transcriptErrorOf, type TranscriptError } from "./errors";
import { useTurnEngine } from "./useTurnEngine";

export type UseChatSessionOptions = {
  sessionId: string;
  transport?: ChatTransport;
  onSendStart?: () => void;
};

type LocalSessionState = {
  // `null` until the transcript for the current `sessionId` has actually
  // hydrated. Do NOT initialize this to the incoming `sessionId` prop --
  // that would make `isLocalSession` trivially true before hydration ever
  // runs, letting the attach effect fire against an empty transcript.
  sessionId: string | null;
  persistedMessages: ChatMessage[];
  sourceConfig: SourceConfig | null;
  transcriptError: TranscriptError | null;
};

export function useChatSession({
  sessionId,
  transport = chatTransport,
  onSendStart,
}: UseChatSessionOptions) {
  const queryClient = useQueryClient();
  const sessionQuery = useChatSessionQuery(sessionId);
  const [localState, setLocalState] = useState<LocalSessionState>({
    sessionId: null,
    persistedMessages: [],
    sourceConfig: null,
    transcriptError: null,
  });

  // Live sessionId, kept in sync with the prop so setters bound to a stale
  // sessionId can detect they're stale. Assigned directly in the render body
  // (mirroring useTurnEngine.ts's sessionIdRef) -- NOT inside a useEffect.
  // An effect only flushes after commit, leaving a window where a stale
  // in-flight stream callback resolving as a microtask (between the new
  // sessionId committing and the effect flushing) would still see the OLD
  // ref value, making its `sessionId !== sessionIdRef.current` guard
  // evaluate old !== old -> false, and wrongly stamp the stale sessionId
  // into state.
  const sessionIdRef = useRef(sessionId);
  // This must land synchronously in the same render that switches sessionId
  // (see rationale above), not deferred to an effect. useTurnEngine.ts's
  // identical sessionIdRef assignment isn't flagged only because that
  // file's `for await` loop makes the compiler bail out of full analysis --
  // this is the same pattern, made explicit here.
  // eslint-disable-next-line react-hooks/refs -- intentional render-time ref sync, see comment above.
  sessionIdRef.current = sessionId;

  const isLocalSession = localState.sessionId === sessionId;
  const persistedMessages = isLocalSession ? localState.persistedMessages : [];
  const sourceConfig = isLocalSession ? localState.sourceConfig : null;
  const transcriptError = isLocalSession ? localState.transcriptError : null;

  useEffect(() => {
    if (sessionQuery.data === undefined) {
      return;
    }

    const data = sessionQuery.data;
    // Set state synchronously here (not via queueMicrotask). The attach
    // effect below is gated on `isLocalSession`, so it only runs once this
    // hydration has actually landed in state and triggered a re-render --
    // deferring via microtask isn't needed to satisfy the lint rule and was
    // actively harmful (it let the attach effect run first, against the
    // pre-hydrate empty transcript).
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: transcript hydration must land before the attach effect (gated on isLocalSession) is allowed to run.
    setLocalState({
      sessionId: data.sessionId,
      persistedMessages: messagesFromTranscript(
        data.sessionId,
        data.transcript,
      ),
      sourceConfig: data.sourceConfig,
      transcriptError: null,
    });
  }, [sessionQuery.data]);

  useEffect(() => {
    if (sessionQuery.error) {
      const error = sessionQuery.error;
      let cancelled = false;
      queueMicrotask(() => {
        if (!cancelled) {
          setLocalState((previous) => ({
            sessionId,
            persistedMessages:
              previous.sessionId === sessionId
                ? previous.persistedMessages
                : [],
            sourceConfig:
              previous.sessionId === sessionId ? previous.sourceConfig : null,
            transcriptError: transcriptErrorOf(error),
          }));
        }
      });

      return () => {
        cancelled = true;
      };
    }
  }, [sessionId, sessionQuery.error]);

  const refreshTranscript = useCallback(
    (activeSessionId: string) => {
      void queryClient.invalidateQueries({
        queryKey: chatKeys.session(activeSessionId),
      });
    },
    [queryClient],
  );

  const effectiveSourceConfig = useMemo(
    () =>
      sourceConfig ??
      sessionQuery.data?.sourceConfig ??
      BUILT_IN_SOURCE_CONFIG,
    [sessionQuery.data?.sourceConfig, sourceConfig],
  );

  const setPersistedMessages = useCallback<Dispatch<SetStateAction<ChatMessage[]>>>(
    (action) => {
      setLocalState((previous) => {
        // A stream callback bound to an earlier sessionId can still fire
        // after the caller has switched sessions in place (no remount). If
        // this closure's sessionId no longer matches the live session, it's
        // stale -- stamping it in would blank the transcript for the
        // session the user is actually looking at now.
        if (sessionId !== sessionIdRef.current) {
          return previous;
        }

        const previousMessages =
          previous.sessionId === sessionId ? previous.persistedMessages : [];
        const nextMessages =
          typeof action === "function" ? action(previousMessages) : action;

        return {
          sessionId,
          persistedMessages: nextMessages,
          sourceConfig:
            previous.sessionId === sessionId ? previous.sourceConfig : null,
          transcriptError:
            previous.sessionId === sessionId ? previous.transcriptError : null,
        };
      });
    },
    [sessionId],
  );

  const setSourceConfig = useCallback<
    Dispatch<SetStateAction<SourceConfig | null>>
  >(
    (action) => {
      setLocalState((previous) => {
        // See setPersistedMessages above: guard against a stale closure
        // overwriting the current session's state.
        if (sessionId !== sessionIdRef.current) {
          return previous;
        }

        const previousSourceConfig =
          previous.sessionId === sessionId ? previous.sourceConfig : null;
        const nextSourceConfig =
          typeof action === "function" ? action(previousSourceConfig) : action;

        return {
          sessionId,
          persistedMessages:
            previous.sessionId === sessionId
              ? previous.persistedMessages
              : [],
          sourceConfig: nextSourceConfig,
          transcriptError:
            previous.sessionId === sessionId ? previous.transcriptError : null,
        };
      });
    },
    [sessionId],
  );

  const engine = useTurnEngine({
    sessionId,
    sourceConfig: effectiveSourceConfig,
    persistedMessages,
    setPersistedMessages,
    transport,
    onTranscriptRefreshNeeded: refreshTranscript,
    onSendStart,
  });
  const { attachActiveTurn } = engine;

  useEffect(() => {
    // Gate on isLocalSession so this can never race the hydrate effect
    // above: it only fires once localState has actually caught up to the
    // current sessionId (see the LocalSessionState comment).
    if (sessionQuery.isSuccess && isLocalSession) {
      void attachActiveTurn(sessionId);
    }
  }, [attachActiveTurn, isLocalSession, sessionId, sessionQuery.isSuccess]);

  return {
    session: sessionQuery.data,
    isLoading: sessionQuery.isLoading,
    transcriptError,
    retryTranscript: sessionQuery.refetch,
    persistedMessages,
    setPersistedMessages,
    sourceConfig: effectiveSourceConfig,
    setSourceConfig,
    ...engine,
  };
}
