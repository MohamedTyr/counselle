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
 * - Greeting text + season note come from Counselle config fixture
 * - SplitText animation kept byte-identical
 * - ConversationStarters render in ChatView below the composer (upstream position)
 *
 * JSX layout classes byte-identical to upstream.
 */
import { useMemo, useCallback, useState, useEffect, useRef } from 'react';
import { easings } from '@react-spring/web';
import { SplitText } from '@librechat/client';
import { APP_CONFIG } from '@/api/mock/fixtures/config';

function getTextSizeClass(text: string | undefined | null) {
  if (!text) {
    return 'text-xl sm:text-2xl';
  }
  if (text.length < 40) {
    return 'text-2xl sm:text-4xl';
  }
  if (text.length < 70) {
    return 'text-xl sm:text-2xl';
  }
  return 'text-lg sm:text-md';
}

export default function Landing({ centerFormOnLanding }: { centerFormOnLanding: boolean }) {
  const [textHasMultipleLines, setTextHasMultipleLines] = useState(false);
  const [lineCount, setLineCount] = useState(1);
  const [contentHeight, setContentHeight] = useState(0);
  const contentRef = useRef<HTMLDivElement>(null);

  const greetingText = APP_CONFIG.greeting;

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
      <div ref={contentRef} className="flex flex-col items-center gap-0 p-2">
        <div
          className={`flex ${textHasMultipleLines ? 'flex-col' : 'flex-col md:flex-row'} items-center justify-center gap-2`}
        >
          <SplitText
            key={`split-text-${greetingText}`}
            text={greetingText}
            className={`${getTextSizeClass(greetingText)} font-medium text-text-primary`}
            delay={50}
            textAlign="center"
            animationFrom={{ opacity: 0, transform: 'translate3d(0,50px,0)' }}
            animationTo={{ opacity: 1, transform: 'translate3d(0,0,0)' }}
            easing={easings.easeOutCubic}
            threshold={0}
            rootMargin="0px"
            onLineCountChange={handleLineCountChange}
          />
        </div>
        {APP_CONFIG.season_note && (
          <div className="animate-fadeIn mt-4 max-w-md text-center text-sm font-normal text-text-primary">
            {APP_CONFIG.season_note}
          </div>
        )}
      </div>
    </div>
  );
}
