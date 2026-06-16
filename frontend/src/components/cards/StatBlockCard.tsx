/**
 * StatBlockCard — the dossier stat block (PRD story 28; semantics ported
 * from the retired MVP1 harness's buildStatBlock).
 *
 * One school, one fact sheet. The header is a logo-led identity (SchoolIdentity)
 * so the school is recognised at a glance; the eyebrow lifts the descriptive
 * remainder of the title ("Key facts") without echoing the name.
 *
 * Label/value grid: one VizRow per line, value = cells[0]. Unavailable values
 * render the designed muted NA state (PRD story 29) — never an empty cell,
 * visibly distinct from a zero. Available values stack `display` (tabular
 * figures) over a quiet SourceTag — the same calm citation grammar as the
 * comparison table, tap to see provenance. Long labels and qualitative values
 * wrap (`overflow-wrap:anywhere`) rather than overflow.
 *
 * `variant='panel'` (the artifact sideview) trades the tight chat spacing for a
 * divided, roomier list — the point of opening here is to read a lot of rows
 * comfortably; PanelChrome already draws the identity, so the body is rows only.
 */
import * as HoverCard from '@radix-ui/react-hover-card';
import { cn } from '@librechat/client/utils';
import type { CitationEnvelope, RenderSpec } from '@/api/protocol';
import { NotAvailableValue } from '@/components/cards/NotAvailable';
import SchoolIdentity from '@/components/cards/SchoolIdentity';
import VizFrame from '@/components/cards/VizFrame';
import { sectionLabel } from '@/components/cards/vizTitle';
import type { VizVariant } from '@/components/cards/vizVariant';
import CitationPopover from '@/components/citations/CitationPopover';
import CounselleVerifiedBadge from '@/components/citations/CounselleVerifiedBadge';
import SourceTag from '@/components/citations/SourceTag';
import { tierLabel } from '@/components/citations/TierChip';
import { useDejargon } from '@/components/citations/dejargon';

// Re-exported for back-compat; the canonical home is '@/components/cards/NotAvailable'.
export { NotAvailableValue };

const VALUE_CLASS = 'text-sm font-medium tabular-nums text-text-primary [overflow-wrap:anywhere]';

/**
 * Dejargon value: the number reads plainly — no per-row source tag (the card
 * footer attests the whole card). A value that carries a caveat keeps a quiet
 * dotted underline; hovering shows just that note.
 */
function DejargonValue({ cell }: { cell: CitationEnvelope }) {
  const caveat = cell.citation.caveat;
  if (caveat == null || caveat === '') {
    return <span className={VALUE_CLASS}>{cell.display}</span>;
  }
  return (
    <HoverCard.Root openDelay={120} closeDelay={80}>
      <HoverCard.Trigger asChild>
        <button
          type="button"
          aria-label={`${cell.display} — note`}
          className={cn(
            VALUE_CLASS,
            'cursor-help underline decoration-dotted decoration-text-tertiary underline-offset-4',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
        >
          {cell.display}
        </button>
      </HoverCard.Trigger>
      <HoverCard.Portal>
        <HoverCard.Content
          side="top"
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            'z-50 w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl border border-border-light bg-surface-chat p-3 shadow-xl',
            'text-[12px] leading-relaxed text-text-secondary',
            'data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
            'motion-reduce:animate-none',
          )}
        >
          {caveat}
        </HoverCard.Content>
      </HoverCard.Portal>
    </HoverCard.Root>
  );
}

function StatValue({ cell }: { cell: CitationEnvelope | undefined }) {
  const dejargon = useDejargon();
  if (!cell || !cell.available) {
    return <NotAvailableValue />;
  }
  if (dejargon) {
    return <DejargonValue cell={cell} />;
  }
  // Legacy: value and source share one line (wrapping only when the value is
  // long qualitative prose) — the dense fact-sheet read, not a stacked column.
  return (
    <span className="inline-flex flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
      <span className={VALUE_CLASS}>{cell.display}</span>
      <CitationPopover citation={cell.citation}>
        <SourceTag tier={cell.citation.tier}>{tierLabel(cell.citation.source)}</SourceTag>
      </CitationPopover>
    </span>
  );
}

export default function StatBlockCard({
  spec,
  variant = 'card',
}: {
  spec: RenderSpec;
  variant?: VizVariant;
}) {
  const dejargon = useDejargon();
  const isPanel = variant === 'panel';
  const school = spec.schools[0];
  const list = (
    <dl className={isPanel ? 'divide-y divide-border-light' : 'space-y-px'}>
      {spec.rows.map((row, i) => (
        <div
          key={`${row.label}-${i}`}
          className={cn(
            'flex items-start justify-between gap-4',
            isPanel ? 'py-2' : 'rounded-lg px-2 py-1.5 transition-colors hover:bg-surface-hover',
          )}
        >
          <dt className="text-sm text-text-secondary [overflow-wrap:anywhere]">{row.label}</dt>
          <dd className="min-w-0 text-right">
            <StatValue cell={row.cells[0]} />
          </dd>
        </div>
      ))}
    </dl>
  );

  // Provenance is attested once, in the header — not per row. The badge sits
  // top-right, aligned with the eyebrow; the inline (chat) card is where the
  // reassurance matters, so the roomier panel read skips it.
  // On card hover the ExpandToPanelButton fades in at the same top-right corner,
  // so the badge slides left to clear it instead of letting the two icons overlap.
  const verified =
    dejargon && !isPanel ? (
      <CounselleVerifiedBadge className="mt-0.5 shrink-0 transition-transform duration-150 ease-out group-hover/viz:-translate-x-8 motion-reduce:transition-none" />
    ) : null;

  // school is always present for a stat_block (one school × fields); guard for
  // the degenerate empty spec so a malformed payload degrades, never crashes.
  // The eyebrow (the descriptive remainder of the title, e.g. "Key facts") sits
  // above the school name in the live path. In dejargon mode the verified badge
  // takes that top-right corner, so the eyebrow is dropped to avoid competing.
  const header = school ? (
    <div className="flex items-start justify-between gap-3">
      <SchoolIdentity
        school={school}
        eyebrow={dejargon ? undefined : sectionLabel(spec.title, school.name)}
      />
      {verified}
    </div>
  ) : undefined;

  return (
    <VizFrame title={spec.title} header={header} variant={variant}>
      {list}
    </VizFrame>
  );
}
