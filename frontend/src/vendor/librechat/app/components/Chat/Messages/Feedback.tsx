/**
 * Vendored from upstream client/src/components/Chat/Messages/Feedback.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions (B5c):
 * - The reason-chip popovers (Ariakit `usePopoverStore` + `getTagsForRating` +
 *   `FeedbackOptionButton`) are removed. The backend stores only `{rating}`
 *   (reason chips are MVP3); collecting tags it discards is a dishonest
 *   affordance, so the tag UI is cut.
 * - The "other" free-text `OGDialog` is removed for the same reason (the
 *   backend stores no text).
 * This is now a plain two-button thumbs toggle: click a thumb to set it, click
 * the same thumb again to clear. The button classes / icons / hover-visibility
 * grammar (`buttonClasses`, `ThumbUpIcon`/`ThumbDownIcon`, `isLast`) are
 * byte-identical to upstream so it looks the same minus the popovers.
 */
import { useCallback } from 'react';
import { TFeedback } from 'librechat-data-provider';
import { ThumbUpIcon, ThumbDownIcon } from '@librechat/client';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

interface FeedbackProps {
  handleFeedback: ({ feedback }: { feedback: TFeedback | undefined }) => void;
  feedback?: TFeedback;
  isLast?: boolean;
}

function buttonClasses(isActive: boolean, isLast: boolean) {
  return cn(
    'hover-button rounded-lg p-1.5 text-text-secondary-alt',
    'hover:text-text-primary hover:bg-surface-hover',
    'md:group-hover:visible md:group-focus-within:visible md:group-[.final-completion]:visible',
    !isLast && 'md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100',
    'focus-visible:ring-2 focus-visible:ring-black dark:focus-visible:ring-white focus-visible:outline-none',
    isActive && 'active text-text-primary bg-surface-hover',
  );
}

export default function Feedback({
  isLast = false,
  handleFeedback,
  feedback,
}: FeedbackProps) {
  const localize = useLocalize();

  const isUp = feedback?.rating === 'thumbsUp';
  const isDown = feedback?.rating === 'thumbsDown';

  // Click a thumb to set it; click the active thumb again to clear (toggle).
  const handleThumbsUp = useCallback(() => {
    handleFeedback({ feedback: isUp ? undefined : { rating: 'thumbsUp' } });
  }, [handleFeedback, isUp]);

  const handleThumbsDown = useCallback(() => {
    handleFeedback({ feedback: isDown ? undefined : { rating: 'thumbsDown' } });
  }, [handleFeedback, isDown]);

  // When a rating is set, upstream collapsed to the single chosen button; keep
  // that grammar (the unchosen thumb hides once a side is picked).
  if (isUp) {
    return (
      <button
        className={buttonClasses(true, isLast)}
        onClick={handleThumbsUp}
        type="button"
        title={localize('com_ui_feedback_positive')}
        aria-pressed="true"
      >
        <ThumbUpIcon size="19" bold />
      </button>
    );
  }

  if (isDown) {
    return (
      <button
        className={buttonClasses(true, isLast)}
        onClick={handleThumbsDown}
        type="button"
        title={localize('com_ui_feedback_negative')}
        aria-pressed="true"
      >
        <ThumbDownIcon size="19" bold />
      </button>
    );
  }

  return (
    <>
      <button
        className={buttonClasses(false, isLast)}
        onClick={handleThumbsUp}
        type="button"
        title={localize('com_ui_feedback_positive')}
        aria-pressed={false}
      >
        <ThumbUpIcon size="19" bold={false} />
      </button>
      <button
        className={buttonClasses(false, isLast)}
        onClick={handleThumbsDown}
        type="button"
        title={localize('com_ui_feedback_negative')}
        aria-pressed={false}
      >
        <ThumbDownIcon size="19" bold={false} />
      </button>
    </>
  );
}
