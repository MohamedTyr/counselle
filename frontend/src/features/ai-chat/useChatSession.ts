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

import {
  chatKeys,
  useChatSession as useChatSessionQuery,
} from "@/api/chat/hooks";
import { BUILT_IN_SOURCE_CONFIG } from "@/api/chat/source-config";
import { BUILT_IN_DEFAULT_RESPONSE_MODE } from "@/api/chat/response-mode";
import type {
  ChatTransport,
  ResponseMode,
  SourceConfig,
} from "@/api/chat/types";
import { chatTransport } from "@/api/chat/transport";
import { messagesFromTranscript, type ChatMessage } from "./model";
import { transcriptErrorOf, type TranscriptError } from "./errors";
import { useTurnEngine } from "./useTurnEngine";

export type UseChatSessionOptions = {
  sessionId: string;
  transport?: ChatTransport;
  onSendStart?: () => void;
  /** The mode captured at the home composer, if this session was just
   * created from the handoff (plan §8.2/§8.3). Only consulted the first time
   * this session's local state is seeded -- once hydration or a local
   * override lands, this initial value never overwrites it again. */
  initialResponseMode?: ResponseMode;
};

type LocalSessionState = {
  // `null` until the transcript for the current `sessionId` has actually
  // hydrated. Do NOT initialize this to the incoming `sessionId` prop --
  // that would make `isLocalSession` trivially true before hydration ever
  // runs, letting the attach effect fire against an empty transcript.
  sessionId: string | null;
  persistedMessages: ChatMessage[];
  sourceConfig: SourceConfig | null;
  selectedResponseMode: ResponseMode | null;
  transcriptError: TranscriptError | null;
};

const sessionSourceConfigCache = new Map<string, SourceConfig>();
const sessionResponseModeCache = new Map<string, ResponseMode>();

function copySourceConfig(config: SourceConfig): SourceConfig {
  return {
    ...config,
    selectedSubreddits: [...config.selectedSubreddits],
  };
}

function readCachedSourceConfig(sessionId: string): SourceConfig | null {
  const cached = sessionSourceConfigCache.get(sessionId);
  return cached === undefined ? null : copySourceConfig(cached);
}

function writeCachedSourceConfig(
  sessionId: string,
  sourceConfig: SourceConfig | null,
) {
  if (sourceConfig === null) {
    sessionSourceConfigCache.delete(sessionId);
    return;
  }

  sessionSourceConfigCache.set(sessionId, copySourceConfig(sourceConfig));
}

function sameSourceConfig(left: SourceConfig | null, right: SourceConfig) {
  return (
    left !== null &&
    left.webSearch === right.webSearch &&
    left.eduSources === right.eduSources &&
    left.reddit === right.reddit &&
    left.selectedSubreddits.length === right.selectedSubreddits.length &&
    left.selectedSubreddits.every(
      (subreddit, index) => subreddit === right.selectedSubreddits[index],
    )
  );
}

function readCachedResponseMode(sessionId: string): ResponseMode | null {
  return sessionResponseModeCache.get(sessionId) ?? null;
}

function writeCachedResponseMode(sessionId: string, mode: ResponseMode | null) {
  if (mode === null) {
    sessionResponseModeCache.delete(sessionId);
    return;
  }
  sessionResponseModeCache.set(sessionId, mode);
}

export function clearChatSessionSourceConfigCacheForTests() {
  sessionSourceConfigCache.clear();
}

export function clearChatSessionResponseModeCacheForTests() {
  sessionResponseModeCache.clear();
}

