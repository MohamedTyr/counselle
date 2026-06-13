/**
 * CitationPopover — the anchored citation popover (PRD story 27).
 *
 * Radix Popover (NOT Ariakit — never `.popover-ui`, which is Ariakit-only
 * and stays invisible under Radix). Shows the Citation: source name (bold),
 * vintage line, caveat (muted) if present, url as an external link, and
 * raw_table as a muted footnote. Keyboard-reachable trigger; Esc closes
 * (Radix default). Panel chrome copied from SourceDropdown's panel.
 */
import type { ReactNode } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { ExternalLink } from 'lucide-react';
import { cn } from '@librechat/client/utils';
import type { Citation } from '@/api/protocol';
import { isSafeUrl } from '@/api/url';

interface CitationPopoverProps {
  citation: Citation;
  /** The trigger element — rendered via Popover.Trigger asChild. */
  children: ReactNode;
}

export default function CitationPopover({ citation, children }: CitationPopoverProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild aria-label={`Source: ${citation.source}`}>
        {children}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="center"
          sideOffset={6}
          className={cn(
            // NOTE: not .popover-ui — that class is Ariakit-only (hidden until
            // [data-enter]); this Radix popover animates via data-[state].
            'z-40 flex w-72 flex-col rounded-xl border border-border-light bg-surface-chat p-3 shadow-lg',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
          )}
        >
          <span className="text-sm font-semibold text-text-primary">{citation.source}</span>
          <span className="mt-0.5 text-xs text-text-secondary">{citation.vintage}</span>
          {citation.caveat != null && citation.caveat !== '' && (
            <span className="mt-1.5 text-xs italic text-text-secondary">{citation.caveat}</span>
          )}
          {isSafeUrl(citation.url) && (
            <a
              href={citation.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--official-text)] hover:underline"
            >
              <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="truncate">{citation.url}</span>
            </a>
          )}
          {citation.raw_table != null && citation.raw_table !== '' && (
            <span className="mt-1.5 border-t border-border-light pt-1.5 text-[10px] text-text-secondary">
              {citation.raw_table}
            </span>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
