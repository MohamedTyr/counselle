import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { chatKeys } from "@/api/chat/hooks";
import { chatTransport } from "@/api/chat/transport";
import type {
  ChatTransport,
  ProtocolEvent,
  ResponseMode,
  SourceConfig,
  SseFrame,
  WidgetClarifyResponseV2,
} from "@/api/chat/types";
import { isTransportError, TransportError } from "@/api/http/errors";
import { isResponseMode } from "@/api/chat/response-mode";

import {
  forgetQueuedCounselingMode,
  readQueuedCounselingMode,
  rememberQueuedCounselingMode,
} from "./queued-counseling-mode";
import {
  initialTurnState,
  pendingUserSegmentsOf,
  reduceLiveTurn,
  type TurnState,
  type TurnStatus,
  withoutPendingUserSegments,
} from "./turn-reducer";
import { userMessage, assistantMessage, type ChatMessage } from "./model";
import {
  persistErroredTurn,
  persistTerminalTurn,
  patchClarifyResponse,
  reconcileMetaIds,
  upsertAssistantMessage,
} from "./stream-reconcile";
import { turnErrorOf, type TurnError } from "./errors";

const DEFAULT_CANCEL_WAIT_TIMEOUT_MS = 5_000;
const MODEL_UNAVAILABLE_ERROR_CODE = "model_unavailable";

export type LiveTurn = {
  sessionId: string;
  assistantMessageId: string;
  userMessageId: string;
  parentMessageId: string;
  hasBackendId: boolean;
  replaceMessageId?: string;
  /** The immutable mode locked in for this active/retried turn (plan
   * §5.5/§8.4) -- never re-read from a later selector change. Resolved from
   * the replayed `meta` once seen (authoritative confirmation of the same
   * decision, not a competing signal), which is how a reattach recovers it
   * before the local caller ever knew it. */
  executionResponseMode: ResponseMode;
  state: TurnState;
};

export type SubmitMessageResult =
  { ok: true; sessionId: string } | { ok: false; keepText: string };

export type SubmitMessageOptions = {
  text: string;
  /** Exact skill history for retries, regenerate, and initial-turn handoff. */
  skills?: readonly string[];
  /** The sticky counseling style for a normal new turn. */
  modeSkill?: string;
  /** Explicit one-shot skills selected for a normal new turn. */
  taskSkills?: readonly string[];
  /** The immutable mode for this specific attempt -- snapshotted by the
   * caller from whatever is correct for this call (the current next-turn
   * selector for a normal send, the failed attempt's captured mode for a
   * retry, the original assistant's historical mode for regenerate, or the
   * active turn's captured mode for an auto-forwarded steer). The engine
   * never substitutes a different, later value. */
  executionResponseMode: ResponseMode;
  replaceMessageId?: string;
  clarifyReplyTo?: string;
};

export type SubmitClarifyResponseOptions = {
  inReplyTo: string;
  response: WidgetClarifyResponseV2;
  executionResponseMode: ResponseMode;
};

type PendingSend = {
  text: string;
  skills: string[];
  executionResponseMode: ResponseMode;
  replaceMessageId?: string;
  clarifyReplyTo?: string;
  clarifyResponse?: WidgetClarifyResponseV2;
  optimisticUserMessageId?: string;
};

type ClarifySubmission =
  | { origin: "composer"; inReplyTo: string }
  | {
      origin: "widget";
      inReplyTo: string;
      response: WidgetClarifyResponseV2;
    };

type StartedTurn = {
  sessionId: string;
  userMessageId: string;
  optimisticUserMessageId?: string;
};

type AutoForwardMessage = {
  sessionId: string;
  id: string;
  text: string;
  modeSkill?: string;
  /** The active turn's mode at the moment it was queued -- not whatever the
   * selector shows once it later auto-forwards (plan §5.5/§8.4). */
  executionResponseMode: ResponseMode;
};

