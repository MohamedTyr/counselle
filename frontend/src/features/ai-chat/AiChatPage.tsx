import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMessageFeedback } from "@/api/chat/hooks";
import { useChatConfig } from "@/api/chat/config";
import {
  BUILT_IN_RESPONSE_MODE_OPTIONS,
  normalizeResponseModeSelection,
} from "@/api/chat/response-mode";
import type { ChatTransport } from "@/api/chat/types";
import {
  deriveHistoricalModeSkill,
  findCounselingMode,
  splitSelectedSkills,
} from "@/features/ai-composer/counseling-mode";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

import { ChatComposer } from "./components/ChatComposer";
import { ChatMessages } from "./components/ChatMessages";
import type { ClarifyWidgetAnswer } from "./components/clarify/types";
import type { MessageSourcesPayload } from "./components/MessageSources";
import { SourcesRail } from "./components/SourcesRail";
import type { ChatMessage, FeedbackRating } from "./model";
import { useClarifyDraft, type ClarifyDraftKey } from "./useClarifyDraft";
import { useChatSession } from "./useChatSession";
import type { InitialTurn } from "./AiChatRoute";

const EMPTY_SKILL_MODES = [] as const;

export type AiChatPageProps = {
  sessionId: string;
  initialTurn?: InitialTurn | null;
  onInitialTurnConsumed?: () => void;
  /** Compatibility for callers created before structured initial turns. */
  initialPrompt?: string | null;
  onInitialPromptConsumed?: () => void;
  /** Injectable for tests; defaults to the real `chatTransport` singleton
   *  inside `useChatSession`. */
  transport?: ChatTransport;
};

function documentTitleFor(title: string | null | undefined): string {
  return title !== null && title !== undefined && title.trim().length > 0
    ? `${title} · Counselle`
    : "New chat · Counselle";
}

function clarifySpecIdentity(clarify: ChatMessage["clarify"]): string {
  return JSON.stringify(clarify);
}

