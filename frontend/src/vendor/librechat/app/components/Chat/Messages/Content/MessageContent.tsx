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
import { memo, Suspense, useMemo } from 'react';
import { DelayedRender } from '@librechat/client';
import type { TMessageContentProps, TDisplayProps } from '~/common';
import type { ChatMessage } from '@/app/ChatContext';
import Error from '~/components/Messages/Content/Error';
import { useMessageContext } from '~/Providers';
// FE-4: timeline above the prose, VizCard (replaces VizPlaceholder), citations context, clarify, sources footer.
import { useChatContext } from '@/app/ChatContext';
import ActivityTimeline from '@/components/timeline/ActivityTimeline';
import ThinkingShimmer from '@/components/timeline/ThinkingShimmer';
import ClarifyWidget from '@/components/clarify/ClarifyWidget';
import SourcesContext from '@/components/citations/SourcesContext';
import SourcesFooter from '@/components/citations/SourcesFooter';
import { citedIndexesIn } from '@/components/citations/remarkCitations';
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

  // B5d (wire-contract §5, PINNED): the footer shows only the sources THIS
  // message cited — the union of `[n]` markers in its markdown blocks (viz cells
  // contribute nothing; cards carry their own per-cell popovers). The cumulative
  // chips elsewhere stay untouched.
  const citedIndexes = useMemo(() => {
    const indexes = new Set<number>();
    const blocks = message.content;
    if (blocks !== undefined) {
      for (const block of blocks) {
        if (block.kind === 'markdown') {
          for (const i of citedIndexesIn(block.text)) {
            indexes.add(i);
          }
        }
      }
    } else if (!isCreatedByUser) {
      for (const i of citedIndexesIn(text)) {
        indexes.add(i);
      }
    }
    return indexes;
  }, [message.content, text, isCreatedByUser]);

  return (
    <Container message={message}>
      {/* FE-4: the activity timeline renders ABOVE the prose (PRD stories 13–16). */}
      {!isCreatedByUser && message.timeline !== undefined && (
        <ActivityTimeline
          timeline={message.timeline}
          status={message.turnStatus ?? 'complete'}
          receipt={message.receipt}
          durationMs={message.durationMs}
        />
      )}
      {/* B5d: the dead-air "Thinking…" shimmer — live turn, nothing progressing. */}
      {!isCreatedByUser && message.isThinking === true && <ThinkingShimmer />}
      {/* FE-4: inline citation chips resolve against the turn's sources. */}
      <SourcesContext.Provider value={sources}>
        <div
          className={cn(
            'markdown prose message-content dark:prose-invert light w-full break-words',
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
        {/* FE-4: the sources footer closes a completed answer (PRD story 21). */}
        {!isCreatedByUser && message.turnStatus === 'complete' && sources.length > 0 && (
          <SourcesFooter sources={sources} citedIndexes={citedIndexes} />
        )}
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
