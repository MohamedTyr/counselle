/**
 * Vendored from upstream client/src/components/Messages/ScrollToBottom.tsx
 * (pinned 197a1dc4).
 *
 * Subtractions: maximizeChatSpace (recoil) frozen false — the non-maximized
 * width classes are kept. Everything else byte-identical.
 */
import { forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';
import { useLocalize } from '~/hooks';
import { cn } from '~/utils';

type Props = {
  scrollHandler: React.MouseEventHandler<HTMLButtonElement>;
};

const ScrollToBottom = forwardRef<HTMLDivElement, Props>(({ scrollHandler }, ref) => {
  const localize = useLocalize();

  return (
    <div
      ref={ref}
      className={cn(
        'pointer-events-none absolute bottom-5 left-0 right-0 mx-auto flex justify-end',
        'md:max-w-3xl xl:max-w-4xl',
      )}
    >
      <button
        onClick={scrollHandler}
        className="premium-scroll-button pointer-events-auto cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy"
        aria-label={localize('com_ui_scroll_to_bottom')}
      >
        <ChevronDown className="h-4 w-4 text-text-secondary" />
      </button>
    </div>
  );
});

ScrollToBottom.displayName = 'ScrollToBottom';

export default ScrollToBottom;
