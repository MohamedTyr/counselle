/**
 * Vendored from upstream client/src/components/Chat/Messages/Content/MessageContent.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions / rewires:
 * - `:::thinking` directive parsing dropped (thinking arrives as protocol
 *   events, rendered by the FE-4 timeline — never inline in prose)
 * - enableUserMsgMarkdown (recoil) frozen true (upstream default)
 * - ConnectionError branch dropped (their hardcoded server-error string);
 *   every error renders through ErrorMessage → Error
 * - DisplayMessage: assistant messages render the turn reducer's ordered
 *   `content` blocks — markdown blocks through <Markdown> (per-block memoized),
 *   viz blocks through the FE-3 placeholder card (FE-4 renders them properly).
 *   Reference-stable completed blocks skip re-render while the tail streams.
 * Kept byte-identical: ErrorBox/Container chrome, the submitting/result-streaming
 * cursor classes, UnfinishedMessage + DelayedRender, the edit branch.
 */
import { memo, Suspense, useCallback, useMemo } from 'react';
import { useSetAtom } from 'jotai';
import { DelayedRender } from '@librechat/client';
import type { TMessageContentProps, TDisplayProps } from '~/common';
import type { ChatMessage } from '@/app/ChatContext';
import type { SourceEntry } from '@/api/protocol';
import Error from '~/components/Messages/Content/Error';
import { useMessageContext } from '~/Providers';
// FE-4: timeline above the prose, VizCard (replaces VizPlaceholder), citations context, clarify, sources footer.
import { useChatContext } from '@/app/ChatContext';
import ReasoningTrace from '@/components/timeline/ReasoningTrace';
import ClarifyWidget from '@/components/clarify/ClarifyWidget';
import SourcesContext from '@/components/citations/SourcesContext';
// feat/message-ui-polish: the dejargon / citation-activate / reveal providers
// that the new citation grammar reads, plus the panel-open atom + helpers.
import { DejargonProvider } from '@/components/citations/dejargon';
import { CitationActivateProvider } from '@/components/citations/CitationActivateContext';
import { RevealDbProvider } from '@/components/citations/RevealDbContext';
import { useRevealState } from '@/components/citations/RevealStateContext';
import { citedSourcesForMessage } from '@/components/citations/remarkCitations';
import { dbSchoolsForMessage } from '@/components/citations/dbSchools';
import { openSourcesPanelAtom } from '@/app/state';
import VizCard from '@/components/cards/VizCard';
import MarkdownLite from './MarkdownLite';
import EditMessage from './EditMessage';
import Container from './Container';
import Markdown from './Markdown';
import { cn } from '~/utils';

const UNFINISHED_DELAY = 250;

