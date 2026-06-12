/**
 * FE-4 — one timeline step row: kind icon (tier-colored), human label, state
 * mark (shimmer while active / check at end / x on error), and a tap-to-expand
 * receipt panel showing the StepDetail fields that exist (PRD story 15 —
 * "full transparency one tap deep"). A real <button> — keyboard accessible.
 */
import { useId, useState } from 'react';
import { Check, X } from 'lucide-react';
import type { StepData, StepDetail } from '@/api/protocol';
import { cn } from '~/utils';
import { formatDurationMs, iconFor, tierTextClass } from './stepMeta';

type ReceiptField = { label: string; value: string; mono: boolean };

function receiptFields(detail: StepDetail): ReceiptField[] {
  const fields: ReceiptField[] = [];
  if (detail.query !== undefined) {
    fields.push({ label: 'query', value: `“${detail.query}”`, mono: true });
  }
  if (detail.tool !== undefined) {
    fields.push({ label: 'tool', value: detail.tool, mono: true });
  }
  if (detail.domains !== undefined && detail.domains.length > 0) {
    fields.push({ label: 'domains', value: detail.domains.join(', '), mono: false });
  }
  if (detail.field_keys !== undefined && detail.field_keys.length > 0) {
    fields.push({ label: 'fields', value: detail.field_keys.join(', '), mono: true });
  }
  if (detail.result_count !== undefined) {
    fields.push({ label: 'results', value: String(detail.result_count), mono: false });
  }
  if (detail.row_count !== undefined) {
    fields.push({ label: 'rows', value: String(detail.row_count), mono: false });
  }
  if (detail.duration_ms !== undefined) {
    fields.push({ label: 'took', value: formatDurationMs(detail.duration_ms), mono: false });
  }
  return fields;
}

function StatusMark({ status }: { status: StepData['status'] }) {
  if (status === 'end') {
    return <Check className="h-3.5 w-3.5 shrink-0 text-text-secondary" aria-label="done" />;
  }
  if (status === 'error') {
    return <X className="h-3.5 w-3.5 shrink-0 text-red-500/80" aria-label="failed" />;
  }
  // Active ('start') — the shimmer carries the state; no mark.
  return null;
}

export default function StepRow({ step }: { step: StepData }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const Icon = iconFor(step.kind);
  const fields = step.detail !== null ? receiptFields(step.detail) : [];

  return (
    <div className="w-full">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        className={cn(
          'flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-surface-hover',
          step.status === 'start' && 'counselle-step-active',
        )}
      >
        <Icon className={cn('h-4 w-4 shrink-0', tierTextClass(step.tier))} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-sm text-text-primary">{step.label}</span>
        <StatusMark status={step.status} />
      </button>
      {open && (
        <div
          id={panelId}
          className="ml-7 mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-md px-1.5 py-1 text-xs text-text-secondary"
        >
          {fields.length === 0 && <span className="col-span-2">No receipt yet.</span>}
          {fields.map((f) => (
            <span key={f.label} className="contents">
              <span>{f.label}</span>
              <span className={cn('break-words', f.mono && 'font-mono')}>{f.value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
