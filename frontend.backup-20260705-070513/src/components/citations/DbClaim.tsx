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
import { DB_REVEAL_WASH_CLASS } from '@/components/citations/revealStyles';
import { useRevealState } from '@/components/citations/RevealStateContext';
import { useSources } from '@/components/citations/SourcesContext';
import { uniqueSourceByIndex } from '@/components/citations/sourceIndex';
import { isDbSource } from '@/components/citations/sourceName';

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
  // Undefined entry (source not yet streamed), duplicate index, or an external
  // source => inert.
  const claimIndex = index === undefined ? undefined : Number(index);
  const entry =
    claimIndex === undefined ? undefined : uniqueSourceByIndex(sources, claimIndex);
  const canHighlight = entry !== undefined && isDbSource(entry.citation.source);
  const isHighlighted = canHighlight && revealed;

  if (!isHighlighted) {
    return <span data-db-claim="">{children}</span>;
  }

  // Revealed claims act as the HoverCard trigger. A real inline button keeps
  // the reassurance reachable by keyboard focus; the sources panel remains the
  // durable provenance surface for opening full source details.
  const trigger = (
    <button
      type="button"
      data-db-claim=""
      data-revealed=""
      aria-label="From Counselle's verified data"
      className={cn(
        'inline border-0 bg-transparent p-0 text-inherit [font:inherit]',
        'transition-[background-color,text-decoration-color] duration-200 ease-out motion-reduce:transition-none',
        DB_REVEAL_WASH_CLASS,
        'cursor-default rounded-[0.3em] outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-purple)]',
      )}
    >
      {children}
    </button>
  );

  return (
    <HoverCard.Root openDelay={140} closeDelay={80}>
      <HoverCard.Trigger asChild>{trigger}</HoverCard.Trigger>
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
