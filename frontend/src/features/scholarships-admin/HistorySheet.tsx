import { ChevronLeft } from "lucide-react";
import { useState } from "react";

import { useScholarshipRevisions } from "@/api/scholarships/hooks";
import type { AdminScholarship, RevisionAction, RevisionOut, ScholarshipDraft } from "@/api/scholarships/types";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { Sheet, SheetHeader, SheetPopup, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { evaluateCriteria, summarizeFit } from "@/features/scholarships/eligibility";
import { ScholarshipDetail } from "@/features/scholarships/ScholarshipDetail";
import { EMPTY_FACTS, previewRecord } from "@/features/scholarships-admin/editor-draft";

const ACTION_LABEL: Record<RevisionAction, string> = {
  create: "Created",
  update: "Edited",
  publish: "Published",
  unpublish: "Unpublished",
  archive: "Archived",
  restore: "Restored",
  checked: "Marked checked",
};

const FIELD_LABEL: Record<string, string> = {
  name: "name",
  sponsor: "sponsor",
  summary: "summary",
  apply_url: "apply link",
  source_url: "source link",
  logo_url: "logo",
  award: "award",
  deadline: "deadline",
  basis: "basis",
  fields: "fields of study",
  eligibility: "eligibility",
  other_eligibility: "other eligibility",
  requirements: "requirements",
  last_checked_on: "last checked",
  status: "status",
};

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

function relativeTime(iso: string): string {
  const delta = new Date(iso).getTime() - Date.now();
  for (const [unit, ms] of UNITS) {
    if (Math.abs(delta) >= ms) return relative.format(Math.round(delta / ms), unit);
  }
  return "just now";
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A snapshot is plain JSON from any past version; only preview one with every key this view reads. */
function draftFromSnapshot(snapshot: Record<string, unknown>): ScholarshipDraft | null {
  const strings = ["name", "sponsor", "summary", "apply_url", "source_url", "logo_url", "status"];
  const lists = ["basis", "fields", "eligibility", "other_eligibility"];
  const ok =
    strings.every((key) => typeof snapshot[key] === "string") &&
    lists.every((key) => Array.isArray(snapshot[key])) &&
    isObject(snapshot.award) &&
    isObject(snapshot.deadline) &&
    isObject(snapshot.requirements) &&
    Array.isArray(snapshot.requirements.essays) &&
    (snapshot.last_checked_on === null || typeof snapshot.last_checked_on === "string");
  return ok ? (snapshot as unknown as ScholarshipDraft) : null;
}

function RevisionPreview({ revision, record }: { revision: RevisionOut; record: AdminScholarship }) {
  const draft = draftFromSnapshot(revision.snapshot);
  if (!draft) {
    return <p className="px-1 text-sm text-[var(--ink-muted)]">Can't preview this version.</p>;
  }
  const view = previewRecord(draft, record);
  return (
    <ScholarshipDetail
      criteria={evaluateCriteria(view, EMPTY_FACTS)}
      fit={summarizeFit(view, EMPTY_FACTS)}
      linkProfile={false}
      scholarship={view}
    />
  );
}

function RevisionRow({ revision, onOpen }: { revision: RevisionOut; onOpen: () => void }) {
  const changed = revision.action === "update" ? revision.changed.map((key) => FIELD_LABEL[key] ?? key) : [];
  return (
    <li>
      <button
        className="flex w-full flex-col gap-0.5 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[var(--surface-hover)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:outline-none"
        onClick={onOpen}
        type="button"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="text-sm font-medium text-[var(--ink)]">{ACTION_LABEL[revision.action]}</span>
          <span className="shrink-0 text-xs text-[var(--ink-muted)]">{relativeTime(revision.created_at)}</span>
        </span>
        <span className="truncate text-xs text-[var(--ink-secondary)]">{revision.actor_email ?? "Deleted user"}</span>
        {changed.length > 0 ? (
          <span className="text-xs text-[var(--ink-muted)]">Changed {changed.join(", ")}</span>
        ) : null}
      </button>
    </li>
  );
}

/** Read-only history of a record: who changed what, and what each version looked like. */
export function HistorySheet({
  record,
  open,
  onOpenChange,
}: {
  record: AdminScholarship;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const revisions = useScholarshipRevisions(record.id, open);
  const [selected, setSelected] = useState<number | null>(null);
  const current = revisions.data?.find((revision) => revision.version === selected) ?? null;

  let body;
  if (revisions.isError) {
    body = (
      <ErrorCard message="The history could not be loaded." onRetry={() => void revisions.refetch()} title="Could not load history" />
    );
  } else if (revisions.isPending) {
    body = (
      <div className="flex flex-col gap-2 px-3">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  } else if (current) {
    body = (
      <div className="flex flex-col gap-3">
        <Button className="self-start" onClick={() => setSelected(null)} size="sm" variant="ghost">
          <ChevronLeft aria-hidden="true" />
          {ACTION_LABEL[current.action]} · {relativeTime(current.created_at)}
        </Button>
        <RevisionPreview record={record} revision={current} />
      </div>
    );
  } else {
    body = (
      <ol className="flex flex-col gap-0.5">
        {revisions.data.map((revision) => (
          <RevisionRow key={revision.version} onOpen={() => setSelected(revision.version)} revision={revision} />
        ))}
      </ol>
    );
  }

  return (
    <Sheet
      onOpenChange={(next) => {
        if (!next) setSelected(null);
        onOpenChange(next);
      }}
      open={open}
    >
      <SheetPopup className="w-full max-w-lg overflow-y-auto" side="right">
        <SheetHeader>
          <SheetTitle>History</SheetTitle>
        </SheetHeader>
        <div className="px-3 pb-6">{body}</div>
      </SheetPopup>
    </Sheet>
  );
}
