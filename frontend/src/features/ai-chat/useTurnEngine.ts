import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { chatKeys } from "@/api/chat/hooks";
import { chatTransport } from "@/api/chat/transport";
import type {
  ChatTransport,
  ProtocolEvent,
  SourceConfig,
  SseFrame,
} from "@/api/chat/types";
import { isTransportError, TransportError } from "@/api/http/errors";

import {
  initialTurnState,
  reduceLiveTurn,
  type TurnState,
} from "./turn-reducer";
import { userMessage, assistantMessage, type ChatMessage } from "./model";
import {
  persistErroredTurn,
  persistTerminalTurn,
  reconcileMetaIds,
  upsertAssistantMessage,
} from "./stream-reconcile";
import { turnErrorOf, type TurnError } from "./errors";

const DEFAULT_CANCEL_WAIT_TIMEOUT_MS = 5_000;

export type LiveTurn = {
  sessionId: string;
  assistantMessageId: string;
  userMessageId: string;
  parentMessageId: string;
  hasBackendId: boolean;
  replaceMessageId?: string;
  state: TurnState;
};

export type SubmitMessageResult =
  | { ok: true; sessionId: string }
  | { ok: false; keepText: string };

type PendingSend = {
  text: string;
  replaceMessageId?: string;
  optimisticUserMessageId?: string;
};

type StartedTurn = {
  sessionId: string;
  userMessageId: string;
  optimisticUserMessageId?: string;
};

export type UseTurnEngineOptions = {
  sessionId: string | null;
  sourceConfig: SourceConfig;
  persistedMessages: ChatMessage[];
  setPersistedMessages: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
  transport?: ChatTransport;
  cancelWaitTimeoutMs?: number;
  onSessionCreated?: (sessionId: string) => void;
  onTranscriptRefreshNeeded?: (sessionId: string) => void;
  onSourceConfigCommitted?: (
    sessionId: string,
    sourceConfig: SourceConfig,
  ) => void;
  onSendStart?: () => void;
};

export type UseTurnEngineResult = {
  messages: ChatMessage[];
  liveTurn: LiveTurn | null;
  isSubmitting: boolean;
  turnError: TurnError | null;
  pendingText: string | null;
  awaitingClarify: boolean;
  submitMessage: (
    text: string,
    replaceMessageId?: string,
  ) => Promise<SubmitMessageResult>;
  retryLastSend: () => void;
  attachActiveTurn: (sessionId: string) => Promise<void>;
  stopGenerating: () => void;
  clearTurnState: () => void;
};

function isTurnActive(turn: LiveTurn | null) {
  return (
    turn !== null &&
    (turn.state.status === "streaming" || turn.state.status === "idle")
  );
}

