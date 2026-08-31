import type {
  FlagsSummary,
  ReviewFlagOut,
  ReviewMetric,
  ReviewSection,
} from "@/api/cds-admin/types";

/**
 * The flag-queue logic behind DESIGN.md §5.1/§5.9 — "a flag queue, not a
 * document." A flag is unresolved when its metric carries no pending edit
 * (mirrors `app/cds/service_review.py::_flags_summary`: a metric with a
 * pending edit is treated as addressed). `sections` is trusted to already
 * be in CDS letter order (the wire's order — see `review-order.ts`).
 */

export function hasUnresolvedFlag(metric: ReviewMetric): boolean {
  return metric.pending_edit === null && metric.flags.length > 0;
}

/** Highest flag severity on a metric, or `null` when it has none / is
 * resolved. Drives the leading `Flag` icon colour on the label (§5.6). */
export function metricFlagSeverity(
  metric: ReviewMetric,
): ReviewFlagOut["severity"] | null {
  if (!hasUnresolvedFlag(metric)) return null;
  return metric.flags.some((flag) => flag.severity === "error")
    ? "error"
    : "warning";
}

/** "Flagged first" (§5.5) reorders a section's rows without touching
 * anything else — a stable partition, not a full re-sort. */
export function sortMetricsFlaggedFirst(
  metrics: readonly ReviewMetric[],
  flaggedFirst: boolean,
): ReviewMetric[] {
  if (!flaggedFirst) return [...metrics];
  const flagged: ReviewMetric[] = [];
  const rest: ReviewMetric[] = [];
  for (const metric of metrics) {
    (hasUnresolvedFlag(metric) ? flagged : rest).push(metric);
  }
  return [...flagged, ...rest];
}

/** Flat, ordered list of every metric carrying an unresolved flag, across
 * *every* section regardless of accordion open/closed state — `n`/`p`
 * walks this list and opens whatever section it needs to. Order matches
 * what's on screen once every section is expanded with the same
 * `flaggedFirst` sort. */
export function buildFlagQueue(
  sections: readonly ReviewSection[],
  flaggedFirst: boolean,
): ReviewMetric[] {
  const queue: ReviewMetric[] = [];
  for (const section of sections) {
    for (const metric of sortMetricsFlaggedFirst(section.metrics, flaggedFirst)) {
      if (hasUnresolvedFlag(metric)) queue.push(metric);
    }
  }
  return queue;
}

/** Domain ids that should start expanded on load: any section carrying an
 * unresolved flag (§5.1.3 — everything else starts collapsed). */
export function sectionsWithUnresolvedFlags(
  sections: readonly ReviewSection[],
): string[] {
  return sections
    .filter((section) => section.metrics.some(hasUnresolvedFlag))
    .map((section) => section.domain_id);
}

/** Metrics carrying at least one flag, resolved or not — the metric-count
 * denominator the flag bar's "N to review of M" line needs. `toReview`
 * (`buildFlagQueue().length`, what this counts the unresolved subset of) is
 * a count of *metrics*; `flags_summary.total` (`service_review._flags_summary`)
 * is a count of *flags*, and the two diverge whenever a metric carries more
 * than one — `excerpt_on_cited_page` and `corrupt_text_layer` independently
 * flag the same ref (`domain/cds/validators.py`), so a 20-metric,
 * 25-flag document previously rendered "20 to review of 25", reading as
 * five already handled when zero were. Pairing `toReview` with this instead
 * keeps both sides of the sentence the same unit. */
export function countFlaggedMetrics(sections: readonly ReviewSection[]): number {
  let count = 0;
  for (const section of sections) {
    for (const metric of section.metrics) {
      if (metric.flags.length > 0) count += 1;
    }
  }
  return count;
}

/** Pending-edit count across the whole document, for the approve bar's
 * "Ready to approve · N pending edits" sentence (§5.10). */
export function countPendingEdits(sections: readonly ReviewSection[]): number {
  let count = 0;
  for (const section of sections) {
    for (const metric of section.metrics) {
      if (metric.pending_edit !== null) count += 1;
    }
  }
  return count;
}

/** Unresolved-flag count for one section's header (§5.6). */
export function countSectionUnresolved(section: ReviewSection): number {
  return section.metrics.filter(hasUnresolvedFlag).length;
}

/** The section header's 2px rail colour (§5.6): `error` beats `warning`
 * beats neutral, considering only *unresolved* flags. */
export function sectionRailSeverity(
  section: ReviewSection,
): "error" | "warning" | null {
  let sawWarning = false;
  for (const metric of section.metrics) {
    const severity = metricFlagSeverity(metric);
    if (severity === "error") return "error";
    if (severity === "warning") sawWarning = true;
  }
  return sawWarning ? "warning" : null;
}

/** A flag with no `metric_ref` (a document/cross-domain check) is never
 * attached to any row — `ReviewSection.metrics[].flags` structurally can't
 * carry it (`service_review.py` keys flags by `metric_ref`, and a `None`
 * key matches no metric). The backend's `flags_summary.unresolved` still
 * counts it, so it can outrun what this queue can ever enumerate. This is
 * the gap between the two — surfaced in the "Approve anyway" dialog as an
 * honest "N more not shown here" rather than silently under-counting. */
export function hiddenUnresolvedCount(
  sections: readonly ReviewSection[],
  flagsSummary: FlagsSummary,
): number {
  const visible = buildFlagQueue(sections, false).length;
  return Math.max(0, flagsSummary.unresolved - visible);
}
