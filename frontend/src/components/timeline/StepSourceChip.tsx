/**
 * StepSourceChip (feat/reasoning-experience) — an interactive source chip in
 * the reasoning trace. Today's trace renders inert spans; this makes every chip
 * a real affordance, in the app's existing source grammar (CitationPopover /
 * SourcesFooter — Radix, isSafeUrl-gated, never a raw href sink).
 *
 * Two semantics, one look:
 *   - result chips (web/edu/reddit searches) → a link to the result; the hover
 *     preview names the host (or the full reddit title) and the query that
 *     surfaced it. Reddit carries the community-voice note (PRD story 34).
 *   - school chips (db/sql/viz steps) → a link to the school's website; the
 *     preview is a quiet "peek" (logo + name + host). We NEVER expose what was
 *     pulled from the DB — internal field/table names stay off the wire to the
 *     student.
 *
 * On Radix HoverCard (opens on hover AND keyboard focus) + isSafeUrl. A chip
 * with no safe URL falls back to the inert span (current behaviour) — no dead
 * affordance, no empty preview.
 */
import { useState } from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { ExternalLink } from 'lucide-react';
import type { StepKind, StepSource } from '@/api/protocol';
import { isSafeUrl } from '@/api/url';
import { cn } from '~/utils';

const SCHOOL_KINDS: StepKind[] = ['db_tool', 'sql', 'viz'];

/** Only an https favicon reaches the <img> src (defensive: refuse data:/js:). */
function safeFavicon(favicon: string | null | undefined): string | undefined {
  return favicon != null && favicon.startsWith('https://') ? favicon : undefined;
}

/** The bare host for the preview's secondary line ("usnews.com"). */
function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function Favicon({ favicon, size }: { favicon: string | null | undefined; size: number }) {
  const [broken, setBroken] = useState(false);
  const src = safeFavicon(favicon);
  if (src === undefined || broken) {
    return null;
  }
  return (
    <span
      className="shrink-0 overflow-hidden rounded-full bg-white ring-1 ring-black/10"
      style={{ width: size, height: size }}
    >
      <img
        src={src}
        alt=""
        loading="lazy"
        className="size-full scale-110 object-cover"
        onError={() => setBroken(true)}
      />
    </span>
  );
}

type StepSourceChipProps = {
  source: StepSource;
  kind: StepKind;
  index: number;
  /** The search query that surfaced this result (search kinds; from the step
   *  receipt) — shown in the preview, never on the resting chip. */
  query?: string;
};

export default function StepSourceChip({ source, kind, index, query }: StepSourceChipProps) {
  const url = isSafeUrl(source.url) ? source.url : undefined;
  const isSchool = SCHOOL_KINDS.includes(kind);
  const isReddit = kind === 'reddit_search';

  const chipInner = (
    <>
      <Favicon favicon={source.favicon} size={15} />
      <span className="truncate font-medium">{source.label}</span>
    </>
  );

  const baseClass =
    'counselle-chip-in inline-flex max-w-full items-center gap-1.5 rounded-md border border-border-light bg-surface-secondary pl-[5px] pr-2 py-0.5 text-xs text-text-primary';

  // No safe URL: keep the inert span (no dead affordance, no empty preview).
  if (url === undefined) {
    return (
      <span className={baseClass} style={{ animationDelay: `${0.08 * (index + 1)}s` }}>
        {chipInner}
      </span>
    );
  }

  // The preview's secondary line: for a result chip, where it came from + the
  // query; for a school chip, just its website host (no DB internals).
  const host = hostOf(url);

  return (
    <HoverCard.Root openDelay={120} closeDelay={80}>
      <HoverCard.Trigger asChild>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={isSchool ? `${source.label} — visit website` : `Open source: ${source.label}`}
          className={cn(
            baseClass,
            'cursor-pointer no-underline transition-colors',
            'hover:border-border-medium hover:bg-surface-hover hover:text-text-primary',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-xheavy',
          )}
          style={{ animationDelay: `${0.08 * (index + 1)}s` }}
        >
          {chipInner}
        </a>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="start"
          sideOffset={6}
          className={cn(
            'z-40 flex w-64 max-w-[80vw] flex-col rounded-xl border border-border-light bg-surface-chat p-3 shadow-lg',
            'motion-safe:data-[state=open]:animate-in motion-safe:data-[state=closed]:animate-out',
            'motion-safe:data-[state=open]:fade-in-0 motion-safe:data-[state=closed]:fade-out-0',
            'motion-safe:data-[state=open]:zoom-in-95 motion-safe:data-[state=closed]:zoom-out-95',
          )}
        >
          <span className="flex items-start gap-2">
            <Favicon favicon={source.favicon} size={18} />
            <span className="min-w-0 text-sm font-semibold leading-snug text-text-primary">
              {source.label}
            </span>
          </span>
          {isReddit && (
            <span className="mt-1.5 text-xs italic text-[var(--community-text)]">
              Community voice — an experience, not a statistic.
            </span>
          )}
          {!isSchool && query !== undefined && query !== '' && (
            <span className="mt-1.5 text-xs text-text-secondary">
              Found searching “{query}”
            </span>
          )}
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-flex items-center gap-1 truncate text-xs text-[var(--official-text)] hover:underline"
          >
            <ExternalLink className="size-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{isSchool ? 'Visit website' : host}</span>
          </a>
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
