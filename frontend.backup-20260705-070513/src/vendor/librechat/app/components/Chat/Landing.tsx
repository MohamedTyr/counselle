/**
 * Vendored from upstream client/src/components/Chat/Landing.tsx (pinned 197a1dc4).
 *
 * Subtractions:
 * - ConvoIcon / endpoint resolution / agentsMap / assistantMap removed
 * - useGetEndpointsQuery / useGetStartupConfig removed
 * - useAuthContext removed (no user object)
 * - BirthdayIcon / TooltipAnchor icon row removed
 * - entity/modelSpec/brandedSpec logic removed
 * - Time-based greeting logic removed
 * - description / HTML sanitizer removed
 *
 * Rewires:
 * - Greeting text comes from `GET /v1/config` (B5c — async query, graceful
 *   loading/fallback; was an import-time constant). The season-note caption is
 *   no longer rendered (home-page redesign).
 * - SplitText replaced by `AnimatedGreeting` (word-level blur+rise reveal on
 *   framer-motion; reduced-motion safe) — see components/composer.
 * - ConversationStarters replaced by `SuggestionPills` (rendered in ChatView
 *   below the composer; pills populate the composer text, they do not submit).
 *
 * JSX layout structure is based on upstream, but the greeting text sizes
 * (getTextSizeClass) and typography classes have been updated for the home-page
 * redesign — this file is intentionally NOT a verbatim upstream copy.
 */
import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { useConfigQuery } from '@/api/hooks';
import AnimatedGreeting from '@/components/composer/AnimatedGreeting';

/** Sensible fallbacks if `/v1/config` errors — the home screen never crashes. */
const FALLBACK_GREETING = 'Where should we begin?';

function getTextSizeClass(text: string | undefined | null) {
  if (!text) {
    return 'text-2xl sm:text-4xl';
  }
  if (text.length < 40) {
    return 'text-3xl sm:text-[2.5rem]';
  }
  if (text.length < 70) {
    return 'text-2xl sm:text-[2rem]';
  }
  return 'text-xl sm:text-3xl';
}

export default function Landing({ centerFormOnLanding }: { centerFormOnLanding: boolean }) {
  const [textHasMultipleLines, setTextHasMultipleLines] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const { data: config, isLoading } = useConfigQuery();
  // Don't flash the fallback while the query resolves; once settled, use the
  // server greeting (or the fallback on error).
  const greetingText = config?.greeting ?? FALLBACK_GREETING;

  const handleLineCountChange = useCallback((count: number) => {
    setTextHasMultipleLines(count > 1);
    setLineCount(count);
  }, []);

  useEffect(() => {
    if (contentRef.current) {
      setContentHeight(contentRef.current.offsetHeight);
    }
  }, [lineCount]);

  const getDynamicMargin = useMemo(() => {
    let margin = 'mb-0';
    if (lineCount > 2) {
      margin = 'mb-10';
    } else if (lineCount > 1) {
      margin = 'mb-6';
    } else if (textHasMultipleLines) {
      margin = 'mb-4';
    }
    if (contentHeight > 200) {
      margin = 'mb-16';
    } else if (contentHeight > 150) {
      margin = 'mb-12';
    }
    return margin;
  }, [lineCount, textHasMultipleLines, contentHeight]);

  return (
    <div
      className={`flex h-full transform-gpu flex-col items-center justify-center pb-16 transition-all duration-200 ${centerFormOnLanding ? 'max-h-full sm:max-h-0' : 'max-h-full'} ${getDynamicMargin}`}
    >
      <div
        ref={contentRef}
        className={`flex flex-col items-center gap-0 p-2 transition-opacity duration-200 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
      >
        <div
          className={`flex ${textHasMultipleLines ? 'flex-col' : 'flex-col md:flex-row'} items-center justify-center gap-2`}
        >
          <AnimatedGreeting
            text={greetingText}
            className={`${getTextSizeClass(greetingText)} text-center font-semibold leading-[1.08] tracking-[-0.02em] text-text-primary`}
            onLineCountChange={handleLineCountChange}
          />
        </div>
      </div>
    </div>
  );
}
