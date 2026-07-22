import {
  CheckIcon,
  CopyIcon,
  RotateCcwIcon,
  ThumbsDownIcon,
  ThumbsUpIcon,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState } from "react";

import {
  Message,
  MessageAction,
  MessageActions,
  MessageContent,
} from "@/components/ai-elements/message";
import { cn } from "@/lib/utils";
import type {
  ClarifyResponseV2,
  ClarifyQuestionV2,
  ClarifySpec,
  ClarifySpecV1,
  ClarifySpecV2,
  SourceFocus,
  WidgetClarifyResponseV2,
} from "@/api/chat/types";

import { schoolDomainsFromBlocks } from "../citations";
import type { Segment } from "../turn-reducer";
import {
  NarrationBeat,
  PlanChecklist,
  ThinkingBeat,
  ToolStepBeat,
} from "./AgentRunView";
import { isLiveStatus, latestPlanStep } from "./activity-trace-helpers";
import { CitationRenderer } from "./CitationRenderer";
import { ClarifyWidget, type ClarifyWidgetAnswer } from "./ClarifyWidget";
import { MessageSources, type MessageSourcesPayload } from "./MessageSources";
import { VizBlock } from "./VizBlock";
import type { ClarifyDraftController } from "../useClarifyDraft";
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
  onOpenCitation?: (focus: SourceFocus) => void;
  onClarifyAnswer?: (answer: ClarifyWidgetAnswer) => void;
  clarifyDraft?: ClarifyDraftController;
  isLatestMessage?: boolean;
  skillLabelForName?: (name: string) => string | undefined;
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
    <MessageAction
      label={label}
      onClick={() => void handleCopy()}
      tooltip={label}
    >
      {copied ? (
        <CheckIcon className="size-3.5" />
      ) : (
        <CopyIcon className="size-3.5" />
      )}
    </MessageAction>
  );
}

function assertNeverSegment(segment: never): never {
  throw new Error(`Unhandled segment type: ${JSON.stringify(segment)}`);
}

function isLegacyClarifySpec(spec: ClarifySpec): spec is ClarifySpecV1 {
  return spec.v === 1 && "options" in spec;
}

function isCurrentClarifySpec(spec: ClarifySpec): spec is ClarifySpecV2 {
  return spec.v === 2 && "questions" in spec;
}

function clarifyAnswerSummary(
  spec: ClarifySpecV2,
  response: ClarifyResponseV2 | null,
): string | null {
  if (response === null) return null;
  if (response.mode === "reply") return response.text;

  const questionById = new Map(
    spec.questions.map((question) => [question.id, question]),
  );
  const lines = response.answers.flatMap((answer) => {
    const question = questionById.get(answer.question_id);
    if (question === undefined) return [];
    const optionLabels = answer.option_ids.map(
      (id) => question.options.find((option) => option.id === id)?.label ?? id,
    );
    const text = [...optionLabels, answer.custom_text]
      .filter((value): value is string => value !== undefined && value !== null)
      .filter((value) => value.trim().length > 0)
      .join(", ");
    return text.trim().length > 0 ? [text] : [];
  });
  return lines.length > 0 ? lines.join("; ") : null;
}

