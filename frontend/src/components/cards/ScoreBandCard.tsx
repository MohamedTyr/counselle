/**
 * ScoreBandCard — the SAT/ACT middle-50% band (PRD story 33; semantics ported
 * from the retired MVP1 harness's buildScoreBand).
 *
 * Per VizRow: cells[0] = 25th percentile, cells[1] = 75th. Sections render
 * as SEPARATE rows — a combined 1600 is never rendered or computed, full
 * stop. ACT rows scale 1–36; SAT sections 200–800. The teaching caption is
 * PERMANENT — rendered unconditionally at the card bottom.
 */
import type { CitationEnvelope, RenderSpec, ScoreBand, VizRow } from '@/api/protocol';
import VizFrame from '@/components/cards/VizFrame';
import type { VizVariant } from '@/components/cards/vizVariant';

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

function BandRow({ row, band }: { row: VizRow; band: ScoreBand | null | undefined }) {
  const p25Cell = row.cells[0];
  const p75Cell = row.cells[1];

  if (!p25Cell?.available && !p75Cell?.available) {
    return (
      <div className="py-2">
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

  return (
    <div className="py-2">
      <div className="text-sm text-text-secondary">{row.label}</div>
      <div className="relative mt-1.5 h-2 rounded-full bg-surface-hover">
        <div
          className="absolute top-0 h-2 rounded-full border border-[var(--official-border)] bg-[var(--official-surface)]"
          style={{ left: `${leftPct.toFixed(1)}%`, width: `${widthPct.toFixed(1)}%` }}
          aria-hidden="true"
        />
      </div>
      <div className="relative mt-1 h-4 text-xs tabular-nums text-[var(--official-text)]">
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
  return (
    <VizFrame title={spec.title} schools={spec.schools} variant={variant}>
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
