/**
 * SourceRow — one external source in the sidebar: favicon + friendly name +
 * page title + a one-line excerpt. The whole row is a link to the page.
 *
 * The source identity (favicon + name) carries the trust on its own; no tag and
 * no raw backend caveat ("General web source — verify on the school's official
 * site") ever reach the student.
 *
 * When the sidebar is opened from an inline pill, the matching row receives
 * `active`, which scrolls it into view and flashes it so the eye lands on the
 * right source.
 */
import { forwardRef } from 'react';
import type { SourceEntry } from '@/api/protocol';
import { isSafeUrl } from '@/api/url';
import SourceFavicon from '@/components/citations/SourceFavicon';
import { friendlySourceName } from '@/components/citations/sourceName';
import { cn } from '@librechat/client/utils';

interface SourceRowProps {
  entry: SourceEntry;
  active?: boolean;
}

const SourceRow = forwardRef<HTMLLIElement, SourceRowProps>(function SourceRow(
  { entry, active },
  ref,
) {
  const { citation, label, snippet } = entry;
  const name = friendlySourceName(citation);
  const title = label || name;
  const url = isSafeUrl(citation.url) ? (citation.url as string) : undefined;

  const inner = (
    <>
      <SourceFavicon citation={citation} sizeClass="h-6 w-6" className="mt-0.5" />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px] leading-none text-text-tertiary">
          <span className="truncate">{name}</span>
        </span>
        <span className="mt-1 block text-[13px] font-medium leading-snug text-text-primary [overflow-wrap:anywhere] line-clamp-2">
          {title}
        </span>
        {snippet != null && snippet !== '' && (
          <span className="mt-1 block text-[12px] font-normal leading-relaxed text-text-tertiary [overflow-wrap:anywhere] line-clamp-2">
            {snippet}
          </span>
        )}
      </span>
    </>
  );

  const rowClass = cn(
    'flex gap-2.5 rounded-lg px-3 py-2 !no-underline transition-colors',
    'hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    active && 'motion-safe:[animation:source-flash_1.2s_ease-out]',
  );

  return (
    <li ref={ref}>
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={rowClass}>
          {inner}
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      ) : (
        <div className={rowClass}>{inner}</div>
      )}
    </li>
  );
});

export default SourceRow;