function createTempId(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

export function useTurnEngine({
  sessionId,
  sourceConfig,
  persistedMessages,
  setPersistedMessages,
  transport = chatTransport,
  cancelWaitTimeoutMs = DEFAULT_CANCEL_WAIT_TIMEOUT_MS,
  onSessionCreated,
  onTranscriptRefreshNeeded,
  onSourceConfigCommitted,
  onSendStart,
}: UseTurnEngineOptions): UseTurnEngineResult {
  const queryClient = useQueryClient();
  const [liveTurn, setLiveTurn] = useState<LiveTurn | null>(null);
  const [turnError, setTurnError] = useState<TurnError | null>(null);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);

  const sessionIdRef = useRef(sessionId);
  const liveTurnRef = useRef(liveTurn);
  const persistedRef = useRef(persistedMessages);
  const sourceConfigRef = useRef(sourceConfig);
  const lastStartedSessionIdRef = useRef<string | null>(null);
  const lastStartedUserMessageIdRef = useRef<string | null>(null);
  const cancelInFlightRef = useRef(false);
  const cancelCommittedRef = useRef(false);
  const isMountedRef = useRef(true);
  const turnAbortControllerRef = useRef<AbortController | null>(null);

  sessionIdRef.current = sessionId;
  liveTurnRef.current = liveTurn;
  persistedRef.current = persistedMessages;
  sourceConfigRef.current = sourceConfig;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // Tear down any in-flight SSE read so navigating away (or a fresh
      // hook instance from a route remount) doesn't leave the fetch
      // reading a response body nobody is listening to anymore.
      turnAbortControllerRef.current?.abort();
    };
  }, []);

  const beginTurnAbort = useCallback(() => {
    turnAbortControllerRef.current?.abort();
    const controller = new AbortController();
    turnAbortControllerRef.current = controller;
    return controller;
  }, []);

  const publishTurn = useCallback((turn: LiveTurn) => {
    liveTurnRef.current = turn;
    setLiveTurn(turn);
  }, []);

  const consumeStream = useCallback(
    async ({
      activeSessionId,
      stream,
      initialUserMessageId,
      reconcileTempUserId,
      initialAssistant,
      replaceMessageId,
    }: {
      activeSessionId: string;
      stream: AsyncIterable<SseFrame<ProtocolEvent>>;
      initialUserMessageId: string;
      reconcileTempUserId: boolean;
      initialAssistant?: { messageId: string; hasBackendId: boolean };
      replaceMessageId?: string;
    }): Promise<boolean> => {
      let state = initialTurnState();
      let assistantMessageId =
        initialAssistant?.messageId ?? createTempId("temp-asst");
      let userMessageId = initialUserMessageId;
      let hasBackendId = initialAssistant?.hasBackendId ?? false;
      let metaSeen = false;

      cancelCommittedRef.current = false;
      cancelInFlightRef.current = false;

      const publish = () => {
        publishTurn({
          sessionId: activeSessionId,
          assistantMessageId,
          userMessageId,
          parentMessageId: userMessageId,
          hasBackendId,
          replaceMessageId,
          state,
        });
      };

      publish();

      try {
        for await (const frame of stream) {
          const event = frame.data;

          if (event.type === "meta") {
            metaSeen = true;
            hasBackendId = true;
            assistantMessageId = event.data.message_id;
            const backendUserId = event.data.user_message_id;

            if (reconcileTempUserId && backendUserId !== userMessageId) {
              const previousUserId = userMessageId;
              setPersistedMessages((previous) =>
                reconcileMetaIds(previous, previousUserId, backendUserId).next,
              );
            }

            userMessageId = backendUserId;
          }

          state = reduceLiveTurn(state, event);
          publish();
        }

        if (state.status === "streaming" || state.status === "idle") {
          throw new TransportError(
            "network",
            "Connection lost before the answer completed.",
          );
        }

        const terminal = persistTerminalTurn({
          sessionId: activeSessionId,
          assistantMessageId,
          userMessageId,
          hasBackendId,
          state,
        });

        setPersistedMessages((previous) =>
          upsertAssistantMessage(previous, terminal),
        );
        void queryClient.invalidateQueries({
          queryKey: chatKeys.sessions.all(),
        });
        void queryClient.invalidateQueries({
          queryKey: chatKeys.session(activeSessionId),
        });
        return metaSeen;
      } catch (error) {
        const mapped = turnErrorOf(error);
        setTurnError(mapped);

        if (metaSeen) {
          const errored = persistErroredTurn({
            sessionId: activeSessionId,
            assistantMessageId,
            userMessageId,
            hasBackendId,
            state,
            message: mapped.message,
          });
          setPersistedMessages((previous) =>
            upsertAssistantMessage(previous, errored),
          );
          return true;
        }

        throw error;
      } finally {
        liveTurnRef.current = null;
        setLiveTurn(null);
      }
    },
    [publishTurn, queryClient, setPersistedMessages],
  );

  const runTurn = useCallback(
    async (
      activeSessionId: string,
      tempUserMessageId: string,
      text: string,
      replaceMessageId?: string,
    ) => {
      const controller = beginTurnAbort();
      const committedSourceConfig = sourceConfigRef.current;
      try {
        await consumeStream({
          activeSessionId,
          stream: transport.sendMessage({
            sessionId: activeSessionId,
            text,
            sourceConfig: committedSourceConfig,
            replaceMessageId,
            signal: controller.signal,
          }),
          initialUserMessageId: tempUserMessageId,
          reconcileTempUserId: true,
          replaceMessageId,
        });
        onSourceConfigCommitted?.(activeSessionId, committedSourceConfig);
      } catch (error) {
        setPendingSend({ text, replaceMessageId });
        throw error;
      }

      if (replaceMessageId !== undefined) {
        onTranscriptRefreshNeeded?.(activeSessionId);
      }
    },
    [
      beginTurnAbort,
      consumeStream,
      onSourceConfigCommitted,
      onTranscriptRefreshNeeded,
      transport,
    ],
  );

  const startSend = useCallback(
    async (text: string, replaceMessageId?: string): Promise<StartedTurn> => {
      if (liveTurnRef.current !== null) {
        throw new Error("A turn is already running.");
      }

      let activeSessionId = sessionIdRef.current;
      if (activeSessionId === null) {
        const created = await transport.createSession({
          sourceConfig: sourceConfigRef.current,
        });
        activeSessionId = created.sessionId;
        onSessionCreated?.(activeSessionId);
        void queryClient.invalidateQueries({
          queryKey: chatKeys.sessions.all(),
        });
      }
      lastStartedSessionIdRef.current = activeSessionId;

      let tempUserId = createTempId("temp-user");
      let optimisticUserMessageId: string | undefined;
      if (replaceMessageId === undefined) {
        optimisticUserMessageId = tempUserId;
        setPersistedMessages((previous) => [
          ...previous,
          userMessage(
            activeSessionId,
            tempUserId,
            previous.at(-1)?.messageId ?? null,
            text,
            new Date().toISOString(),
          ),
        ]);
      } else {
        tempUserId = replaceMessageId;
      }
      lastStartedUserMessageIdRef.current = tempUserId;

      onSendStart?.();
      await runTurn(activeSessionId, tempUserId, text, replaceMessageId);
      return {
        sessionId: activeSessionId,
        userMessageId: tempUserId,
        optimisticUserMessageId,
      };
    },
    [
      onSendStart,
      onSessionCreated,
      queryClient,
      runTurn,
      setPersistedMessages,
      transport,
    ],
  );

  const cancelAndAwaitClear = useCallback(async (): Promise<boolean> => {
    const active = liveTurnRef.current;
    if (active === null) {
      return true;
    }

    try {
      await transport.cancelActiveTurn(active.sessionId);
    } catch {
      // The server may never learn we asked it to stop -- abort the local
      // read now rather than let it hang; we've already lost the graceful
      // terminal event either way.
      turnAbortControllerRef.current?.abort();
    }

    const startedAt = Date.now();
    while (
      isMountedRef.current &&
      liveTurnRef.current !== null &&
      Date.now() - startedAt < cancelWaitTimeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    if (liveTurnRef.current !== null) {
      // Gave up waiting for a graceful terminal event -- abort so the
      // abandoned read stops mutating state once it eventually settles.
      turnAbortControllerRef.current?.abort();
      if (isMountedRef.current) {
        setTurnError({
          kind: "network",
          message: "Couldn't stop the previous response. Try again.",
        });
      }
      return false;
    }

    return true;
  }, [cancelWaitTimeoutMs, transport]);

  const submitMessage = useCallback(
    async (
      text: string,
      replaceMessageId?: string,
    ): Promise<SubmitMessageResult> => {
      const trimmed = text.trim();
      if (!trimmed) {
        return { ok: false, keepText: text };
      }

      // A temp/optimistic id has no backend id yet -- it can't anchor a
      // server-side history rewrite. Refuse rather than send a bogus
      // replace_message_id (mirrors the old engine's refusal-on-temp-id).
      if (replaceMessageId !== undefined && replaceMessageId.startsWith("temp-")) {
        return { ok: false, keepText: text };
      }

      setPendingSend(null);
      setTurnError(null);

      if (liveTurnRef.current !== null) {
        const cleared = await cancelAndAwaitClear();
        if (!cleared) {
          setPendingSend({ text, replaceMessageId });
          return { ok: false, keepText: text };
        }
      }

      try {
        const started = await startSend(trimmed, replaceMessageId);
        return { ok: true, sessionId: started.sessionId };
      } catch (error) {
        if (isTransportError(error) && error.kind === "conflict") {
          const activeSessionId =
            sessionIdRef.current ?? lastStartedSessionIdRef.current;
          if (activeSessionId !== null) {
            try {
              await transport.cancelActiveTurn(activeSessionId);
              setTurnError(null);
              setPendingSend(null);
              // Retry via runTurn (not startSend): the optimistic user
              // bubble from the original attempt is already in
              // persistedMessages, so re-calling startSend here would
              // append a second one.
              await runTurn(
                activeSessionId,
                replaceMessageId ??
                  lastStartedUserMessageIdRef.current ??
                  createTempId("temp-user"),
                trimmed,
                replaceMessageId,
              );
              return { ok: true, sessionId: activeSessionId };
            } catch (retryError) {
              setTurnError(turnErrorOf(retryError));
              setPendingSend({
                text,
                replaceMessageId,
                optimisticUserMessageId:
                  replaceMessageId === undefined
                    ? lastStartedUserMessageIdRef.current ?? undefined
                    : undefined,
              });
              return { ok: false, keepText: text };
            }
          }
        }

        setTurnError(turnErrorOf(error));
        setPendingSend({
          text,
          replaceMessageId,
          optimisticUserMessageId:
            replaceMessageId === undefined
              ? lastStartedUserMessageIdRef.current ?? undefined
              : undefined,
        });
        return { ok: false, keepText: text };
      }
    },
    [cancelAndAwaitClear, runTurn, startSend, transport],
  );

  const retryLastSend = useCallback(() => {
    const pending = pendingSend;
    if (pending === null || liveTurnRef.current !== null) {
      return;
    }

    setPendingSend(null);
    setTurnError(null);
    if (pending.optimisticUserMessageId !== undefined) {
      setPersistedMessages((previous) =>
        previous.filter(
          (message) => message.messageId !== pending.optimisticUserMessageId,
        ),
      );
    }
    void submitMessage(pending.text, pending.replaceMessageId);
  }, [pendingSend, setPersistedMessages, submitMessage]);

  const attachActiveTurn = useCallback(
    async (activeSessionId: string) => {
      if (liveTurnRef.current !== null) {
        return;
      }

      const controller = beginTurnAbort();
      let result;
      try {
        result = await transport.attachStream({
          sessionId: activeSessionId,
          signal: controller.signal,
        });
      } catch {
        // attach failed to open -- leave loaded transcript in place; no
        // active turn to surface.
        return;
      }

      if (!result.active) {
        return;
      }

      const lastUser = [...persistedRef.current]
        .reverse()
        .find(
          (message) =>
            message.kind === "user" && message.conversationId === activeSessionId,
        );
      const tail = persistedRef.current.at(-1);
      const seedAssistant =
        tail?.kind === "assistant" &&
        tail.conversationId === activeSessionId &&
        tail.hasBackendId === true
          ? { messageId: tail.messageId, hasBackendId: true }
          : undefined;

      try {
        await consumeStream({
          activeSessionId,
          stream: result.stream,
          initialUserMessageId: lastUser?.messageId ?? createTempId("temp-user"),
          reconcileTempUserId: false,
          initialAssistant: seedAssistant,
        });
      } catch (error) {
        setTurnError(turnErrorOf(error));
      }
    },
    [beginTurnAbort, consumeStream, transport],
  );

  const stopGenerating = useCallback(() => {
    const active = liveTurnRef.current;
    if (
      active === null ||
      cancelCommittedRef.current ||
      cancelInFlightRef.current ||
      !isTurnActive(active)
    ) {
      return;
    }

    cancelInFlightRef.current = true;
    void transport
      .cancelActiveTurn(active.sessionId)
      .then(() => {
        cancelCommittedRef.current = true;
      })
      .catch(() => {
        // The server may never learn we asked it to stop -- abort the
        // local read now rather than let it hang.
        turnAbortControllerRef.current?.abort();
        setTurnError({
          kind: "network",
          message: "Could not stop the response. Try again.",
        });
      })
      .finally(() => {
        cancelInFlightRef.current = false;
      });
  }, [transport]);

  const clearTurnState = useCallback(() => {
    setTurnError(null);
    setPendingSend(null);
  }, []);

  const messages = useMemo(() => {
    if (liveTurn === null || liveTurn.sessionId !== sessionId) {
      return persistedMessages;
    }

    const liveMessage = {
      ...assistantMessage(
        liveTurn.sessionId,
        liveTurn.assistantMessageId,
        liveTurn.parentMessageId,
        liveTurn.state,
        null,
      ),
      hasBackendId: liveTurn.hasBackendId,
    };

    // When editing/replacing a message, hide the stale branch that came
    // after the edited message while the replacement streams in -- an
    // intentional improvement over the old behavior, which left the
    // original trailing turns visible during a live edit.
    const replaceIndex =
      liveTurn.replaceMessageId === undefined
        ? -1
        : persistedMessages.findIndex(
            (message) => message.messageId === liveTurn.replaceMessageId,
          );
    const visiblePersisted =
      replaceIndex === -1
        ? persistedMessages
        : persistedMessages.slice(0, replaceIndex + 1);

    return [
      ...visiblePersisted.filter(
        (message) => message.messageId !== liveTurn.assistantMessageId,
      ),
      liveMessage,
    ];
  }, [liveTurn, persistedMessages, sessionId]);

  const latestMessage = messages.at(-1);
  const awaitingClarify =
    latestMessage?.kind === "assistant" &&
    latestMessage.turnStatus === "awaiting_input" &&
    latestMessage.clarify !== undefined;

  return {
    messages,
    liveTurn,
    isSubmitting: liveTurn !== null && liveTurn.sessionId === sessionId && isTurnActive(liveTurn),
    turnError,
    pendingText: pendingSend?.text ?? null,
    awaitingClarify,
    submitMessage,
    retryLastSend,
    attachActiveTurn,
    stopGenerating,
    clearTurnState,
  };
}