export function AiChatPage({
  sessionId,
  initialTurn = null,
  onInitialTurnConsumed,
  initialPrompt = null,
  onInitialPromptConsumed,
  transport,
}: AiChatPageProps) {
  const effectiveInitialTurn = useMemo(
    () =>
      initialTurn ??
      (initialPrompt !== null && initialPrompt.trim().length > 0
        ? { text: initialPrompt, skills: [], responseMode: "quick" as const }
        : null),
    [initialPrompt, initialTurn],
  );
  const consumeInitialTurn = onInitialTurnConsumed ?? onInitialPromptConsumed;
  const initialResponseMode = effectiveInitialTurn?.responseMode;
  const [composerValue, setComposerValue] = useState("");
  const [selectedModeSkill, setSelectedModeSkill] = useState<string | null>(
    null,
  );
  const [selectedTaskSkills, setSelectedTaskSkills] = useState<string[]>([]);
  const [sourcesPayload, setSourcesPayload] =
    useState<MessageSourcesPayload | null>(null);
  const consumedInitialTurnRef = useRef(false);
  const clarifySubmitInFlightRef = useRef<string | null>(null);
  const hydratedModeRef = useRef(false);
  const modeTouchedRef = useRef(false);
  const isMobile = useIsMobile();
  const feedback = useMessageFeedback();
  const configQuery = useChatConfig();
  const skillConfig = configQuery.config;
  const skillModes = useMemo(
    () => skillConfig?.skillModes ?? EMPTY_SKILL_MODES,
    [skillConfig?.skillModes],
  );
  const defaultMode = skillConfig?.defaultSkillMode ?? null;
  const modeSkillNames = useMemo(
    () => skillModes.map((mode) => mode.skillName),
    [skillModes],
  );
  const selectedMode =
    findCounselingMode(skillModes, selectedModeSkill) ?? defaultMode;

  const resetScrollFollow = useCallback(() => {
    // Reactive coverage: useQuestionAnchoredScroll re-derives the anchor and
    // scroll-button state directly from `messages`/`isSubmitting` on every
    // change, so no imperative reset is required here. Kept as an explicit
    // hook so a future behavior (e.g. instantly hiding the scroll-to-bottom
    // pill the moment a send starts) has a single wire-up point.
  }, []);

  const {
    session,
    isLoading,
    transcriptError,
    retryTranscript,
    messages,
    sourceConfig,
    setSourceConfig,
    selectedResponseMode,
    setSelectedResponseMode,
    submitMessage,
    submitClarifyResponse,
    stopGenerating,
    isSubmitting,
    awaitingClarify,
    turnError,
    pendingText,
    retryLastSend,
    modelUnavailableRecovery,
    retryModelUnavailableSameMode,
    retryModelUnavailableWithQuick,
  } = useChatSession({
    sessionId,
    transport,
    onSendStart: resetScrollFollow,
    initialResponseMode,
    modeSkillNames,
  });
  const responseModes =
    skillConfig?.responseModes ?? BUILT_IN_RESPONSE_MODE_OPTIONS;
  const normalizedSelectedResponseMode = skillConfig
    ? normalizeResponseModeSelection(selectedResponseMode, {
        defaultResponseMode: skillConfig.defaultResponseMode,
        responseModes,
      }).mode
    : selectedResponseMode;
  const latestMessage = messages.at(-1);
  const clarifyDraftKey: ClarifyDraftKey =
    latestMessage?.kind === "assistant" &&
    latestMessage.turnStatus === "awaiting_input" &&
    latestMessage.clarify !== undefined
      ? {
          sessionId,
          clarifyMessageId: latestMessage.messageId,
          specVersion: latestMessage.clarify.v,
          specIdentity: clarifySpecIdentity(latestMessage.clarify),
        }
      : null;
  const clarifyDraftIdentity =
    clarifyDraftKey === null
      ? "none"
      : `${clarifyDraftKey.sessionId}:${clarifyDraftKey.clarifyMessageId}:${clarifyDraftKey.specVersion}:${clarifyDraftKey.specIdentity}`;
  const clarifyDraft = useClarifyDraft(clarifyDraftKey);

  useEffect(() => {
    clarifySubmitInFlightRef.current = null;
  }, [clarifyDraftIdentity]);

  useEffect(() => {
    document.title = documentTitleFor(session?.title);
    return () => {
      document.title = "Counselle";
    };
  }, [session?.title]);

  useEffect(() => {
    if (
      hydratedModeRef.current ||
      modeTouchedRef.current ||
      isLoading ||
      transcriptError !== null ||
      skillModes.length === 0
    ) {
      return;
    }

    hydratedModeRef.current = true;
    setSelectedModeSkill(deriveHistoricalModeSkill(messages, skillModes));
  }, [isLoading, messages, skillModes, transcriptError]);

  const handleComposerSubmit = useCallback(
    (
      text: string,
      taskSkills = selectedTaskSkills,
      modeSkill = selectedMode?.skillName,
      // A normal send snapshots the CURRENT selected next-turn mode at the
      // moment of this call -- never a later selector read once the turn is
      // in flight (plan §5.5/§8.4). The initial-turn dispatch effect below
      // passes its own captured mode explicitly here, bypassing whatever
      // `selectedResponseMode` happens to show before hydration settles.
      responseMode = normalizedSelectedResponseMode,
    ) => {
      const clarifyReplyTo =
        latestMessage?.kind === "assistant" &&
        latestMessage.turnStatus === "awaiting_input" &&
        latestMessage.clarify !== undefined
          ? latestMessage.messageId
          : undefined;
      const submittedTaskSkills =
        clarifyReplyTo === undefined ? [...taskSkills] : [];
      const submittedMode =
        clarifyReplyTo !== undefined &&
        latestMessage?.kind === "assistant" &&
        latestMessage.responseMode.supported
          ? latestMessage.responseMode.mode
          : responseMode;
      setComposerValue("");
      if (clarifyReplyTo === undefined) {
        setSelectedTaskSkills([]);
      }
      void submitMessage({
        text,
        modeSkill: clarifyReplyTo === undefined ? modeSkill : undefined,
        taskSkills: submittedTaskSkills,
        executionResponseMode: submittedMode,
        clarifyReplyTo,
      }).then((result) => {
        if (!result.ok) {
          setComposerValue(result.keepText);
          if (clarifyReplyTo === undefined) {
            setSelectedTaskSkills(submittedTaskSkills);
          }
        }
      });
    },
    [
      latestMessage,
      normalizedSelectedResponseMode,
      selectedMode?.skillName,
      selectedTaskSkills,
      submitMessage,
    ],
  );

  const handleClarifyAnswer = useCallback(
    (answer: ClarifyWidgetAnswer) => {
      if (!clarifyDraft.canSubmit) {
        return;
      }
      // A clarify answer continues the ORIGINAL turn's mode, not whatever
      // the next-turn selector shows now (plan §1 rule 4). The engine omits
      // `response_mode` from the wire body itself once it detects this is a
      // parked continuation, regardless of what's passed here; this local
      // value only drives the optimistic display until `meta` replays it.
      const tail = messages.at(-1);
      const parkedMode =
        tail?.kind === "assistant" && tail.responseMode.supported
          ? tail.responseMode.mode
          : "quick";
      clarifyDraft.markSending();
      const inReplyTo = tail?.kind === "assistant" ? tail.messageId : undefined;
      if (inReplyTo === undefined) {
        clarifyDraft.markChecking();
        return;
      }
      if (clarifySubmitInFlightRef.current === inReplyTo) {
        return;
      }
      clarifySubmitInFlightRef.current = inReplyTo;
      void submitClarifyResponse({
        inReplyTo,
        response: answer.response,
        executionResponseMode: parkedMode,
      }).then((result) => {
        if (result.ok) {
          clarifyDraft.markAnswered();
        } else {
          clarifySubmitInFlightRef.current = null;
          clarifyDraft.markChecking();
        }
      });
    },
    [clarifyDraft, messages, submitClarifyResponse],
  );

  useEffect(() => {
    if (
      effectiveInitialTurn === null ||
      consumedInitialTurnRef.current ||
      isLoading ||
      transcriptError !== null
    ) {
      return;
    }

    consumedInitialTurnRef.current = true;
    consumeInitialTurn?.();
    const split = splitSelectedSkills(effectiveInitialTurn.skills, skillModes);
    const initialModeSkill = split.modeSkill ?? defaultMode?.skillName;
    setSelectedModeSkill(initialModeSkill ?? null);
    setSelectedTaskSkills([]);
    // Must use the captured initial-turn mode explicitly -- not the
    // default-parameter read of `selectedResponseMode`, which can still be
    // the pre-hydration fallback at this point (plan §8.3).
    handleComposerSubmit(
      effectiveInitialTurn.text,
      split.taskSkills,
      initialModeSkill,
      effectiveInitialTurn.responseMode,
    );
  }, [
    defaultMode?.skillName,
    handleComposerSubmit,
    effectiveInitialTurn,
    isLoading,
    consumeInitialTurn,
    skillModes,
    transcriptError,
  ]);

  const handleRegenerate = useCallback(
    (message: ChatMessage) => {
      if (message.kind !== "assistant") {
        return;
      }
      // Regenerate replays the ORIGINAL assistant answer's execution mode,
      // never the chat's current next-turn selector, and never mutates
      // stickiness (plan §1 rule 6). A present-but-unsupported historical
      // mode can't regenerate (plan §8.4) rather than silently falling back
      // to Quick.
      if (!message.responseMode.supported) {
        return;
      }
      const parent = messages.find(
        (entry) => entry.messageId === message.parentMessageId,
      );
      if (parent === undefined || parent.kind !== "user") {
        return;
      }
      const split = splitSelectedSkills(parent.skills ?? [], skillModes);
      setSelectedModeSkill(split.modeSkill ?? defaultMode?.skillName ?? null);
      setSelectedTaskSkills([]);
      void submitMessage({
        text: parent.text,
        skills: parent.skills,
        executionResponseMode: message.responseMode.mode,
        replaceMessageId: parent.messageId,
      });
    },
    [defaultMode?.skillName, messages, skillModes, submitMessage],
  );

  const handleFeedback = useCallback(
    (message: ChatMessage, rating: FeedbackRating) => {
      if (message.kind !== "assistant" || message.hasBackendId !== true) {
        return;
      }
      const nextRating = message.feedback?.rating === rating ? null : rating;
      feedback.mutate({
        sessionId,
        messageId: message.messageId,
        rating:
          nextRating === null
            ? null
            : nextRating === "thumbsUp"
              ? "up"
              : "down",
      });
    },
    [feedback, sessionId],
  );

  const openSources = useCallback((payload: MessageSourcesPayload) => {
    setSourcesPayload(payload);
  }, []);

  const closeSources = useCallback(() => setSourcesPayload(null), []);

  if (isLoading) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center">
        <p className="text-sm text-muted-foreground">Loading conversation...</p>
      </main>
    );
  }

  if (transcriptError !== null) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center px-4">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <p className="text-sm text-muted-foreground">
            {transcriptError.message}
          </p>
          <button
            className="rounded-lg border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-accent"
            onClick={() => void retryTranscript()}
            type="button"
          >
            Retry
          </button>
        </div>
      </main>
    );
  }

  const railOpen = !isMobile && sourcesPayload !== null;

  return (
    <main className="flex min-h-0 flex-1 md:bg-sidebar">
      <div
        className={cn(
          "flex min-h-0 min-w-0 flex-1 flex-col bg-background",
          railOpen && "md:overflow-hidden md:rounded-r-xl",
        )}
      >
        <ChatMessages
          clarifyDraft={clarifyDraft}
          isSubmitting={isSubmitting}
          messages={messages}
          modeSkillNames={modeSkillNames}
          skillLabelForName={(name) =>
            skillConfig?.skills.find((skill) => skill.name === name)
              ?.displayName
          }
          onClarifyAnswer={handleClarifyAnswer}
          onFeedback={handleFeedback}
          onOpenSources={openSources}
          onRegenerate={handleRegenerate}
          sessionId={sessionId}
        />
        <div className="mx-auto w-full max-w-3xl px-4 pb-4">
          {modelUnavailableRecovery !== null && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
              <span>
                {modelUnavailableRecovery.failedResponseMode === "think"
                  ? "Think is temporarily unavailable. Try again, or switch to Quick."
                  : "That response failed. Try again."}
              </span>
              <div className="flex shrink-0 items-center gap-3">
                <button
                  className="font-medium underline"
                  onClick={retryModelUnavailableSameMode}
                  type="button"
                >
                  {modelUnavailableRecovery.failedResponseMode === "think"
                    ? "Retry Think"
                    : "Retry"}
                </button>
                {modelUnavailableRecovery.failedResponseMode === "think" && (
                  <button
                    className="font-medium underline"
                    onClick={retryModelUnavailableWithQuick}
                    type="button"
                  >
                    Retry with Quick
                  </button>
                )}
              </div>
            </div>
          )}
          {turnError !== null && (
            <div className="mb-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
              <span>{turnError.message}</span>
              {pendingText !== null && (
                <button
                  className="shrink-0 font-medium underline"
                  onClick={retryLastSend}
                  type="button"
                >
                  Retry
                </button>
              )}
            </div>
          )}
          <ChatComposer
            awaitingClarify={awaitingClarify}
            isSubmitting={isSubmitting}
            onStop={stopGenerating}
            onResponseModeChange={setSelectedResponseMode}
            onSourceConfigChange={setSourceConfig}
            onModeChange={(mode) => {
              modeTouchedRef.current = true;
              setSelectedModeSkill(mode.skillName);
            }}
            onSelectedSkillsChange={setSelectedTaskSkills}
            onSubmit={handleComposerSubmit}
            onValueChange={setComposerValue}
            maxSelectedSkills={skillConfig?.maxSelectedSkills ?? 0}
            mode={selectedMode}
            modes={skillModes}
            selectedSkills={selectedTaskSkills}
            skills={skillConfig?.skills ?? []}
            sourceConfig={sourceConfig}
            responseMode={normalizedSelectedResponseMode}
            responseModes={responseModes}
            value={composerValue}
          />
        </div>
      </div>
      <SourcesRail
        isMobile={isMobile}
        onClose={closeSources}
        payload={sourcesPayload}
      />
    </main>
  );
}
