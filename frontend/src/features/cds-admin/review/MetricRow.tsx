import { FileText, Flag } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { usePatchMetrics } from "@/api/cds-admin/hooks";
import { isTransportError } from "@/api/http/errors";
import type { MetricEditIn, ReviewMetric } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";
import { cn } from "@/lib/utils";
import { FlagChip } from "@/features/cds-admin/cds-status";
import { metricFlagSeverity } from "@/features/cds-admin/review/flag-queue";
import {
  MetricEditor,
  type MetricEditPayload,
} from "@/features/cds-admin/review/MetricEditor";
import { useReviewControllerContext } from "@/features/cds-admin/review/review-context";
import {
  coerceMetricValue,
  isUnavailableValue,
  metricDisplayValueText,
} from "@/features/cds-admin/review/metric-display";

/** The pre-edit state to restore on Undo — the pending edit's own value
 * when one already existed, otherwise the original extraction. Captured
 * before the optimistic `draft.setValue` so Undo always reverts to what
 * was actually on screen a moment ago. */
function priorEditState(metric: ReviewMetric): MetricEditIn["evidence"] & {
  value: unknown;
  raw_value: string | null;
} {
  const source = metric.pending_edit ?? metric;
  return {
    value: source.value,
    raw_value: source.raw_value,
    page_number: source.evidence?.page_number ?? 1,
    excerpt: source.evidence?.excerpt ?? "",
  };
}

/** One metric row (§5.6) — a 28px resting line that expands in place into
 * the click-to-edit form. `useSyncedDraft` carries the row's optimistic
 * display value: `setValue` fires at Save (before the network completes,
 * so the row updates immediately and dims via `opacity-64` while the
 * request is in flight — §1.8's "saving" row), `commit` on success once
 * the fresh server value has landed in the query cache, `revert` on
 * failure. */