function ClarifySegmentView({
  draft,
  frozen,
  onAnswer,
  response,
  spec,
}: {
  spec: ClarifySpec;
  response: ClarifyResponseV2 | null;
  frozen: boolean;
  draft?: ClarifyDraftController;
  onAnswer?: (answer: ClarifyWidgetAnswer) => void;
}) {
  if (isLegacyClarifySpec(spec)) {
    return null;
  }

  if (!isCurrentClarifySpec(spec)) {
    return (
      <div className="not-prose rounded-lg border px-3 py-2 text-sm text-muted-foreground">
        Clarifying question from a newer client version.
      </div>
    );
  }

  const answer = clarifyAnswerSummary(spec, response);
  const activeIndex = Math.min(
    draft?.draft.currentQuestionIndex ?? 0,
    Math.max(0, spec.questions.length - 1),
  );
  const activeQuestion = spec.questions[activeIndex];
  const canAnswer =
    !frozen &&
    response === null &&
    draft !== undefined &&
    onAnswer !== undefined &&
    activeQuestion !== undefined;
  const selected = draft?.draft.selectedOptionIds ?? [];
  const customText = draft?.draft.customText ?? "";
  const validationError = draft?.draft.validationError ?? null;
  const sendState = draft?.draft.sendState ?? "idle";

  const toggleOption = (question: ClarifyQuestionV2, optionId: string) => {
    if (!canAnswer) {
      return;
    }
    if (question.selection === "single") {
      draft.setSelectedOptionIds([optionId]);
      return;
    }
    draft.setSelectedOptionIds(
      selected.includes(optionId)
        ? selected.filter((id) => id !== optionId)
        : [...selected, optionId],
    );
  };

  const submitAnswer = () => {
    if (!canAnswer) {
      return;
    }
    const trimmedCustomText = customText.trim();
    if (selected.length === 0 && trimmedCustomText.length === 0) {
      draft.setValidationError("Choose an option or type an answer.");
      return;
    }
    const optionLabels = activeQuestion.options
      .filter((option) => selected.includes(option.id))
      .map((option) => option.label);
    const text = [...optionLabels, trimmedCustomText]
      .filter((value) => value.length > 0)
      .join(", ");
    const responsePayload: WidgetClarifyResponseV2 = {
      v: 2,
      mode: "widget",
      answers: [
        {
          question_id: activeQuestion.id,
          option_ids: selected,
          ...(trimmedCustomText.length > 0
            ? { custom_text: trimmedCustomText }
            : {}),
        },
      ],
    };
    onAnswer({ origin: "widget", text, response: responsePayload });
  };

  return (
    <div className="not-prose my-3 rounded-lg border bg-card px-3 py-2 text-sm">
      <div className="space-y-2">
        {canAnswer && activeQuestion !== undefined ? (
          <div key={activeQuestion.id}>
            <p className="font-medium text-foreground">
              {activeQuestion.question}
            </p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {activeQuestion.options.map((option) => (
                <button
                  aria-pressed={selected.includes(option.id)}
                  className={cn(
                    "flex min-h-11 w-full flex-col items-start justify-center rounded-xl border px-3 py-2 text-left sm:w-auto",
                    "hover:bg-accent",
                    selected.includes(option.id) && "border-primary bg-accent",
                  )}
                  key={option.id}
                  onClick={() => toggleOption(activeQuestion, option.id)}
                  type="button"
                >
                  <span className="text-sm font-medium text-foreground">
                    {option.label}
                  </span>
                  {option.hint !== undefined &&
                    option.hint !== null &&
                    option.hint.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {option.hint}
                      </span>
                    )}
                </button>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                aria-label="Your answer"
                className="min-h-11 flex-1 rounded-xl border bg-transparent px-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
                maxLength={280}
                onChange={(event) => draft.setCustomText(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    submitAnswer();
                  }
                }}
                placeholder="Type your own answer"
                type="text"
                value={customText}
              />
              <button
                className="min-h-11 rounded-xl border px-3 text-sm font-medium text-foreground hover:bg-accent disabled:opacity-50"
                disabled={!draft.canSubmit || sendState === "answered"}
                onClick={submitAnswer}
                type="button"
              >
                Send
              </button>
            </div>
            {validationError !== null && (
              <p className="mt-2 text-xs text-destructive">
                {validationError}
              </p>
            )}
          </div>
        ) : (
          spec.questions.map((question) => (
            <div key={question.id}>
              <p className="font-medium text-foreground">
                {question.question}
              </p>
            </div>
          ))
        )}
      </div>
      {answer !== null && (
        <p className="mt-2 text-muted-foreground">
          <span className="font-medium text-foreground">Answer:</span> {answer}
        </p>
      )}
    </div>
  );
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
    case "clarify":
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
  clarifyDraft,
  clarifyFrozen,
  isLiveSegment,
  segment,
  sources,
  onClarifyAnswer,
  onOpenCitation,
  schoolDomains,
}: {
  clarifyDraft?: ClarifyDraftController;
  clarifyFrozen: boolean;
  isLiveSegment: boolean;
  segment: Segment;
  sources: AssistantChatMessage["sources"];
  onClarifyAnswer?: (answer: ClarifyWidgetAnswer) => void;
  onOpenCitation?: (focus: SourceFocus) => void;
  schoolDomains: Map<number, string>;
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
        <ThinkingBeat
          id={segment.id}
          isLive={isLiveSegment}
          text={segment.text}
        />
      );
    case "user":
      return (
        <Message from="user" className="not-prose max-w-full py-1">
          <MessageContent className="max-w-[80%]">
            <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
              {segment.text}
            </p>
          </MessageContent>
        </Message>
      );
    case "tool":
      return segment.step.kind === "write_plan" ? null : (
        <ToolStepBeat isLiveSegment={isLiveSegment} step={segment.step} />
      );
    case "answer":
      return segment.text.length === 0 ? null : (
        <div>
          <CitationRenderer
            markdown={segment.text}
            onCitationOpen={onOpenCitation}
            schoolDomains={schoolDomains}
            sources={sources}
          />
          {isLiveSegment && <StreamingCursor />}
        </div>
      );
    case "viz":
      return <VizBlock onSourceOpen={onOpenCitation} spec={segment.spec} />;
    case "clarify":
      return (
        <ClarifySegmentView
          draft={clarifyDraft}
          frozen={clarifyFrozen}
          onAnswer={onClarifyAnswer}
          response={segment.response}
          spec={segment.spec}
        />
      );
    default:
      assertNeverSegment(segment);
  }
}