export function useChatSession({
  sessionId,
  transport = chatTransport,
  onSendStart,
  initialResponseMode,
}: UseChatSessionOptions) {
  const queryClient = useQueryClient();
  const sessionQuery = useChatSessionQuery(sessionId);
  // Hydration order (plan §8.2): 1) the initial-turn mode from the home
  // handoff (seeded once, lazily, at mount -- this hook's owning route keys
  // by sessionId so it remounts fresh per session); 2) a locally captured
  // session mode bridging an in-flight navigation/commit race; 3) the
  // hydrated server session mode; 4) the config default (applied by the
  // caller when reading `selectedResponseMode`); 5) built-in Quick.
  const [localState, setLocalState] = useState<LocalSessionState>(() => {
    if (
      initialResponseMode !== undefined &&
      readCachedResponseMode(sessionId) === null
    ) {
      writeCachedResponseMode(sessionId, initialResponseMode);
    }
    return {
      sessionId: null,
      persistedMessages: [],
      sourceConfig: null,
      selectedResponseMode: null,
      transcriptError: null,
    };
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
  const cachedSourceConfig = useMemo(
    () => readCachedSourceConfig(sessionId),
    [sessionId],
  );
  const cachedResponseMode = useMemo(
    () => readCachedResponseMode(sessionId),
    [sessionId],
  );
  const sourceConfig = isLocalSession
    ? localState.sourceConfig
    : cachedSourceConfig;
  const selectedResponseMode = isLocalSession
    ? (localState.selectedResponseMode ?? cachedResponseMode)
    : cachedResponseMode;
  const transcriptError = isLocalSession ? localState.transcriptError : null;

  useEffect(() => {
    if (sessionQuery.data === undefined) {
      return;
    }

    const data = sessionQuery.data;
    const cached = readCachedSourceConfig(data.sessionId);
    const nextSourceConfig = cached ?? copySourceConfig(data.sourceConfig);
    const cachedMode = readCachedResponseMode(data.sessionId);
    const nextResponseMode =
      cachedMode ?? data.responseMode ?? BUILT_IN_DEFAULT_RESPONSE_MODE;

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
      sourceConfig: nextSourceConfig,
      selectedResponseMode: nextResponseMode,
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
              previous.sessionId === sessionId
                ? previous.sourceConfig
                : readCachedSourceConfig(sessionId),
            selectedResponseMode:
              previous.sessionId === sessionId
                ? previous.selectedResponseMode
                : readCachedResponseMode(sessionId),
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
      sourceConfig ?? sessionQuery.data?.sourceConfig ?? BUILT_IN_SOURCE_CONFIG,
    [sessionQuery.data?.sourceConfig, sourceConfig],
  );

  const effectiveResponseMode = useMemo(
    () =>
      selectedResponseMode ??
      sessionQuery.data?.responseMode ??
      BUILT_IN_DEFAULT_RESPONSE_MODE,
    [selectedResponseMode, sessionQuery.data?.responseMode],
  );

  const setPersistedMessages = useCallback<
    Dispatch<SetStateAction<ChatMessage[]>>
  >(
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
        const previousSourceConfig =
          previous.sessionId === sessionId
            ? previous.sourceConfig
            : readCachedSourceConfig(sessionId);
        const previousResponseMode =
          previous.sessionId === sessionId
            ? previous.selectedResponseMode
            : readCachedResponseMode(sessionId);

        return {
          sessionId,
          persistedMessages: nextMessages,
          sourceConfig: previousSourceConfig,
          selectedResponseMode: previousResponseMode,
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
          previous.sessionId === sessionId
            ? previous.sourceConfig
            : readCachedSourceConfig(sessionId);
        const nextSourceConfig =
          typeof action === "function" ? action(previousSourceConfig) : action;
        writeCachedSourceConfig(sessionId, nextSourceConfig);
        const previousResponseMode =
          previous.sessionId === sessionId
            ? previous.selectedResponseMode
            : readCachedResponseMode(sessionId);

        return {
          sessionId,
          persistedMessages:
            previous.sessionId === sessionId ? previous.persistedMessages : [],
          sourceConfig: nextSourceConfig,
          selectedResponseMode: previousResponseMode,
          transcriptError:
            previous.sessionId === sessionId ? previous.transcriptError : null,
        };
      });
    },
    [sessionId],
  );

  const setSelectedResponseMode = useCallback(
    (mode: ResponseMode) => {
      setLocalState((previous) => {
        if (sessionId !== sessionIdRef.current) {
          return previous;
        }

        writeCachedResponseMode(sessionId, mode);
        const previousSourceConfig =
          previous.sessionId === sessionId
            ? previous.sourceConfig
            : readCachedSourceConfig(sessionId);

        return {
          sessionId,
          persistedMessages:
            previous.sessionId === sessionId ? previous.persistedMessages : [],
          sourceConfig: previousSourceConfig,
          selectedResponseMode: mode,
          transcriptError:
            previous.sessionId === sessionId ? previous.transcriptError : null,
        };
      });
    },
    [sessionId],
  );

  const clearCommittedSourceConfig = useCallback(
    (activeSessionId: string, committedSourceConfig: SourceConfig) => {
      const cached = readCachedSourceConfig(activeSessionId);
      if (!sameSourceConfig(cached, committedSourceConfig)) {
        return;
      }

      writeCachedSourceConfig(activeSessionId, null);
      setLocalState((previous) => {
        if (
          previous.sessionId !== activeSessionId ||
          !sameSourceConfig(previous.sourceConfig, committedSourceConfig)
        ) {
          return previous;
        }

        return {
          ...previous,
          sourceConfig: copySourceConfig(committedSourceConfig),
        };
      });
    },
    [],
  );

  const clearCommittedResponseMode = useCallback(
    (activeSessionId: string, committedMode: ResponseMode) => {
      // Clear only when both the session id and the captured mode still
      // match (plan §8.2) -- a mismatch means either a newer local override
      // has since replaced it, or this callback is stale for another
      // session; either way, blindly clearing would drop a live user
      // choice or a different session's cache entry. `selectedResponseMode`
      // itself lives in `localState`, not derived from this cache while
      // `isLocalSession` -- clearing the bridge cache here needs no
      // accompanying state update.
      const cached = readCachedResponseMode(activeSessionId);
      if (cached !== committedMode) {
        return;
      }

      writeCachedResponseMode(activeSessionId, null);
    },
    [],
  );

  const engine = useTurnEngine({
    sessionId,
    sourceConfig: effectiveSourceConfig,
    persistedMessages,
    setPersistedMessages,
    transport,
    onTranscriptRefreshNeeded: refreshTranscript,
    onSourceConfigCommitted: clearCommittedSourceConfig,
    onResponseModeCommitted: clearCommittedResponseMode,
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
    // A successful query is not render-ready until its transcript/source
    // config has hydrated local state. This also prevents routed initial
    // prompts from racing hydration and being overwritten by it.
    isLoading:
      sessionQuery.isLoading || (sessionQuery.isSuccess && !isLocalSession),
    transcriptError,
    retryTranscript: sessionQuery.refetch,
    persistedMessages,
    setPersistedMessages,
    sourceConfig: effectiveSourceConfig,
    setSourceConfig,
    selectedResponseMode: effectiveResponseMode,
    setSelectedResponseMode,
    ...engine,
  };
}
