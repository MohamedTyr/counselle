/**
 * DbClaim — what a DB-grounded prose claim becomes under the new grammar.
 *
 * Default (toggle off): plain text. Nothing marks it; the answer reads clean.
 * Revealed (toggle on): the claim lights up in place with a calm brand wash
 * and/or underline — no chip, no number, no source name. Hovering a lit claim
 * shows a single line of reassurance. The wash sits on a persistent <span> so
 * flipping the toggle animates the reveal instead of snapping.
 *
 * `<db-claim>` is produced by remarkDbSpans, which stamps it with the citation
 * index it wraps; registered in the components map.
 *
 * DbClaim is the decision point (honesty): a clause highlights ONLY when its
 * citation resolves to a streamed DB source AND the reveal is on. An unresolved
 * source (not yet streamed) or an external one renders children plainly — we
 * never highlight a clause we can't vouch for as "from Counselle".
 */
import type { ReactNode } from 'react';
import * as HoverCard from '@radix-ui/react-hover-card';
import { cn } from '@librechat/client/utils';
import CounselleMark from '@/components/citations/CounselleMark';
import { useRevealState } from '@/components/citations/RevealStateContext';
import { useSources } from '@/components/citations/SourcesContext';
import { isDbSource } from '@/components/citations/sourceName';

// Production locks the 'wash' treatment (FE-CITATIONS-CONTEXT-SPRAWL — the
// preview-only style switch is gone, so RevealDbContext collapsed into
// RevealStateContext). The calm brand wash that lights a verified DB clause.
const WASH_CLASS =
  'rounded-[0.3em] bg-[color-mix(in_oklab,var(--brand-purple)_14%,transparent)] ' +
  '[box-decoration-break:clone] [-webkit-box-decoration-break:clone] ' +
  'px-[0.18em] py-[0.04em] -mx-[0.04em]';

export default function DbClaim({
  children,
  index,
}: {
  children?: ReactNode;
  // react-markdown forwards hProperties.index as string | number; coerce below.
  index?: string | number;
}) {
  const { revealed } = useRevealState();
  const sources = useSources();

  // Honesty gate: light up only a streamed DB source, and only when revealed.
  // Undefined entry (source not yet streamed) or an external source ⇒ inert.
  const claimIndex = index === undefined ? undefined : Number(index);
  const entry =
    claimIndex === undefined ? undefined : sources.find((s) => s.index === claimIndex);
  const canHighlight = entry !== undefined && isDbSource(entry.citation.source);
  const isHighlighted = canHighlight && revealed;

  if (!isHighlighted) {
    return <span data-db-claim="">{children}</span>;
  }

  // Revealed claims act as the HoverCard trigger, so they must be reachable by
  // keyboard and announced as interactive — Radix opens the card on focus too.
  const span = (
    <span
      data-db-claim=""
      data-revealed=""
      role="button"
      tabIndex={0}
      aria-label="From Counselle's verified data"
      className={cn(
        'transition-[background-color,text-decoration-color] duration-200 ease-out motion-reduce:transition-none',
        WASH_CLASS,
        'cursor-default rounded-[0.3em] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)]',
      )}
    >
      {children}
    </span>
  );

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
