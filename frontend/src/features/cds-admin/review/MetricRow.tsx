import { FileText, Flag, History } from "lucide-react";
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
function priorEditState(metric: ReviewMetric): {
  value: unknown;
  raw_value: string | null;
  page_number: number | null;
  excerpt: string;
} {
  const source = metric.pending_edit ?? metric;
  return {
    value: source.value,
    raw_value: source.raw_value,
    // `null`, never a default page: a citation this row never had must not be
    // invented on the way back out through Undo (§5.8's honesty rule).
    page_number: source.evidence?.page_number ?? null,
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
  // Only true right after *this session's* Re-run swept this exact metric's
  // edit (`review-context.tsx`'s `supersededRefs` doc comment) — cleared the
  // moment a fresh edit exists again, so it can never contradict what's on
  // screen.
  const isSuperseded =
    metric.pending_edit === null && controller.supersededRefs.has(metric.ref);

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
    if (prior.page_number === null) return; // guarded by `canUndo`
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
    // and fail. Only offer it when the prior state is a complete citation.
    const prior = priorEditState(metric);
    const canUndo = prior.excerpt.trim().length > 0 && prior.page_number !== null;
    controller.setEditingRef(null);
    submitEdit(
      {
        value: coerceMetricValue(metric, payload.rawValue),
        raw_value: payload.rawValue,
        // `payload.page` is a real number: `MetricEditor` blocks Save until
        // the admin supplies one. It used to fall back to page 1, recording a
        // citation pointing at a page the value never came from.
        evidence: { page_number: payload.page, excerpt: payload.excerpt },
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
    <div className="rounded-md border-b transition-colors last:border-b-0 focus-within:bg-[var(--surface-active)]">
      {/* The evidence column is a fixed track (not `auto`): with three
          independent per-row grids sharing no template, an `auto` evidence
          column collapses to ~0 on rows with no citation, which pulls the
          value column's right edge in after it — a document mixing cited
          and uncited rows reads as a ragged column of numbers instead of
          one you can scan down. Pinning the width means the value's right
          edge lands at the same x on every row regardless of whether this
          one has a page chip (§5.6, "compared numbers want tabular
          numerics"). */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_5rem] items-center gap-3 py-1.5 text-sm">
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
          // Registered and focusable here too, even though there's nothing to
          // edit: `focusMetric` scrolls and focuses through `registerMetricRef`,
          // so without it n/p and j/k silently do nothing on an approved
          // document — the read-only screen is exactly where an admin walks the
          // flags to decide whether a correction is needed. `tabIndex={-1}`
          // keeps it out of the Tab order while still being focusable.
          <span
            className={cn(
              "px-1 text-right outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              isUnavailableValue(metric) && "text-muted-foreground",
              !isUnavailableValue(metric) && "font-medium tabular-nums",
            )}
            onFocus={() => controller.reportFocus(metric.ref)}
            ref={(el) => controller.registerMetricRef(metric.ref, el)}
            tabIndex={-1}
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

      {isSuperseded && (
        <div className="flex items-start gap-2 pb-1.5 pl-6 text-xs text-muted-foreground">
          <History aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>
            Superseded by re-extraction — the value shown is from the new
            run, not your edit.
          </span>
        </div>
      )}

      {saveError && (
        <p className="pb-1.5 pl-6 text-xs text-destructive" role="alert">
          {saveError}
        </p>
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
