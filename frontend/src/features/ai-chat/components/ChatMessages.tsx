import { ArrowDownIcon, MessageCircleIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

import { ChatMessage } from "./ChatMessage";
import type { MessageSourcesPayload, SourceFocus } from "@/api/chat/types";
import { sourcesPayloadFor } from "../citations";
import type { ChatMessage as ChatMessageModel, FeedbackRating } from "../model";
import { useQuestionAnchoredScroll } from "../useQuestionAnchoredScroll";

export type ChatMessagesProps = {
  sessionId: string;
  messages: ChatMessageModel[];
  isSubmitting: boolean;
  onRegenerate?: (message: ChatMessageModel) => void;
  onFeedback?: (message: ChatMessageModel, rating: FeedbackRating) => void;
  onOpenSources?: (payload: MessageSourcesPayload) => void;
  onClarifyAnswer?: (text: string) => void;
  skillLabelForName?: (name: string) => string | undefined;
  modeSkillNames?: readonly string[];
};

/**
 * ChatMessages — the flat message list. Deliberately does NOT use AI
 * Elements' `Conversation`/`ConversationContent` (built on
 * `use-stick-to-bottom`, which always chases the bottom): old Counselle
 * behavior anchors a newly-sent question near the top of the viewport
 * instead, via `useQuestionAnchoredScroll`. See the plan's rejection note.
 */
export function ChatMessages({
  sessionId,
  messages,
  isSubmitting,
  onRegenerate,
  onFeedback,
  onOpenSources,
  onClarifyAnswer,
  skillLabelForName,
  modeSkillNames = [],
}: ChatMessagesProps) {
  const {
    scrollableRef,
    contentRef,
    messagesEndRef,
    showScrollButton,
    scrollToBottom,
    onScroll,
  } = useQuestionAnchoredScroll({ sessionId, messages, isSubmitting });

  const lastAssistantIndex = [...messages]
    .map((message, index) => ({ message, index }))
    .reverse()
    .find(({ message }) => message.kind === "assistant")?.index;
  const latestMessageIndex = messages.length - 1;

  if (messages.length === 0) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-3 p-8 text-center text-muted-foreground">
        <MessageCircleIcon aria-hidden="true" className="size-8" />
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium text-foreground">
            No messages yet
          </h2>
          <p className="text-sm">Ask a question to start this conversation.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        className="min-h-0 flex-1 overflow-y-auto"
        onScroll={onScroll}
        ref={scrollableRef}
        role="log"
      >
        <div
          className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-6"
          ref={contentRef}
        >
          {messages.map((message, index) => (
            <ChatMessage
              canRegenerate={
                message.kind === "assistant" &&
                index === lastAssistantIndex &&
                !isSubmitting &&
                message.hasBackendId === true
              }
              key={message.messageId}
              isLatestMessage={index === latestMessageIndex}
              message={message}
              onClarifyAnswer={onClarifyAnswer}
              onFeedback={
                message.kind === "assistant" && onFeedback !== undefined
                  ? (rating) => onFeedback(message, rating)
                  : undefined
              }
              onOpenSources={onOpenSources}
              onOpenCitation={
                message.kind === "assistant" && onOpenSources !== undefined
                  ? (focus: SourceFocus) => {
                      const payload = sourcesPayloadFor(message, focus);
                      if (payload !== null) {
                        onOpenSources(payload);
                      }
                    }
                  : undefined
              }
              onRegenerate={
                onRegenerate !== undefined
                  ? () => onRegenerate(message)
                  : undefined
              }
              skillLabelForName={skillLabelForName}
              modeSkillNames={modeSkillNames}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </div>
      {showScrollButton && (
        <Button
          aria-label="Scroll to latest message"
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full"
          onClick={scrollToBottom}
          size="icon"
          type="button"
          variant="outline"
        >
          <ArrowDownIcon data-icon="inline-start" />
        </Button>
      )}
    </div>
  );
}
