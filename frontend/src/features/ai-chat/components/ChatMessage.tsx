import { CheckIcon, CopyIcon, RotateCcwIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { useState } from "react";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";

import { ActivityTrace } from "./ActivityTrace";
import { CitationRenderer } from "./CitationRenderer";
import { ClarifyWidget } from "./ClarifyWidget";
import { MessageSources, type MessageSourcesPayload } from "./MessageSources";
import { VizBlock } from "./VizBlock";
import type { AssistantChatMessage, ChatMessage as ChatMessageModel, FeedbackRating } from "../model";

export type ChatMessageProps = {
  message: ChatMessageModel;
  /** True only for the single most-recent assistant message with a settled
   *  turn — regenerate only ever targets the last answer, matching old
   *  behavior (no per-message branch tree). */
  canRegenerate?: boolean;
  onRegenerate?: () => void;
  onFeedback?: (rating: FeedbackRating) => void;
  onOpenSources?: (payload: MessageSourcesPayload) => void;
  onOpenCitation?: (index: number) => void;
  onClarifyAnswer?: (text: string) => void;
  isLatestMessage?: boolean;
};

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <MessageAction label="Copy" onClick={handleCopy} tooltip="Copy">
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </MessageAction>
  );
}

function AssistantBody({
  message,
  onClarifyAnswer,
  onOpenCitation,
  clarifyFrozen,
}: {
  message: AssistantChatMessage;
  onClarifyAnswer?: (text: string) => void;
  onOpenCitation?: (index: number) => void;
  clarifyFrozen: boolean;
}) {
  return (
    <>
      {message.timeline !== undefined && message.timeline.length > 0 && (
        <ActivityTrace
          activities={message.activities}
          durationMs={message.durationMs}
          status={message.turnStatus ?? "complete"}
          timeline={message.timeline}
        />
      )}
      {message.blocks.map((block, index) =>
        block.kind === "markdown" ? (
          <CitationRenderer
            key={`md-${index}`}
            markdown={block.text}
            onCitationOpen={onOpenCitation}
            sources={message.sources}
          />
        ) : (
          <VizBlock key={`viz-${index}`} spec={block.spec} />
        ),
      )}
      {message.turnStatus === "cancelled" && (
        <p className="not-prose text-sm text-muted-foreground italic">
          You stopped this response.
        </p>
      )}
      {message.streamError !== undefined && (
        <p className="not-prose rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
          {message.streamError.message}
        </p>
      )}
      {message.clarify !== undefined && (
        <ClarifyWidget
          answer={message.clarifyAnswer}
          frozen={clarifyFrozen}
          onAnswer={(text) => onClarifyAnswer?.(text)}
          spec={message.clarify}
        />
      )}
    </>
  );
}

export function ChatMessage({
  message,
  canRegenerate = false,
  onRegenerate,
  onFeedback,
  onOpenSources,
  onOpenCitation,
  onClarifyAnswer,
  isLatestMessage = false,
}: ChatMessageProps) {
  if (message.kind === "user") {
    return (
      <Message from="user" id={message.messageId}>
        <MessageContent>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{message.text}</p>
        </MessageContent>
      </Message>
    );
  }

  const settled =
    message.turnStatus === "complete" || message.turnStatus === "cancelled";

  return (
    <Message from="assistant" id={message.messageId}>
      <MessageContent>
        <AssistantBody
          clarifyFrozen={
            !(isLatestMessage && message.turnStatus === "awaiting_input")
          }
          message={message}
          onClarifyAnswer={onClarifyAnswer}
          onOpenCitation={onOpenCitation}
        />
        {settled && <MessageSources message={message} onOpen={onOpenSources} />}
      </MessageContent>
      {settled && (
        <MessageActions>
          <CopyAction text={message.text} />
          {onFeedback !== undefined && (
            <>
              <MessageAction
                aria-pressed={message.feedback?.rating === "thumbsUp"}
                label="Good response"
                onClick={() => onFeedback("thumbsUp")}
                tooltip="Good response"
              >
                <ThumbsUpIcon
                  className={cn(
                    "size-3.5",
                    message.feedback?.rating === "thumbsUp" && "fill-current",
                  )}
                />
              </MessageAction>
              <MessageAction
                aria-pressed={message.feedback?.rating === "thumbsDown"}
                label="Bad response"
                onClick={() => onFeedback("thumbsDown")}
                tooltip="Bad response"
              >
                <ThumbsDownIcon
                  className={cn(
                    "size-3.5",
                    message.feedback?.rating === "thumbsDown" && "fill-current",
                  )}
                />
              </MessageAction>
            </>
          )}
          {canRegenerate && onRegenerate !== undefined && (
            <MessageAction label="Regenerate" onClick={onRegenerate} tooltip="Regenerate">
              <RotateCcwIcon className="size-3.5" />
            </MessageAction>
          )}
        </MessageActions>
      )}
    </Message>
  );
}
