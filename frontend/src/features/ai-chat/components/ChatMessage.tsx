import { CheckIcon, CopyIcon, RotateCcwIcon, ThumbsDownIcon, ThumbsUpIcon } from "lucide-react";
import { memo, useEffect, useRef, useState } from "react";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";

import type { Segment } from "../turn-reducer";
import { NarrationBeat, ThinkingBeat, ToolStepBeat } from "./AgentRunView";
import { isLiveStatus } from "./activity-trace-helpers";
import { CitationRenderer } from "./CitationRenderer";
import { ClarifyWidget } from "./ClarifyWidget";
import { MessageSources, type MessageSourcesPayload } from "./MessageSources";
import { VizBlock } from "./VizBlock";
import type {
  AssistantChatMessage,
  ChatMessage as ChatMessageModel,
  FeedbackRating,
} from "../model";

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

const COPY_FEEDBACK_MS = 1500;

function StreamingCursor() {
  return (
    <span
      aria-hidden="true"
      className="ml-0.5 inline-block h-4 w-[0.55ch] animate-pulse rounded-sm bg-foreground align-[-0.15em]"
      data-testid="streaming-cursor"
    />
  );
}

function CopyAction({
  answerText,
  runMarkdown,
}: {
  answerText: string;
  runMarkdown: string;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const timeoutRef = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timeoutRef.current), []);

  const handleCopy = async () => {
    window.clearTimeout(timeoutRef.current);

    const text = runMarkdown.trim() === "" ? answerText : runMarkdown;
    const writeText =
      typeof navigator === "undefined"
        ? undefined
        : navigator.clipboard?.writeText;

    if (text.trim() === "" || writeText === undefined) {
      setCopied(false);
      setCopyFailed(true);
    } else {
      try {
        await writeText.call(navigator.clipboard, text);
        setCopied(true);
        setCopyFailed(false);
      } catch {
        setCopied(false);
        setCopyFailed(true);
      }
    }

    timeoutRef.current = window.setTimeout(() => {
      setCopied(false);
      setCopyFailed(false);
    }, COPY_FEEDBACK_MS);
  };

  const label = copied ? "Copied" : copyFailed ? "Copy failed" : "Copy";

  return (
    <MessageAction label={label} onClick={() => void handleCopy()} tooltip={label}>
      {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
    </MessageAction>
  );
}

function assertNeverSegment(segment: never): never {
  throw new Error(`Unhandled segment type: ${JSON.stringify(segment)}`);
}

/** A stable React key by segment identity, not position — `narration`/
 * `thinking` carry their own `id`, `tool` carries `step_id`; only `answer`/
 * `viz` (which never reorder relative to each other) fall back to index. */
function segmentKey(segment: Segment, index: number): string {
  switch (segment.type) {
    case "narration":
    case "thinking":
      return segment.id;
    case "user":
      return `user-${segment.id}`;
    case "tool":
      return `tool-${segment.step.step_id}`;
    case "answer":
    case "viz":
      return `${segment.type}-${index}`;
    default:
      return assertNeverSegment(segment);
  }
}

/** One chronological beat: narration prose, a tool call, a collapsed
 * thinking line, the answer's cited prose, or an inline viz card — rendered
 * in stream order (the Claude-Code-style surface, not a two-zone drawer).
 * `write_plan` tool segments are suppressed here; the pinned `PlanChecklist`
 * above the stream renders the latest one instead. */
function SegmentBeat({
  isLiveSegment,
  segment,
  sources,
  onOpenCitation,
}: {
  isLiveSegment: boolean;
  segment: Segment;
  sources: AssistantChatMessage["sources"];
  onOpenCitation?: (index: number) => void;
}) {
  switch (segment.type) {
    case "narration":
      return (
        <NarrationBeat
          onCitationOpen={onOpenCitation}
          sources={sources}
          text={segment.text}
        />
      );
    case "thinking":
      return (
        <ThinkingBeat id={segment.id} isLive={isLiveSegment} text={segment.text} />
      );
    case "user":
      return (
        <Message from="user" className="not-prose max-w-full py-1">
          <MessageContent className="max-w-[80%]">
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">{segment.text}</p>
          </MessageContent>
        </Message>
      );
    case "tool":
      return <ToolStepBeat step={segment.step} />;
    case "answer":
      return segment.text.length === 0 ? null : (
        <div>
          <CitationRenderer
            markdown={segment.text}
            onCitationOpen={onOpenCitation}
            sources={sources}
          />
          {isLiveSegment && <StreamingCursor />}
        </div>
      );
    case "viz":
      return <VizBlock spec={segment.spec} />;
    default:
      assertNeverSegment(segment);
  }
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
  const showEmptyLiveThinking =
    message.segments.length === 0 &&
    message.turnStatus !== undefined &&
    isLiveStatus(message.turnStatus);
  const hasLiveSegment =
    message.turnStatus !== undefined && isLiveStatus(message.turnStatus);
  const liveAnswerIndex = hasLiveSegment
    ? message.segments.findLastIndex(
        (segment) => segment.type === "answer" && segment.text.length > 0,
      )
    : -1;

  return (
    <>
      {showEmptyLiveThinking && (
        <ThinkingBeat id={`${message.messageId}-empty-live`} isLive text="" />
      )}
      {message.segments.map((segment, index) => (
        <SegmentBeat
          isLiveSegment={
            segment.type === "answer"
              ? index === liveAnswerIndex
              : hasLiveSegment && index === message.segments.length - 1
          }
          key={segmentKey(segment, index)}
          onOpenCitation={onOpenCitation}
          segment={segment}
          sources={message.sources}
        />
      ))}
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

function ChatMessageComponent({
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
          <CopyAction answerText={message.text} runMarkdown={message.runMarkdown} />
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

export const ChatMessage = memo(ChatMessageComponent);