type NormalizedSkills = {
  skills: string[];
  modeSkill?: string;
  taskSkills: string[];
};

/** Recovery snapshot for a post-`meta` `model_unavailable` terminal error
 * (plan §5.4/§8.4): the failed turn is anchored on its backend
 * `userMessageId`, which is the server's edit/regenerate rewrite target. */
export type ModelUnavailableRecovery = {
  sessionId: string;
  userMessageId: string;
  text: string;
  skills: string[];
  failedResponseMode: ResponseMode;
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
  /** Fired once a normal new turn's `meta` confirms the backend has claimed
   * and persisted this mode as the session's sticky preference (plan §8.2) --
   * never fired for a parked clarify continuation or a replace/regenerate,
   * neither of which mutate stickiness. */
  onResponseModeCommitted?: (sessionId: string, mode: ResponseMode) => void;
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
    options: SubmitMessageOptions,
  ) => Promise<SubmitMessageResult>;
  submitClarifyResponse: (
    options: SubmitClarifyResponseOptions,
  ) => Promise<SubmitMessageResult>;
  retryLastSend: () => void;
  attachActiveTurn: (
    sessionId: string,
    activeModeSkill?: string | null,
  ) => Promise<void>;
  stopGenerating: () => void;
  clearTurnState: () => void;
  /** Set only after a post-`meta` `model_unavailable` terminal error -- the
   * two explicit recovery actions below become available. */
  modelUnavailableRecovery: ModelUnavailableRecovery | null;
  /** `Retry Think` (or whatever mode failed): history-rewrites the failed
   * turn with the SAME captured mode. Does not touch the sticky preference. */
  retryModelUnavailableSameMode: () => void;
  /** Explicit one-off `Retry with Quick`: history-rewrites the failed turn
   * in Quick without changing the chat's next-turn preference. */
  retryModelUnavailableWithQuick: () => void;
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

function normalizeSkills({
  skills,
  modeSkill,
  taskSkills,
}: Pick<
  SubmitMessageOptions,
  "skills" | "modeSkill" | "taskSkills"
>): NormalizedSkills {
  if (
    skills !== undefined &&
    (modeSkill !== undefined || taskSkills !== undefined)
  ) {
    throw new Error(
      "Exact skills cannot be combined with modeSkill or taskSkills.",
    );
  }
  if (skills !== undefined) {
    return { skills: [...skills], taskSkills: [...skills] };
  }

  const normalizedTaskSkills = taskSkills === undefined ? [] : [...taskSkills];
  return {
    skills:
      modeSkill === undefined
        ? normalizedTaskSkills
        : [modeSkill, ...normalizedTaskSkills],
    modeSkill,
    taskSkills: normalizedTaskSkills,
  };
}

/** The engine derives parked-clarify continuation from its own persisted
 * state -- it never trusts an arbitrary caller-supplied continuation flag
 * (plan §5.5/§8.4). Covers both the inline clarify-answer widget and a
 * free-text composer submit, since both call through the same `submitMessage`
 * with no special-cased argument. */
function isAwaitingClarifyContinuation(messages: readonly ChatMessage[]) {
  const tail = messages.at(-1);
  return (
    tail !== undefined &&
    tail.kind === "assistant" &&
    tail.turnStatus === "awaiting_input" &&
    tail.clarify !== undefined
  );
}

