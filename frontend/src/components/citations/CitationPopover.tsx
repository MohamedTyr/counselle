/**
 * CitationPopover — the anchored citation panel (PRD story 27).
 *
 * Radix Popover (NOT Ariakit — never `.popover-ui`, which is Ariakit-only
 * and stays invisible under Radix). The one place provenance is spelled out:
 * a tier dot + the full source name (honesty — name the authority, never a raw
 * enum), the tier grammar word + vintage, an optional caveat, an outbound link
 * for web sources, and the raw-table footnote. Tier colour (cool official /
 * warm community) carries the squint grammar into the panel.
 */
import type { ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUpRight } from 'lucide-react';
import { cn } from '@librechat/client/utils';
import type { Citation } from '@/api/protocol';
import { isSafeUrl } from '@/api/url';
import { isCommunityTier, sourceDisplayName, tierWord } from '@/components/citations/TierChip';

interface CitationPopoverProps {
  citation: Citation;
  /** The trigger element — rendered via Popover.Trigger asChild. */
  children: ReactNode;
}

export default function CitationPopover({ citation, children }: CitationPopoverProps) {
  const community = isCommunityTier(citation.tier);
  const tierColor = community ? 'var(--community-text)' : 'var(--official-text)';
  const hasCaveat = citation.caveat != null && citation.caveat !== '';
  const hasUrl = isSafeUrl(citation.url);
  const hasRawTable = citation.raw_table != null && citation.raw_table !== '';

  return (
    <Popover.Root>
      <Popover.Trigger asChild aria-label={`Source: ${sourceDisplayName(citation.source)}`}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={8}
          className={cn(
            // NOTE: not .popover-ui — that class is Ariakit-only (hidden until
            // [data-enter]); this Radix popover animates via data-[state].
            'z-40 w-64 overflow-hidden rounded-2xl border border-border-light bg-surface-chat shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            'motion-reduce:animate-none',
          )}
        >
          <div className="flex flex-col gap-2 p-3.5">
            <div className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full"
                style={{ backgroundColor: tierColor }}
              />
              <span className="text-sm font-semibold text-text-primary">
                {sourceDisplayName(citation.source)}
              </span>
            </div>

            <div className="flex flex-col gap-0.5 text-xs leading-snug">
              <span className="font-medium" style={{ color: tierColor }}>
                {tierWord(citation.tier)}
              </span>
              <span className="text-text-secondary">{citation.vintage}</span>
            </div>

            {hasCaveat && (
              <p className="text-xs italic leading-snug text-text-secondary">{citation.caveat}</p>
            )}

            {hasUrl && (
              <a
                href={citation.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="group/link inline-flex items-center gap-1 text-xs font-medium hover:underline motion-reduce:transition-none"
                style={{ color: tierColor }}
              >
                <ArrowUpRight
                  className="h-3.5 w-3.5 shrink-0 transition-transform group-hover/link:translate-x-0.5 group-hover/link:-translate-y-0.5 motion-reduce:transition-none"
                  aria-hidden="true"
                />
                <span className="truncate">{citation.url}</span>
                <span className="sr-only"> (opens in new tab)</span>
              </a>
            )}
          </div>

          {hasRawTable && (
            <div className="border-t border-border-light bg-surface-primary-alt px-3.5 py-2 text-[11px] leading-snug text-text-secondary">
              {citation.raw_table}
            </div>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
