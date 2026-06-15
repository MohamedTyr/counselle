/**
 * ScoreBandCard — the SAT/ACT middle-50% band (PRD story 33; semantics ported
 * from the retired MVP1 harness's buildScoreBand).
 *
 * Per VizRow: cells[0] = 25th percentile, cells[1] = 75th. Sections render
 * as SEPARATE rows — a combined 1600 is never rendered or computed, full
 * stop. ACT rows scale 1–36; SAT sections 200–800. The teaching caption is
 * PERMANENT — rendered unconditionally at the card bottom.
 *
 * The test is the subject, so the title leads and the schools annotate it as
 * compact logo chips (SchoolChip), not a logo-led identity. Each band carries
 * its source as a quiet SourceTag on the label line — the same tap-to-cite
 * grammar as the other cards, so a number on a bar is as honest as one in a row.
 */
import type { Citation, CitationEnvelope, RenderSpec, ScoreBand, VizRow } from '@/api/protocol';
import SchoolChip from '@/components/cards/SchoolChip';
import VizFrame from '@/components/cards/VizFrame';
import type { VizVariant } from '@/components/cards/vizVariant';
import CitationPopover from '@/components/citations/CitationPopover';
import SourceTag from '@/components/citations/SourceTag';
import { tierLabel } from '@/components/citations/TierChip';

const ACT_SCALE = { min: 1, max: 36 };
const SAT_SECTION_SCALE = { min: 200, max: 800 };

const TEACHING_CAPTION = "Half of enrolled students scored inside this band. It's not a cutoff.";

function inferScale(band: ScoreBand | null | undefined, rowLabel: string) {
  const isAct = band?.test === 'act' || rowLabel.toLowerCase().includes('act');
  return isAct ? ACT_SCALE : SAT_SECTION_SCALE;
}

function endLabel(cell: CitationEnvelope | undefined): string {
  return cell?.available ? cell.display : '—';
}

/** The band's source: prefer the 25th-percentile cell, fall back to the 75th —
 *  both ends of one band share a provenance, so one chip cites the row. */
function rowCitation(p25: CitationEnvelope | undefined, p75: CitationEnvelope | undefined) {
  const cell = p25?.available ? p25 : p75?.available ? p75 : undefined;
  return cell?.citation;
}

function RowLabel({ label, citation }: { label: string; citation?: Citation }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-sm text-text-secondary [overflow-wrap:anywhere]">{label}</span>
      {citation && (
        <CitationPopover citation={citation}>
          <SourceTag tier={citation.tier}>{tierLabel(citation.source)}</SourceTag>
        </CitationPopover>
      )}
    </div>
  );
}

function BandRow({ row, band }: { row: VizRow; band: ScoreBand | null | undefined }) {
  const p25Cell = row.cells[0];
  const p75Cell = row.cells[1];

  if (!p25Cell?.available && !p75Cell?.available) {
    return (
      <div className="py-2.5">
        <div className="text-sm text-text-secondary">{row.label}</div>
        <div className="mt-1 text-sm italic text-text-secondary underline decoration-dashed underline-offset-4">
          not reported
        </div>
      </div>
    );
  }

  const scale = inferScale(band, row.label);
  const range = scale.max - scale.min;
  const p25 = Number(p25Cell?.raw ?? scale.min);
  const p75 = Number(p75Cell?.raw ?? scale.max);
  const leftPct = ((p25 - scale.min) / range) * 100;
  const widthPct = Math.max(((p75 - p25) / range) * 100, 1);
  const citation = rowCitation(p25Cell, p75Cell);

  return (
    <div className="py-2.5">
      <RowLabel label={row.label} citation={citation} />
      <div className="relative mt-2 h-2 rounded-full bg-surface-hover">
        {/* The middle-50% region: a clearly legible official-blue fill (the faint
            surface tint reads as empty against the track), endpoints ringed. */}
        <div
          className="absolute top-0 h-2 rounded-full bg-[var(--official-border)] ring-1 ring-inset ring-[var(--official-text)]/40"
          style={{ left: `${leftPct.toFixed(1)}%`, width: `${widthPct.toFixed(1)}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="relative mt-1 h-4 text-xs font-medium tabular-nums text-[var(--official-text)]">
        <span className="absolute -translate-x-1/2" style={{ left: `${leftPct.toFixed(1)}%` }}>
          {endLabel(p25Cell)}
        </span>
        <span
          className="absolute -translate-x-1/2"
          style={{ left: `${(leftPct + widthPct).toFixed(1)}%` }}
        >
          {endLabel(p75Cell)}
        </span>
      </div>
    </div>
  );
}

export default function ScoreBandCard({
  spec,
  variant = 'card',
}: {
  spec: RenderSpec;
  variant?: VizVariant;
}) {
  const header = (
    <>
      <h3 className="text-sm font-semibold text-text-primary [overflow-wrap:anywhere]">
        {spec.title}
      </h3>
      {spec.schools.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
          {spec.schools.map((school) => (
            <SchoolChip key={school.unitid} school={school} />
          ))}
        </div>
      )}
    </>
  );

  return (
    <VizFrame title={spec.title} header={header} variant={variant}>
      <div className="divide-y divide-border-light">
        {spec.rows.map((row, i) => (
          <BandRow key={`${row.label}-${i}`} row={row} band={spec.band} />
        ))}
      </div>
      {/* PERMANENT teaching caption — never conditional (PRD story 33). */}
      <div className="mt-3 border-t border-border-light pt-2 text-xs text-text-secondary">
        {TEACHING_CAPTION}
      </div>
    </VizFrame>
  );
}
