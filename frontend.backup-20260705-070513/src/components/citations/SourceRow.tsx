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

  // The flash animation is shared by both shapes; the interactive hover/ring
  // styling applies ONLY to the real link `<a>`. The inert no-URL `<div>` does
  // nothing on click, so dressing it like a link is an affordance lie (FE-L6).
  const flashClass = active ? 'motion-safe:[animation:source-flash_1.2s_ease-out]' : undefined;
  const baseRowClass = 'flex gap-2.5 rounded-lg px-3 py-2 !no-underline transition-colors';
  const interactiveRowClass = cn(
    baseRowClass,
    'hover:bg-surface-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
    flashClass,
  );
  const inertRowClass = cn(baseRowClass, flashClass);

  // When the panel is opened from an inline pill, the active row receives focus
  // (SourcesList focuses `ref` in its activeIndex effect), so it must be a focus
  // target (FE-M8). `tabIndex={-1}` makes it programmatically focusable without
  // entering the tab order.
  return (
    <li ref={ref} tabIndex={active ? -1 : undefined} className="focus:outline-none">
      {url ? (
        <a href={url} target="_blank" rel="noopener noreferrer" className={interactiveRowClass}>
          {inner}
          <span className="sr-only"> (opens in new tab)</span>
        </a>
      ) : (
        <div className={inertRowClass}>{inner}</div>
      )}
    </li>
  );
});

export default SourceRow;
