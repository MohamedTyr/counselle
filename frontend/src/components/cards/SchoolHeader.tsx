/**
 * SchoolHeader — a comparison column's identity: the logo alone, with the name
 * and website revealed on interaction.
 *
 * Interaction model (the point of this component): opens on hover for a fine
 * pointer, on tap for touch (no hover exists there), and on keyboard focus — with
 * a short close grace period so the pointer can travel from the logo into the
 * panel to click the link. The school name is always present as `sr-only` text so
 * the column stays a real, named table header for assistive tech even though only
 * the logo is drawn.
 */
import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { cn } from '@librechat/client/utils';
import type { SchoolRef } from '@/api/protocol';
import SchoolDomainLink from '@/components/cards/SchoolDomainLink';
import SchoolLogo from '@/components/cards/SchoolLogo';

const OPEN_DELAY = 60; // ms — debounce hover so sweeping across logos doesn't flicker
const CLOSE_DELAY = 160; // ms — grace to move the pointer from the logo into the panel

export default function SchoolHeader({ school }: { school: SchoolRef }) {
  const [open, setOpen] = useState(false);
  const timer = useRef<number | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const clearTimer = () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };
  useEffect(() => clearTimer, []);

  const openAfter = (delay: number) => {
    clearTimer();
    timer.current = window.setTimeout(() => setOpen(true), delay);
  };
  const closeAfter = (delay: number) => {
    clearTimer();
    timer.current = window.setTimeout(() => setOpen(false), delay);
  };

  return (
    <Popover.Root
      open={open}
      onOpenChange={(next) => {
        clearTimer();
        setOpen(next);
      }}
    >
      <Popover.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          // Hover only for a real (mouse) pointer; touch falls through to tap.
          onPointerEnter={(e) => e.pointerType === 'mouse' && openAfter(OPEN_DELAY)}
          onPointerLeave={(e) => e.pointerType === 'mouse' && closeAfter(CLOSE_DELAY)}
          onFocus={() => openAfter(0)}
          // Tabbing INTO the panel (e.g. to reach the website link) must not
          // close it — only schedule a close when focus leaves the popover.
          onBlur={(e) => {
            if (e.relatedTarget instanceof Node && contentRef.current?.contains(e.relatedTarget)) {
              return;
            }
            closeAfter(CLOSE_DELAY);
          }}
          className={cn(
            'group/logo inline-flex items-center justify-center rounded-lg p-0.5',
            'transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'data-[state=open]:ring-2 data-[state=open]:ring-border',
          )}
        >
          <SchoolLogo
            name={school.name}
            domain={school.domain}
            size={26}
            className="transition-transform duration-150 ease-out group-hover/logo:scale-105"
          />
          <span className="sr-only">{school.name}</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          side="top"
          align="center"
          sideOffset={8}
          collisionPadding={12}
          onOpenAutoFocus={(e) => e.preventDefault()} // hover-open must not steal focus
          onPointerEnter={clearTimer}
          onPointerLeave={() => closeAfter(CLOSE_DELAY)}
          // Tabbing OUT of the panel (not back to the trigger) closes it.
          onBlur={(e) => {
            const next = e.relatedTarget;
            const insideContent = next instanceof Node && contentRef.current?.contains(next);
            const isTrigger = next instanceof Node && triggerRef.current?.contains(next);
            if (!insideContent && !isTrigger) {
              closeAfter(CLOSE_DELAY);
            }
          }}
          className={cn(
            'z-40 w-60 overflow-hidden rounded-2xl border border-border-light bg-surface-chat shadow-xl',
            'data-[state=open]:animate-in data-[state=closed]:animate-out',
            'data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0',
            'data-[state=open]:zoom-in-95 data-[state=closed]:zoom-out-95',
            'motion-reduce:animate-none',
          )}
        >
          <div className="flex items-start gap-3 p-3.5">
            <SchoolLogo name={school.name} domain={school.domain} size={36} />
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-snug text-text-primary">
                {school.name}
              </div>
              <SchoolDomainLink domain={school.domain} className="mt-1" />
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
