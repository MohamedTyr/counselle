/**
 * SourcePill — the inline, named citation for an EXTERNAL source.
 *
 * Replaces the old numbered `[n]` chip: instead of a research-paper superscript,
 * a claim that leans on the open web shows the page it came from — a small
 * favicon + a friendly name (a subreddit, a publisher, a host). Hovering is a
 * peek, not the record: just the source name and the page title (the snippet
 * lives in the sidebar). Clicking opens the sources sidebar and jumps to that
 * exact source.
 *
 * Figures from our own database carry NO inline pill — they're rendered plainly
 * and credited once, as "Counselle data", in the panel.
 */
import * as HoverCard from '@radix-ui/react-hover-card';
import { cn } from '@librechat/client/utils';
import type { SourceEntry } from '@/api/protocol';
import SourceFavicon from '@/components/citations/SourceFavicon';
import { friendlySourceName } from '@/components/citations/sourceName';

interface SourcePillProps {
  entry: SourceEntry;
  /** Opens the sidebar and scrolls to this source. */
  onActivate: () => void;
}

export default function SourcePill({ entry, onActivate }: SourcePillProps) {
  const { citation, label } = entry;
  const name = friendlySourceName(citation);

  return (
    <HoverCard.Root openDelay={120} closeDelay={80}>
      <HoverCard.Trigger asChild>
        <button
          type="button"
          onClick={onActivate}
          aria-label={`Source: ${name}. Open in sidebar.`}
          className={cn(
            'not-prose mx-px inline-flex max-w-[14rem] translate-y-[0.12em] items-center gap-1',
            'rounded-full border border-border-light bg-surface-primary-alt py-[1px] pl-[3px] pr-2',
            'align-baseline text-[0.82em] font-medium leading-none text-text-secondary no-underline',
            'transition-colors duration-150 hover:bg-surface-hover hover:text-text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          <SourceFavicon citation={citation} sizeClass="h-[15px] w-[15px]" className="!border-0 !p-0" />
          <span className="truncate">{name}</span>
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            'not-prose z-50 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-2xl',
            'border border-border-light bg-surface-chat p-3 shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            'motion-reduce:animate-none',
          )}
        >
          <div className="flex items-center gap-2">
            <SourceFavicon citation={citation} sizeClass="h-[18px] w-[18px]" />
            <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-text-secondary">
              {name}
            </span>
          </div>

          {label && (
            <p className="mt-1.5 text-[13.5px] font-semibold leading-snug text-text-primary [overflow-wrap:anywhere] line-clamp-2">
              {label}
            </p>
          )}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