type ConsumeStreamOutcome = {
  metaSeen: boolean;
  assistantMessageId: string;
  userMessageId: string;
  status: TurnStatus;
  errorCode?: string;
};

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
  onResponseModeCommitted,
  onSendStart,
}: UseTurnEngineOptions): UseTurnEngineResult {
  const queryClient = useQueryClient();
  const [liveTurn, setLiveTurn] = useState<LiveTurn | null>(null);
  const [turnError, setTurnError] = useState<TurnError | null>(null);
  const [pendingSend, setPendingSend] = useState<PendingSend | null>(null);
  const [autoForwardVersion, setAutoForwardVersion] = useState(0);
  const [modelUnavailableRecovery, setModelUnavailableRecovery] =
    useState<ModelUnavailableRecovery | null>(null);

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
  const autoForwardQueueRef = useRef<AutoForwardMessage[]>([]);
  const autoForwardSeenRef = useRef(new Set<string>());
  const autoForwardModeByUserMessageIdRef = useRef(new Map<string, string>());

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
      executionResponseMode,
      initialAssistant,
      replaceMessageId,
      onMetaSeen,
      autoForwardFallbackModeSkill,
    }: {
      activeSessionId: string;
      stream: AsyncIterable<SseFrame<ProtocolEvent>>;
      initialUserMessageId: string;
      reconcileTempUserId: boolean;
      /** `null` only for an attach with no locally-known mode yet (it is
       * resolved from the replayed `meta` below). */
      executionResponseMode: ResponseMode | null;
      initialAssistant?: { messageId: string; hasBackendId: boolean };
      replaceMessageId?: string;
      onMetaSeen?: () => void;
      autoForwardFallbackModeSkill?: string | null;
    }): Promise<ConsumeStreamOutcome> => {
      let state = initialTurnState();
      let assistantMessageId =
        initialAssistant?.messageId ?? createTempId("temp-asst");
      let userMessageId = initialUserMessageId;
      let hasBackendId = initialAssistant?.hasBackendId ?? false;
      let metaSeen = false;
      let resolvedMode: ResponseMode = executionResponseMode ?? "quick";

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
          executionResponseMode: resolvedMode,
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
            if (isResponseMode(event.data.response_mode)) {
              resolvedMode = event.data.response_mode;
            }
            onMetaSeen?.();

            if (reconcileTempUserId && backendUserId !== userMessageId) {
              const previousUserId = userMessageId;
              setPersistedMessages(
                (previous) =>
                  reconcileMetaIds(previous, previousUserId, backendUserId)
                    .next,
              );
            }

            userMessageId = backendUserId;
          }

          if (event.type === "clarify_response") {
            hasBackendId = true;
            assistantMessageId = event.data.continuation_message_id;
            setPersistedMessages((previous) =>
              patchClarifyResponse(
                previous,
                event.data.clarify_message_id,
                event.data.continuation_message_id,
                event.data.response,
              ),
            );
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

        const pendingUserSegments = pendingUserSegmentsOf(state);
        const terminalState = withoutPendingUserSegments(state);
        const terminal = persistTerminalTurn({
          sessionId: activeSessionId,
          assistantMessageId,
          userMessageId,
          hasBackendId,
          state: terminalState,
          executionResponseMode: resolvedMode,
        });

        setPersistedMessages((previous) =>
          upsertAssistantMessage(previous, terminal),
        );
        const newForwards = pendingUserSegments.filter(
          (segment) => !autoForwardSeenRef.current.has(segment.id),
        );
        if (newForwards.length > 0) {
          for (const segment of newForwards) {
            autoForwardSeenRef.current.add(segment.id);
          }
          autoForwardQueueRef.current = [
            ...autoForwardQueueRef.current,
            ...newForwards.map((segment) => ({
              sessionId: activeSessionId,
              id: segment.id,
              text: segment.text,
              modeSkill:
                autoForwardModeByUserMessageIdRef.current.get(segment.id) ??
                readQueuedCounselingMode(activeSessionId, segment.id) ??
                autoForwardFallbackModeSkill ??
                undefined,
              executionResponseMode: resolvedMode,
            })),
          ];
          setAutoForwardVersion((version) => version + 1);
        }
        void queryClient.invalidateQueries({
          queryKey: chatKeys.sessions.all(),
        });
        void queryClient.invalidateQueries({
          queryKey: chatKeys.session(activeSessionId),
        });
        return {
          metaSeen,
          assistantMessageId,
          userMessageId,
          status: terminalState.status,
          errorCode: terminalState.error?.code,
        };
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
            executionResponseMode: resolvedMode,
          });
          setPersistedMessages((previous) =>
            upsertAssistantMessage(previous, errored),
          );
          return {
            metaSeen,
            assistantMessageId,
            userMessageId,
            status: "error",
          };
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
      skills: readonly string[],
      executionResponseMode: ResponseMode,
      replaceMessageId?: string,
      clarifySubmission?: ClarifySubmission,
    ) => {
      const controller = beginTurnAbort();
      const committedSourceConfig = sourceConfigRef.current;
      // The engine derives parked-clarify continuation itself; it never
      // trusts a caller flag (plan §5.5/§8.4). A regenerate/replace call is
      // never a clarify continuation (it always supplies replaceMessageId,
      // which a real clarify answer never does), so it always sends its
      // mode explicitly.
      const isClarifyContinuation =
        clarifySubmission !== undefined ||
        isAwaitingClarifyContinuation(persistedRef.current);
      // A genuine normal new turn -- not a parked clarify continuation, not
      // a replace/regenerate -- is the only kind that may commit its mode as
      // the chat's sticky next-turn preference (plan §8.2/§8.4).
      const isCommittableNormalTurn =
        !isClarifyContinuation && replaceMessageId === undefined;

      let outcome: ConsumeStreamOutcome;
      try {
        outcome = await consumeStream({
          activeSessionId,
          stream: transport.sendMessage({
            sessionId: activeSessionId,
            text,
            sourceConfig: isClarifyContinuation
              ? undefined
              : committedSourceConfig,
            skills: isClarifyContinuation ? undefined : [...skills],
            replaceMessageId: isClarifyContinuation
              ? undefined
              : replaceMessageId,
            responseMode: isClarifyContinuation
              ? undefined
              : executionResponseMode,
            inReplyTo: clarifySubmission?.inReplyTo,
            clarifyResponse:
              clarifySubmission?.origin === "widget"
                ? clarifySubmission.response
                : undefined,
            signal: controller.signal,
          }),
          initialUserMessageId: tempUserMessageId,
          reconcileTempUserId: true,
          executionResponseMode,
          replaceMessageId,
          onMetaSeen: isCommittableNormalTurn
            ? () =>
                onResponseModeCommitted?.(
                  activeSessionId,
                  executionResponseMode,
                )
            : undefined,
        });
        if (!isClarifyContinuation) {
          onSourceConfigCommitted?.(activeSessionId, committedSourceConfig);
        }
      } catch (error) {
        if (
          clarifySubmission !== undefined &&
          isTransportError(error) &&
          error.kind === "conflict"
        ) {
          onTranscriptRefreshNeeded?.(activeSessionId);
          setTurnError({
            kind: "server",
            message:
              "That clarification was already answered or is no longer current.",
          });
          setPendingSend(null);
          return;
        }
        setPendingSend({
          text,
          skills: [...skills],
          executionResponseMode,
          replaceMessageId,
          clarifyReplyTo:
            clarifySubmission?.origin === "composer"
              ? clarifySubmission.inReplyTo
              : undefined,
          clarifyResponse:
            clarifySubmission?.origin === "widget"
              ? clarifySubmission.response
              : undefined,
        });
        throw error;
      }

      if (
        outcome.status === "error" &&
        outcome.errorCode === MODEL_UNAVAILABLE_ERROR_CODE
      ) {
        setModelUnavailableRecovery({
          sessionId: activeSessionId,
          userMessageId: outcome.userMessageId,
          text,
          skills: [...skills],
          failedResponseMode: executionResponseMode,
        });
      } else {
        setModelUnavailableRecovery(null);
      }

      if (replaceMessageId !== undefined) {
        onTranscriptRefreshNeeded?.(activeSessionId);
      }
    },
    [
      beginTurnAbort,
      consumeStream,
      onResponseModeCommitted,
      onSourceConfigCommitted,
      onTranscriptRefreshNeeded,
      transport,
    ],
  );

  const startSend = useCallback(
    async (
      text: string,
      skills: readonly string[],
      executionResponseMode: ResponseMode,
      replaceMessageId?: string,
      clarifySubmission?: ClarifySubmission,
    ): Promise<StartedTurn> => {
      if (liveTurnRef.current !== null) {
        throw new Error("A turn is already running.");
      }

      let activeSessionId = sessionIdRef.current;
      if (activeSessionId === null) {
        const created = await transport.createSession({
          sourceConfig: sourceConfigRef.current,
          responseMode: executionResponseMode,
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
      if (
        replaceMessageId === undefined &&
        clarifySubmission?.origin !== "widget"
      ) {
        optimisticUserMessageId = tempUserId;
        setPersistedMessages((previous) => [
          ...previous,
          userMessage(
            activeSessionId,
            tempUserId,
            previous.at(-1)?.messageId ?? null,
            text,
            new Date().toISOString(),
            skills,
          ),
        ]);
      } else {
        tempUserId =
          replaceMessageId ??
          (clarifySubmission?.origin === "widget"
            ? clarifySubmission.inReplyTo
            : tempUserId);
      }
      lastStartedUserMessageIdRef.current = tempUserId;

      onSendStart?.();
      await runTurn(
        activeSessionId,
        tempUserId,
        text,
        skills,
        executionResponseMode,
        replaceMessageId,
        clarifySubmission,
      );
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

  const awaitLiveClear = useCallback(async (): Promise<boolean> => {
    const startedAt = Date.now();
    while (
      isMountedRef.current &&
      liveTurnRef.current !== null &&
      Date.now() - startedAt < cancelWaitTimeoutMs
    ) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return liveTurnRef.current === null;
  }, [cancelWaitTimeoutMs]);

  const submitMessage = useCallback(
    async ({
      text,
      skills: skillsOption,
      modeSkill: modeSkillOption,
      taskSkills: taskSkillsOption,
      executionResponseMode,
      replaceMessageId,
      clarifyReplyTo,
    }: SubmitMessageOptions): Promise<SubmitMessageResult> => {
      const { skills, modeSkill, taskSkills } = normalizeSkills({
        skills: skillsOption,
        modeSkill: modeSkillOption,
        taskSkills: taskSkillsOption,
      });
      const trimmed = text.trim();
      const clarifySubmission =
        clarifyReplyTo === undefined
          ? undefined
          : ({ origin: "composer", inReplyTo: clarifyReplyTo } as const);
      if (!trimmed) {
        return { ok: false, keepText: text };
      }

      // A temp/optimistic id has no backend id yet -- it can't anchor a
      // server-side history rewrite. Refuse rather than send a bogus
      // replace_message_id (mirrors the old engine's refusal-on-temp-id).
      if (
        replaceMessageId !== undefined &&
        replaceMessageId.startsWith("temp-")
      ) {
        return { ok: false, keepText: text };
      }

      setPendingSend(null);
      setTurnError(null);
      setModelUnavailableRecovery(null);

      if (
        liveTurnRef.current !== null &&
        replaceMessageId === undefined &&
        clarifySubmission === undefined
      ) {
        if (taskSkills.length > 0) {
          setTurnError({
            kind: "server",
            message:
              "Wait for the current response to finish before using a skill.",
          });
          setPendingSend({ text, skills, executionResponseMode });
          return { ok: false, keepText: text };
        }
        const active = liveTurnRef.current;
        try {
          const steer = await transport.steerMessage({
            sessionId: active.sessionId,
            text: trimmed,
          });
          if (steer.status === "queued") {
            if (modeSkill !== undefined) {
              autoForwardModeByUserMessageIdRef.current.set(
                steer.userMessageId,
                modeSkill,
              );
              rememberQueuedCounselingMode(
                active.sessionId,
                steer.userMessageId,
                modeSkill,
              );
            }
            return { ok: true, sessionId: active.sessionId };
          }
          const cleared = await awaitLiveClear();
          if (!cleared) {
            setPendingSend({ text, skills, executionResponseMode });
            return { ok: false, keepText: text };
          }
        } catch (error) {
          setTurnError(turnErrorOf(error));
          setPendingSend({ text, skills, executionResponseMode });
          return { ok: false, keepText: text };
        }
      }

      if (liveTurnRef.current !== null) {
        const cleared = await cancelAndAwaitClear();
        if (!cleared) {
          setPendingSend({
            text,
            skills,
            executionResponseMode,
            replaceMessageId,
            clarifyReplyTo,
          });
          return { ok: false, keepText: text };
        }
      }

      try {
        const started = await startSend(
          trimmed,
          skills,
          executionResponseMode,
          replaceMessageId,
          clarifySubmission,
        );
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
              // append a second one. Reuses the same executionResponseMode
              // captured for this whole submitMessage call -- never a
              // fresher selector read.
              await runTurn(
                activeSessionId,
                replaceMessageId ??
                  lastStartedUserMessageIdRef.current ??
                  createTempId("temp-user"),
                trimmed,
                skills,
                executionResponseMode,
                replaceMessageId,
                clarifySubmission,
              );
              return { ok: true, sessionId: activeSessionId };
            } catch (retryError) {
              setTurnError(turnErrorOf(retryError));
              setPendingSend({
                text,
                skills,
                executionResponseMode,
                replaceMessageId,
                clarifyReplyTo,
                optimisticUserMessageId:
                  replaceMessageId === undefined
                    ? (lastStartedUserMessageIdRef.current ?? undefined)
                    : undefined,
              });
              return { ok: false, keepText: text };
            }
          }
        }

        setTurnError(turnErrorOf(error));
        setPendingSend({
          text,
          skills,
          executionResponseMode,
          replaceMessageId,
          clarifyReplyTo,
          optimisticUserMessageId:
            replaceMessageId === undefined
              ? (lastStartedUserMessageIdRef.current ?? undefined)
              : undefined,
        });
        return { ok: false, keepText: text };
      }
    },
    [awaitLiveClear, cancelAndAwaitClear, runTurn, startSend, transport],
  );

  const submitClarifyResponse = useCallback(
    async ({
      inReplyTo,
      response,
      executionResponseMode,
    }: SubmitClarifyResponseOptions): Promise<SubmitMessageResult> => {
      setPendingSend(null);
      setTurnError(null);
      setModelUnavailableRecovery(null);

      if (liveTurnRef.current !== null) {
        const cleared = await cancelAndAwaitClear();
        if (!cleared) {
          return { ok: false, keepText: "" };
        }
      }

      try {
        const started = await startSend(
          "",
          [],
          executionResponseMode,
          undefined,
          { origin: "widget", inReplyTo, response },
        );
        return { ok: true, sessionId: started.sessionId };
      } catch (error) {
        if (isTransportError(error) && error.kind === "conflict") {
          onTranscriptRefreshNeeded?.(sessionIdRef.current ?? inReplyTo);
          setTurnError({
            kind: "server",
            message:
              "That clarification was already answered or is no longer current.",
          });
          setPendingSend(null);
          return { ok: true, sessionId: sessionIdRef.current ?? inReplyTo };
        }
        setPendingSend({
          text: "",
          skills: [],
          executionResponseMode,
          clarifyReplyTo: inReplyTo,
          clarifyResponse: response,
        });
        setTurnError(turnErrorOf(error));
        return { ok: false, keepText: "" };
      }
    },
    [cancelAndAwaitClear, onTranscriptRefreshNeeded, startSend],
  );

  useEffect(() => {
    if (liveTurn !== null || autoForwardQueueRef.current.length === 0) {
      return;
    }

    const next = autoForwardQueueRef.current[0];
    autoForwardQueueRef.current = autoForwardQueueRef.current.slice(1);
    if (next.modeSkill !== undefined) {
      autoForwardModeByUserMessageIdRef.current.delete(next.id);
    }
    forgetQueuedCounselingMode(next.sessionId, next.id);
    void submitMessage({
      text: next.text,
      modeSkill: next.modeSkill,
      executionResponseMode: next.executionResponseMode,
    });
  }, [autoForwardVersion, liveTurn, submitMessage]);

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
    if (
      pending.clarifyResponse !== undefined &&
      pending.clarifyReplyTo !== undefined
    ) {
      void submitClarifyResponse({
        inReplyTo: pending.clarifyReplyTo,
        response: pending.clarifyResponse,
        executionResponseMode: pending.executionResponseMode,
      });
      return;
    }
    void submitMessage({
      text: pending.text,
      skills: pending.skills,
      executionResponseMode: pending.executionResponseMode,
      replaceMessageId: pending.replaceMessageId,
      clarifyReplyTo: pending.clarifyReplyTo,
    });
  }, [pendingSend, setPersistedMessages, submitClarifyResponse, submitMessage]);

  const retryModelUnavailableSameMode = useCallback(() => {
    const recovery = modelUnavailableRecovery;
    if (recovery === null || liveTurnRef.current !== null) {
      return;
    }
    setModelUnavailableRecovery(null);
    void submitMessage({
      text: recovery.text,
      skills: recovery.skills,
      executionResponseMode: recovery.failedResponseMode,
      replaceMessageId: recovery.userMessageId,
    });
  }, [modelUnavailableRecovery, submitMessage]);

  const retryModelUnavailableWithQuick = useCallback(() => {
    const recovery = modelUnavailableRecovery;
    if (recovery === null || liveTurnRef.current !== null) {
      return;
    }
    setModelUnavailableRecovery(null);
    void submitMessage({
      text: recovery.text,
      skills: recovery.skills,
      executionResponseMode: "quick",
      replaceMessageId: recovery.userMessageId,
    });
  }, [modelUnavailableRecovery, submitMessage]);

  const attachActiveTurn = useCallback(
    async (activeSessionId: string, activeModeSkill?: string | null) => {
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
            message.kind === "user" &&
            message.conversationId === activeSessionId,
        );
      const tail = persistedRef.current.at(-1);
      const continuationSeed =
        tail?.kind === "assistant" &&
        tail.conversationId === activeSessionId &&
        tail.continuationMessageId !== undefined
          ? { messageId: tail.continuationMessageId, hasBackendId: true }
          : undefined;
      const seedAssistant =
        continuationSeed ??
        (tail?.kind === "assistant" &&
        tail.conversationId === activeSessionId &&
        tail.hasBackendId === true
          ? { messageId: tail.messageId, hasBackendId: true }
          : undefined);

      try {
        // The active turn's mode isn't locally known on attach -- it's
        // resolved from the replayed `meta` inside consumeStream (plan
        // §8.4: "Active attach: execution mode restores from meta").
        await consumeStream({
          activeSessionId,
          stream: result.stream,
          initialUserMessageId:
            lastUser?.messageId ?? createTempId("temp-user"),
          reconcileTempUserId: false,
          executionResponseMode: null,
          initialAssistant: seedAssistant,
          autoForwardFallbackModeSkill: activeModeSkill,
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
        { supported: true, mode: liveTurn.executionResponseMode },
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
    isSubmitting:
      liveTurn !== null &&
      liveTurn.sessionId === sessionId &&
      isTurnActive(liveTurn),
    turnError,
    pendingText: pendingSend?.text ?? null,
    awaitingClarify,
    submitMessage,
    submitClarifyResponse,
    retryLastSend,
    attachActiveTurn,
    stopGenerating,
    clearTurnState,
    modelUnavailableRecovery,
    retryModelUnavailableSameMode,
    retryModelUnavailableWithQuick,
  };
}
