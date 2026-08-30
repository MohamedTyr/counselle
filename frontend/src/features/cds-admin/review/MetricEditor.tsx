import { type KeyboardEvent, useState } from "react";

import type { ReviewMetric } from "@/api/cds-admin/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface MetricEditPayload {
  rawValue: string;
  /** Always a real page: Save stays disabled until the admin supplies one, so
   * no caller has to invent a fallback (§5.8's honesty rule). */
  page: number;
  excerpt: string;
}

/** The inline editor a metric row expands into (DESIGN.md §5.8) — never a
 * modal or popover, so the left pane stays visible. Page + excerpt are
 * required alongside the value: the honesty rule made physical — a
 * corrected value must carry its own evidence, because the backend records
 * it as a new `human-review-v1` packet with real provenance. */
export function MetricEditor({
  metric,
  onSave,
  onCancel,
  saving,
}: {
  metric: ReviewMetric;
  onSave: (payload: MetricEditPayload, opts: { andNext: boolean }) => void;
  onCancel: () => void;
  saving: boolean;
}) {
  // A pending edit is what will actually be approved — prefill from it, not
  // the original extraction, so reopening the editor can't invite the admin
  // to unknowingly overwrite their own correction with the stale original.
  const source = metric.pending_edit ?? metric;
  const [value, setValue] = useState(
    source.raw_value ?? (source.value != null ? String(source.value) : ""),
  );
  const [page, setPage] = useState(
    source.evidence?.page_number != null
      ? String(source.evidence.page_number)
      : "",
  );
  const [excerpt, setExcerpt] = useState(source.evidence?.excerpt ?? "");
  const excerptEmpty = excerpt.trim().length === 0;
  // The page is required on exactly the same terms as the excerpt (§5.8's
  // honesty rule): an excerpt is a claim about a *specific page*, so half of
  // that citation cannot be optional. Blank used to submit `null`, which
  // `MetricRow` turned into page 1 — a citation pointing somewhere the value
  // never came from.
  const pageEmpty = !Number.isFinite(Number(page.trim())) || page.trim() === "";
  const invalid = excerptEmpty || pageEmpty;

  function submit(andNext: boolean) {
    if (invalid || saving) return;
    onSave({ rawValue: value, page: Number(page.trim()), excerpt }, { andNext });
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>,
    allowShiftNewline: boolean,
  ) {
    if (event.key === "Escape") {
      event.preventDefault();
      onCancel();
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit(true);
      return;
    }
    if (event.key === "Enter" && !(allowShiftNewline && event.shiftKey)) {
      event.preventDefault();
      submit(false);
    }
  }

  return (
    <div className="mt-1.5 space-y-2 rounded-lg border bg-card p-3">
      <Input
        aria-label={`${metric.title} value`}
        autoFocus
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => handleKeyDown(event, false)}
        value={value}
      />
      <div className="space-y-1">
        <Input
          aria-label="Evidence page number"
          className="w-20 tabular-nums"
          onChange={(event) => setPage(event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, false)}
          placeholder="Page"
          value={page}
        />
        {pageEmpty && (
          <p className="text-xs text-destructive">A page number is required.</p>
        )}
      </div>
      <div className="space-y-1">
        <Textarea
          aria-label="Evidence excerpt"
          onChange={(event) => setExcerpt(event.target.value)}
          onKeyDown={(event) => handleKeyDown(event, true)}
          rows={2}
          value={excerpt}
        />
        <p className="text-xs text-muted-foreground">
          What the document actually says on page {page || "—"}.
        </p>
        {excerptEmpty && (
          <p className="text-xs text-destructive">An excerpt is required.</p>
        )}
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            disabled={invalid || saving}
            loading={saving}
            onClick={() => submit(false)}
            size="sm"
          >
            Save
          </Button>
          <Button onClick={onCancel} size="sm" variant="ghost">
            Cancel
          </Button>
        </div>
        <span className="text-xs text-muted-foreground">
          ⌘↵ save &amp; next flag
        </span>
      </div>
    </div>
  );
}
