import type { PendingEditOut, ReviewMetric } from "@/api/cds-admin/types";

/** A pending edit's own display text — it carries no server-computed
 * `display` string (only `value`/`raw_value`, mirroring
 * `counselle.cds_pending_edits`), so this mirrors the same `raw_value ??
 * String(value)` fallback `MetricEditor` uses for the original metric. */
export function pendingEditValueText(edit: PendingEditOut): string {
  return edit.raw_value ?? (edit.value != null ? String(edit.value) : "—");
}

/**
 * The value slot's text when there's no formatted `display` string
 * (§5.6 — "availability is text, not a badge"). `display` is already
 * `null` unless `extraction_status === "verified"` and
 * `availability_status === "reported"`
 * (`app/cds/service_review.py::_display_value`); everything else needs a
 * muted-word explanation of *why* it's blank, mirroring
 * `domain/cds/claims.py`'s availability/extraction status enums.
 */
export function metricValueText(metric: ReviewMetric): string {
  if (metric.display !== null) return metric.display;
  switch (metric.extraction_status) {
    case "conflict":
      return "Conflict";
    case "invalid":
      return "Invalid";
    case "not_extracted":
      return "Not extracted";
    default:
      break;
  }
  switch (metric.availability_status) {
    case "not_reported":
      return "Not reported";
    case "not_applicable":
      return "Not applicable";
    case "suppressed":
      return "Suppressed";
    case "not_in_template_version":
      return "Not in this year's template";
    default:
      return "—";
  }
}

/** The row's displayed value (§5.6): a pending edit is what will actually
 * be approved, so it takes priority over the original extracted value —
 * the row must never show a value that isn't what Approve will commit. */
export function metricDisplayValueText(metric: ReviewMetric): string {
  if (metric.pending_edit) return pendingEditValueText(metric.pending_edit);
  return metricValueText(metric);
}

/** Whether the value slot should render as a plain (non-editable-looking)
 * word rather than a button-that-looks-like-text — still click-to-edit
 * (any field may be corrected regardless of its extraction state), but the
 * `metric.display === null` case reads as prose, not data. A pending edit
 * always carries `availability_status: "reported"` (`MetricRow.handleSave`),
 * so it's never "unavailable" even when the original extraction was. */
export function isUnavailableValue(metric: ReviewMetric): boolean {
  if (metric.pending_edit) return false;
  return metric.display === null;
}

/** Best-effort typed coercion of the editor's free-text value field, for
 * `MetricEditIn.value` (the wire's `raw_value` always carries the exact
 * text the admin typed, unconverted). The manifest's `enum` metric type has
 * no options list on the wire (`config/cds/domains/*.yaml` defines `type:
 * enum` with no `values:`/`options:` key, and `ReviewMetric` doesn't carry
 * one either) — there's nothing to validate an enum edit against, so it's
 * treated as free text like `string`. */
export function coerceMetricValue(metric: ReviewMetric, raw: string): unknown {
  const trimmed = raw.trim();
  if (metric.type === "boolean") {
    const normalized = trimmed.toLowerCase();
    if (["yes", "true", "y"].includes(normalized)) return true;
    if (["no", "false", "n"].includes(normalized)) return false;
    return null;
  }
  if (metric.type === "number" || metric.type === "integer") {
    const parsed = Number(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : trimmed;
  }
  return trimmed;
}
