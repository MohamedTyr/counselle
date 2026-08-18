import { FileText, Flag } from "lucide-react";

import { usePatchMetrics } from "@/api/cds-admin/hooks";
import type { ReviewMetric } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSyncedDraft } from "@/hooks/useSyncedDraft";
import { cn } from "@/lib/utils";
import { FlagChip } from "@/features/cds-admin/cds-status";
import {
  MetricEditor,
  type MetricEditPayload,
} from "@/features/cds-admin/review/MetricEditor";
import { useReviewControllerContext } from "@/features/cds-admin/review/review-context";
import {
  coerceMetricValue,
  isUnavailableValue,
  metricValueText,
} from "@/features/cds-admin/review/metric-display";

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
  const draft = useSyncedDraft(metricValueText(metric));
  const isEditing = controller.editingRef === metric.ref;
  const isEdited = draft.dirty || metric.pending_edit !== null;
  const unresolvedSeverity = metric.pending_edit
    ? null
    : metric.flags.some((f) => f.severity === "error")
      ? "error"
      : metric.flags.some((f) => f.severity === "warning")
        ? "warning"
        : null;

  function handleSave(payload: MetricEditPayload, opts: { andNext: boolean }) {
    draft.setValue(payload.rawValue || "—");
    controller.setEditingRef(null);
    patchMetrics.mutate(
      {
        documentId,
        body: {
          edits: [
            {
              metric_ref: metric.ref,
              domain_id: domainId,
              value: coerceMetricValue(metric, payload.rawValue),
              raw_value: payload.rawValue,
              availability_status: "reported",
              evidence: {
                page_number: payload.page ?? 1,
                excerpt: payload.excerpt,
              },
            },
          ],
        },
      },
      {
        onSuccess: () => {
          draft.commit();
          if (opts.andNext) controller.goToNextFlag();
        },
        onError: () => draft.revert(),
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

        {metric.evidence?.page_number != null ? (
          <Button
            aria-label={`Jump to page ${metric.evidence.page_number}`}
            onClick={() => controller.jumpEvidence(metric.evidence?.page_number)}
            size="xs"
            variant="ghost"
          >
            <FileText data-icon="inline-start" />p. {metric.evidence.page_number}
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