const ErrorBox = ({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) => (
  <div
    role="alert"
    aria-live="assertive"
    className={cn(
      'rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 text-sm text-gray-600 dark:text-gray-200',
      className,
    )}
  >
    {children}
  </div>
);

export const ErrorMessage = ({
  text,
  message,
  className = '',
}: Pick<TDisplayProps, 'text' | 'className'> & {
  message?: ChatMessage;
  className?: string;
}) => {
  return (
    <Container message={message}>
      <ErrorBox className={className}>
        <Error text={text} />
      </ErrorBox>
    </Container>
  );
};

/**
 * feat/message-ui-polish: wraps the assistant answer region in the new citation
 * grammar's three contexts (dejargon on, citation-activate, reveal-db locked to
 * 'wash'). For user turns it's a pass-through — bubbles stay free of providers.
 */
function AnswerContexts({
  assistant,
  activate,
  revealed,
  children,
}: {
  assistant: boolean;
  activate: (entry: SourceEntry) => void;
  revealed: boolean;
  children: React.ReactNode;
}) {
  if (!assistant) {
    return <>{children}</>;
  }
  return (
    <DejargonProvider value={true}>
      <CitationActivateProvider value={activate}>
        <RevealDbProvider value={{ revealed, style: 'wash' }}>{children}</RevealDbProvider>
      </CitationActivateProvider>
    </DejargonProvider>
  );
}

const DisplayMessage = ({ text, isCreatedByUser, message, showCursor }: TDisplayProps) => {
  const { isSubmitting = false, isLatestMessage = false } = useMessageContext();
  // FE-4: the live clarify widget answers through the composer's submit path.
  const { submitMessage } = useChatContext();
  /** Upstream default — user messages render markdown. */
  const enableUserMsgMarkdown = true;

  const showCursorState = useMemo(
    () => showCursor === true && isSubmitting,
    [showCursor, isSubmitting],
  );

  const content = useMemo(() => {
    if (!isCreatedByUser) {
      const blocks = message.content;
      if (blocks !== undefined && blocks.length > 0) {
        return blocks.map((block, i) =>
          block.kind === 'markdown' ? (
            <Markdown key={`md-${i}`} content={block.text} isLatestMessage={isLatestMessage} />
          ) : (
            // FE-4: real viz cards replace the FE-3 placeholder.
            <VizCard key={`viz-${i}`} spec={block.spec} />
          ),
        );
      }
      // No prose yet: the ReasoningTrace header owns the live "thinking" state,
      // so suppress LibreChat's empty `result-thinking` placeholder (a pulsing
      // dot). The mockup shows only the trace header during thinking; once prose
      // streams, Markdown renders with its own end-of-text streaming caret.
      if (text.length === 0) {
        return null;
      }
      return <Markdown content={text} isLatestMessage={isLatestMessage} />;
    }
    if (enableUserMsgMarkdown) {
      return <MarkdownLite content={text} />;
    }
    return <>{text}</>;
  }, [isCreatedByUser, enableUserMsgMarkdown, text, message.content, isLatestMessage]);

  // FE-4: the clarify widget is live (interactive) only on the latest message
  // of a turn parked awaiting input — every other render is the frozen record.
  const clarifyFrozen = !(isLatestMessage && message.turnStatus === 'awaiting_input');
  const sources = message.sources ?? [];

  // feat/message-ui-polish: the per-message reveal flag (owned by MessageRender)
  // and the inline-pill activate handler. An inline pill opens the sources panel
  // jumped to its source; `cited`/`dbSchools` are computed the SAME way
  // MessageSources does (shared helpers) so the strip and the panel agree.
  const { revealed } = useRevealState();
  const openSources = useSetAtom(openSourcesPanelAtom);
  const cited = useMemo(() => citedSourcesForMessage(message), [message]);
  const dbSchools = useMemo(() => dbSchoolsForMessage(message), [message]);
  const activate = useCallback(
    (entry: SourceEntry) => openSources({ sources: cited, activeIndex: entry.index, dbSchools }),
    [openSources, cited, dbSchools],
  );

  return (
    <Container message={message}>
      {/* feat/reasoning-experience: the collapsed thinking-phase trace renders
          ABOVE the prose (PRD stories 13–16). It owns the dead-air "Thinking…"
          header too (absorbing the old ThinkingShimmer), so it mounts when the
          turn is live OR has timeline entries. */}
      {!isCreatedByUser &&
        (message.isThinking === true || (message.timeline?.length ?? 0) > 0) && (
          <ReasoningTrace
            timeline={message.timeline ?? []}
            status={message.turnStatus ?? 'complete'}
            activities={message.activities}
            durationMs={message.durationMs}
          />
        )}
      {/* FE-4: inline citation chips resolve against the turn's sources.
          feat/message-ui-polish: for ASSISTANT turns the citation grammar reads
          three more contexts — dejargon (friendly source names), citation-
          activate (inline pill → open the panel at that source), and reveal-db
          (locked to the 'wash' highlight; `revealed` flows from MessageRender's
          RevealStateContext). User bubbles get none of these. */}
      <SourcesContext.Provider value={sources}>
        <AnswerContexts assistant={!isCreatedByUser} activate={activate} revealed={revealed}>
          <div
            className={cn(
              'markdown prose message-content dark:prose-invert light w-full break-words',
              // The editorial answer surface (counselle-answer.css) — assistant
              // turns only; user bubbles keep the cloned prose. Scoped so it never
              // reaches the viz cards / sources footer (they're `.not-prose`).
              !isCreatedByUser && 'counselle-answer',
              isSubmitting && 'submitting',
              showCursorState && text.length > 0 && 'result-streaming',
              isCreatedByUser && !enableUserMsgMarkdown && 'whitespace-pre-wrap',
              isCreatedByUser ? 'dark:text-gray-20' : 'dark:text-gray-100',
            )}
          >
            {content}
          </div>
          {/* FE-4: the clarifying-question widget, inline where the agent paused (PRD 23–25). */}
          {!isCreatedByUser && message.clarify !== undefined && (
            <ClarifyWidget
              // Remount on a live→frozen / answer change so `selected`/`otherOpen`
              // (seeded once at mount) re-seed cleanly instead of going stale.
              key={message.clarifyAnswer ?? 'live'}
              spec={message.clarify}
              frozen={clarifyFrozen}
              answer={message.clarifyAnswer}
              onAnswer={submitMessage}
            />
          )}
          {/* feat/message-ui-polish: the collapsed sources affordance moved OUT of
              the prose body into the message action row (MessageRender), rendered
              by <MessageSources> next to the hover actions. The provider stays:
              inline `[n]` chips still resolve against the turn's sources. */}
        </AnswerContexts>
      </SourcesContext.Provider>
    </Container>
  );
};

export const UnfinishedMessage = ({ message }: { message: ChatMessage }) => (
  <ErrorMessage message={message} text="You stopped this response." />
);

const MessageContent = ({
  text,
  edit,
  error,
  unfinished,
  isSubmitting,
  isLast,
  ...props
}: TMessageContentProps) => {
  const { message } = props;

  const showRegularCursor = useMemo(() => isLast && isSubmitting, [isLast, isSubmitting]);

  const unfinishedMessage = useMemo(
    () =>
      !isSubmitting && unfinished ? (
        <Suspense>
          <DelayedRender delay={UNFINISHED_DELAY}>
            <UnfinishedMessage message={message} />
          </DelayedRender>
        </Suspense>
      ) : null,
    [isSubmitting, unfinished, message],
  );

  if (error) {
    return <ErrorMessage message={message} text={text} />;
  }

  if (edit) {
    return <EditMessage text={text} isSubmitting={isSubmitting} {...props} />;
  }

  return (
    <>
      <DisplayMessage
        key={`display-${message.messageId}`}
        showCursor={showRegularCursor}
        text={text}
        {...props}
      />
      {/* A turn that errored mid-stream keeps its partial prose (honesty:
          show what was produced) with the protocol error appended after it. */}
      {message.streamError !== undefined && (
        <ErrorMessage message={message} text={message.streamError.message} />
      )}
      {unfinishedMessage}
    </>
  );
};

const MemoizedMessageContent = memo(MessageContent);
MemoizedMessageContent.displayName = 'MessageContent';

export default MemoizedMessageContent;
