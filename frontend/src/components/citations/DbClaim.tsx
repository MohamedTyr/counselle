/**
 * DbClaim — what a DB-grounded prose claim becomes under the new grammar.
 *
 * Default (toggle off): plain text. Nothing marks it; the answer reads clean.
 * Revealed (toggle on): the claim lights up in place with a calm brand wash
 * and/or underline — no chip, no number, no source name. Hovering a lit claim
 * shows a single line of reassurance. The wash sits on a persistent <span> so
 * flipping the toggle animates the reveal instead of snapping.
 *
 * `<db-claim>` is produced by remarkDbClaim; registered in the components map.
 */
import type { ReactNode } from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { cn } from '@librechat/client/utils';
import CounselleMark from '@/components/citations/CounselleMark';
import { useRevealDb, type HighlightStyle } from '@/components/citations/RevealDbContext';

function highlightClass(style: HighlightStyle): string {
  const wash =
    'rounded-[0.3em] bg-[color-mix(in_oklab,var(--brand-purple)_14%,transparent)] ' +
    '[box-decoration-break:clone] [-webkit-box-decoration-break:clone] ' +
    'px-[0.18em] py-[0.04em] -mx-[0.04em]';
  const underline =
    '[text-decoration-line:underline] [text-decoration-thickness:2px] [text-underline-offset:3px] ' +
    '[text-decoration-color:color-mix(in_oklab,var(--brand-purple)_60%,transparent)]';
  if (style === 'wash') return wash;
  if (style === 'underline') return underline;
  return `${wash} ${underline}`;
}

export default function DbClaim({ children }: { children?: ReactNode }) {
  const { revealed, style } = useRevealDb();

  // Revealed claims act as the HoverCard trigger, so they must be reachable by
  // keyboard and announced as interactive — Radix opens the card on focus too.
  const span = (
    <span
      data-db-claim=""
      data-revealed={revealed ? '' : undefined}
      role={revealed ? 'button' : undefined}
      tabIndex={revealed ? 0 : undefined}
      aria-label={revealed ? "From Counselle's verified data" : undefined}
      className={cn(
        'transition-[background-color,text-decoration-color] duration-200 ease-out motion-reduce:transition-none',
        revealed && highlightClass(style),
        revealed &&
          'cursor-default rounded-[0.3em] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)]',
      )}
    >
      {children}
    </span>
  );

  if (!revealed) {
    return span;
  }

  return (
    <HoverCard.Root openDelay={140} closeDelay={80}>
      <HoverCard.Trigger asChild>{span}</HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className={cn(
            'z-50 inline-flex w-fit max-w-[16rem] items-center gap-1.5 rounded-xl',
            'border border-border-light bg-surface-chat px-2.5 py-1.5 shadow-lg',
            'text-[12px] font-medium leading-snug text-text-secondary',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'motion-reduce:animate-none',
          )}
        >
          <CounselleMark sizeClass="h-[15px] w-[15px]" />
          From Counselle&rsquo;s verified data
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}
