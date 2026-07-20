import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useMessageFeedback } from "@/api/chat/hooks";
import { useChatConfig } from "@/api/chat/config";
import type { ChatTransport } from "@/api/chat/types";
import { useIsMobile } from "@/hooks/use-mobile";

import { ChatComposer } from "./components/ChatComposer";
import { ChatMessages } from "./components/ChatMessages";
import type { MessageSourcesPayload } from "./components/MessageSources";
import { SourcesRail } from "./components/SourcesRail";
import type { ChatMessage, FeedbackRating } from "./model";
import { useChatSession } from "./useChatSession";
import type { InitialTurn } from "./AiChatRoute";

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
        ? { text: initialPrompt, skills: [] }
        : null),
    [initialPrompt, initialTurn],
  );
  const consumeInitialTurn = onInitialTurnConsumed ?? onInitialPromptConsumed;
  const [composerValue, setComposerValue] = useState("");
  const [selectedSkills, setSelectedSkills] = useState<string[]>([]);
  const [sourcesPayload, setSourcesPayload] =
    useState<MessageSourcesPayload | null>(null);
  const consumedInitialTurnRef = useRef(false);
  const isMobile = useIsMobile();
  const feedback = useMessageFeedback();
  const configQuery = useChatConfig();
  const skillConfig = configQuery.config;

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
    submitMessage,
    stopGenerating,
    isSubmitting,
    awaitingClarify,
    turnError,
    pendingText,
    retryLastSend,
  } = useChatSession({ sessionId, transport, onSendStart: resetScrollFollow });

  useEffect(() => {
    document.title = documentTitleFor(session?.title);
    return () => {
      document.title = "Counselle";
    };
  }, [session?.title]);

  const handleComposerSubmit = useCallback(
    (text: string, skills = selectedSkills) => {
      const submittedSkills = [...skills];
      setComposerValue("");
      setSelectedSkills([]);
      void submitMessage(text, submittedSkills).then((result) => {
        if (!result.ok) {
          setComposerValue(result.keepText);
          setSelectedSkills(submittedSkills);
        }
      });
    },
    [selectedSkills, submitMessage],
  );

  const handleClarifyAnswer = useCallback(
    (text: string) => {
      void submitMessage(text, []);
    },
    [submitMessage],
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
    handleComposerSubmit(
      effectiveInitialTurn.text,
      effectiveInitialTurn.skills,
    );
  }, [
    handleComposerSubmit,
    effectiveInitialTurn,
    isLoading,
    consumeInitialTurn,
    transcriptError,
  ]);

  const handleRegenerate = useCallback(
    (message: ChatMessage) => {
      if (message.kind !== "assistant") {
        return;
      }
      const parent = messages.find(
        (entry) => entry.messageId === message.parentMessageId,
      );
      if (parent === undefined || parent.kind !== "user") {
        return;
      }
      void submitMessage(parent.text, parent.skills, parent.messageId);
    },
    [messages, submitMessage],
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

  return (
    <main className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <ChatMessages
          isSubmitting={isSubmitting}
          messages={messages}
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
            onSourceConfigChange={setSourceConfig}
            onSelectedSkillsChange={setSelectedSkills}
            onSubmit={handleComposerSubmit}
            onValueChange={setComposerValue}
            maxSelectedSkills={skillConfig?.maxSelectedSkills ?? 0}
            selectedSkills={selectedSkills}
            skills={skillConfig?.skills ?? []}
            sourceConfig={sourceConfig}
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