function AssistantBody({
  clarifyDraft,
  message,
  onClarifyAnswer,
  onOpenCitation,
  clarifyFrozen,
}: {
  clarifyDraft?: ClarifyDraftController;
  message: AssistantChatMessage;
  onClarifyAnswer?: (answer: ClarifyWidgetAnswer) => void;
  onOpenCitation?: (focus: SourceFocus) => void;
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
  const planStep = latestPlanStep(message.segments);
  const schoolDomains = useMemo(
    () => schoolDomainsFromBlocks(message.blocks),
    [message],
  );

  return (
    <>
      {planStep !== null && (
        <PlanChecklist isLive={hasLiveSegment} step={planStep} />
      )}
      {showEmptyLiveThinking && (
        <ThinkingBeat id={`${message.messageId}-empty-live`} isLive text="" />
      )}
      {message.segments.map((segment, index) => (
        <SegmentBeat
          clarifyDraft={clarifyDraft}
          clarifyFrozen={clarifyFrozen}
          isLiveSegment={
            segment.type === "answer"
              ? index === liveAnswerIndex
              : segment.type === "tool"
                ? hasLiveSegment && segment.step.status === "start"
                : hasLiveSegment && index === message.segments.length - 1
          }
          key={segmentKey(segment, index)}
          onClarifyAnswer={onClarifyAnswer}
          onOpenCitation={onOpenCitation}
          schoolDomains={schoolDomains}
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
      {message.clarify !== undefined && isLegacyClarifySpec(message.clarify) && (
        <ClarifyWidget
          answer={message.clarifyAnswer}
          frozen={clarifyFrozen}
          onAnswer={(answer) => onClarifyAnswer?.(answer)}
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
  clarifyDraft,
  isLatestMessage = false,
  skillLabelForName,
}: ChatMessageProps) {
  if (message.kind === "user") {
    const skills = message.skills ?? [];
    return (
      <Message from="user" id={message.messageId}>
        <MessageContent>
          <p className="whitespace-pre-wrap [overflow-wrap:anywhere]">
            {message.text}
          </p>
          {skills.length > 0 && (
            <div
              aria-label="Invoked skills"
              className="mt-2 flex flex-wrap gap-1"
              role="list"
            >
              {skills.map((name) => (
                <span
                  className="rounded-md bg-secondary px-2 py-1 text-xs text-secondary-foreground"
                  key={name}
                  role="listitem"
                >
                  {skillLabelForName?.(name) ?? name.replaceAll("-", " ")}
                </span>
              ))}
            </div>
          )}
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
          clarifyDraft={clarifyDraft}
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
          <CopyAction
            answerText={message.text}
            runMarkdown={message.runMarkdown}
          />
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
            <MessageAction
              label="Regenerate"
              onClick={onRegenerate}
              tooltip="Regenerate"
            >
              <RotateCcwIcon className="size-3.5" />
            </MessageAction>
          )}
        </MessageActions>
      )}
    </Message>
  );
}

export const ChatMessage = memo(ChatMessageComponent);