export function MetricRow({
  metric,
  domainId,
  documentId,
  readOnly,
}: {
  metric: ReviewMetric;
  domainId: string;
  documentId: number;
  readOnly: boolean;
}) {
  const controller = useReviewControllerContext();
  const patchMetrics = usePatchMetrics();
  const draft = useSyncedDraft(metricDisplayValueText(metric));
  const [saveError, setSaveError] = useState<string | null>(null);
  const isEditing = controller.editingRef === metric.ref;
  const isEdited = draft.dirty || metric.pending_edit !== null;
  const unresolvedSeverity = metricFlagSeverity(metric);
  // A pending edit's own evidence is what Approve will actually commit —
  // the "jump to page" link must point there too, not the stale original
  // extraction's page, or an admin can be sent to the wrong page for a
  // value they already corrected.
  const displayEvidence = metric.pending_edit?.evidence ?? metric.evidence;

  function submitEdit(
    edit: { value: unknown; raw_value: string | null; evidence: MetricEditIn["evidence"] },
    optimisticText: string,
    onSaved: () => void,
  ) {
    setSaveError(null);
    draft.setValue(optimisticText);
    patchMetrics.mutate(
      {
        documentId,
        body: {
          edits: [
            {
              metric_ref: metric.ref,
              domain_id: domainId,
              value: edit.value,
              raw_value: edit.raw_value,
              availability_status: "reported",
              evidence: edit.evidence,
            },
          ],
        },
      },
      {
        onSuccess: () => {
          draft.commit();
          onSaved();
        },
        onError: (error) => {
          draft.revert();
          setSaveError(
            isTransportError(error) ? error.message : "That edit was rejected.",
          );
        },
      },
    );
  }

  function handleUndo() {
    const prior = priorEditState(metric);
    submitEdit(
      {
        value: prior.value,
        raw_value: prior.raw_value,
        evidence: { page_number: prior.page_number, excerpt: prior.excerpt },
      },
      prior.raw_value ?? (prior.value != null ? String(prior.value) : "—"),
      () => {},
    );
  }

  function handleSave(payload: MetricEditPayload, opts: { andNext: boolean }) {
    // Undo re-submits the prior state through this same PATCH, and the
    // backend requires a non-empty excerpt on every edit (`EvidenceIn`,
    // `min_length=1`). When this is the metric's first-ever edit and it
    // started with no evidence at all, there is nothing honest to put in
    // that field — offering Undo here would submit a fabricated excerpt
    // and fail. Only offer it when the prior state actually has one.
    const canUndo = priorEditState(metric).excerpt.trim().length > 0;
    controller.setEditingRef(null);
    submitEdit(
      {
        value: coerceMetricValue(metric, payload.rawValue),
        raw_value: payload.rawValue,
        evidence: { page_number: payload.page ?? 1, excerpt: payload.excerpt },
      },
      payload.rawValue || "—",
      () => {
        if (opts.andNext) controller.goToNextFlag();
        toast.success(`${metric.title} updated.`, {
          action: canUndo ? { label: "Undo", onClick: handleUndo } : undefined,
        });
      },
    );
  }

  return (
    <div className="border-b last:border-b-0">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-1.5 text-sm">
        <Tooltip>
          <TooltipTrigger className="flex min-w-0 items-center gap-1.5 text-left">
            {unresolvedSeverity && (
              <Flag
                aria-hidden="true"
                className={cn(
                  "size-3.5 shrink-0",
                  unresolvedSeverity === "error"
                    ? "text-destructive"
                    : "text-warning",
                )}
              />
            )}
            {isEdited && (
              <span
                aria-hidden="true"
                className="size-1.5 shrink-0 rounded-full bg-warning"
              />
            )}
            <span className="truncate text-muted-foreground">{metric.title}</span>
          </TooltipTrigger>
          <TooltipContent>
            {metric.description ?? metric.title}
          </TooltipContent>
        </Tooltip>

        {readOnly ? (
          <span
            className={cn(
              "px-1 text-right",
              isUnavailableValue(metric) && "text-muted-foreground",
              !isUnavailableValue(metric) && "font-medium tabular-nums",
            )}
          >
            {draft.value}
          </span>
        ) : (
          <button
            aria-label={`Edit ${metric.title}, currently ${draft.value}`}
            className={cn(
              "-mx-1 rounded-sm px-1 text-right outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isUnavailableValue(metric) && "text-muted-foreground",
              !isUnavailableValue(metric) && "font-medium tabular-nums",
              patchMetrics.isPending && "opacity-64",
            )}
            onClick={() => controller.setEditingRef(metric.ref)}
            onFocus={() => controller.reportFocus(metric.ref)}
            ref={(el) => controller.registerMetricRef(metric.ref, el)}
            type="button"
          >
            {draft.value}
          </button>
        )}

        {displayEvidence?.page_number != null ? (
          <Button
            aria-label={`Jump to page ${displayEvidence.page_number}`}
            onClick={() => controller.jumpEvidence(displayEvidence?.page_number)}
            size="xs"
            variant="ghost"
          >
            <FileText data-icon="inline-start" />p. {displayEvidence.page_number}
          </Button>
        ) : (
          <span />
        )}
      </div>

      {metric.flags.map((flag) => (
        <div
          className={cn(
            "flex items-start gap-2 pb-1.5 pl-6 text-xs",
            metric.pending_edit && "opacity-64",
          )}
          key={flag.code}
        >
          <FlagChip code={flag.code} severity={flag.severity} />
          <span className="text-muted-foreground">{flag.message}</span>
        </div>
      ))}

      {saveError && (
        <p className="pb-1.5 pl-6 text-xs text-destructive">{saveError}</p>
      )}

      {isEditing && !readOnly && (
        <MetricEditor
          metric={metric}
          onCancel={() => controller.setEditingRef(null)}
          onSave={handleSave}
          saving={patchMetrics.isPending}
        />
      )}
    </div>
  );
}
