import { MoreHorizontal, Plus, SearchX, TriangleAlert } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useReducedMotion } from "motion/react";
import { toast } from "sonner";

import {
  useAdminScholarships,
  useMarkChecked,
  useSetScholarshipStatus,
} from "@/api/scholarships/hooks";
import type { AdminScholarship, ScholarshipStatus } from "@/api/scholarships/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { ErrorCard } from "@/components/ui/error-card";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UndoToast } from "@/components/undo-toast/UndoToast";
import { PageContainer } from "@/components/workspace/PageContainer";
import { useUndoableDelete } from "@/hooks/useUndoableDelete";
import {
  awardCadence,
  awardHeadline,
  daysSince,
  deadlineTone,
  formatShortDate,
  isStale,
} from "@/features/scholarships/scholarship-format";
import { ScholarshipSearchField } from "@/features/scholarships/ScholarshipsToolbar";
import { SponsorLogo } from "@/features/scholarships/SponsorLogo";
import { STATUS_BADGE } from "@/features/scholarships-admin/status";

type StatusFilter = "all" | ScholarshipStatus;
const EDITOR_PATH = "/app/admin/scholarships";

/** What an admin should act on, in words. Archived records need nothing. */
function issuesFor(item: AdminScholarship): string[] {
  if (item.status === "archived") return [];
  const issues: string[] = [];
  if (deadlineTone(item.deadline) === "closed") {
    issues.push(
      item.deadline.recurs_annually
        ? "Needs next cycle's deadline"
        : "Deadline passed",
    );
  }
  if (item.last_checked_on === null) issues.push("Never checked");
  else if (isStale(item))
    issues.push(`Not checked in ${daysSince(item.last_checked_on)} days`);
  if (item.status === "draft" && (!item.apply_url || !item.summary))
    issues.push("Draft is incomplete");
  return issues;
}

/** Whole local calendar days since a timestamp. */
function localDaysSince(iso: string): number {
  const then = new Date(iso);
  const now = new Date();
  const startOf = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  return Math.round((startOf(now) - startOf(then)) / 86_400_000);
}

function relativeUpdated(iso: string): string {
  const days = localDaysSince(iso);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return formatShortDate(iso.slice(0, 10));
}

function DeadlineCell({ item }: { item: AdminScholarship }) {
  if (item.deadline.kind === "rolling")
    return <span className="text-[var(--ink-secondary)]">Rolling</span>;
  if (!item.deadline.date)
    return <span className="text-[var(--ink-muted)]">Not set</span>;
  const closed = deadlineTone(item.deadline) === "closed";
  return (
    <span
      className={
        closed
          ? "text-[var(--ink-muted)] line-through decoration-[var(--ink-faint)]"
          : "text-[var(--ink)]"
      }
    >
      {formatShortDate(item.deadline.date)}
    </span>
  );
}

function RowMenu({
  item,
  onArchive,
  onStatus,
  onMarkChecked,
}: {
  item: AdminScholarship;
  onArchive: () => void;
  onStatus: (status: ScholarshipStatus) => void;
  onMarkChecked: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={`Actions for ${item.name}`}
          onClick={(event) => event.stopPropagation()}
          size="icon-xs"
          variant="ghost"
        >
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-44"
        onClick={(event) => event.stopPropagation()}
      >
        <DropdownMenuItem asChild>
          <Link to={`${EDITOR_PATH}/${item.id}`}>Edit</Link>
        </DropdownMenuItem>
        {item.status === "published" ? (
          <DropdownMenuItem onSelect={() => onStatus("draft")}>
            Unpublish
          </DropdownMenuItem>
        ) : null}
        {item.status === "archived" ? (
          <DropdownMenuItem onSelect={() => onStatus("draft")}>
            Restore as draft
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onSelect={onMarkChecked}>
              Mark checked today
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={onArchive}>Archive</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function useArchiveWithUndo() {
  const setStatus = useSetScholarshipStatus();
  const previous = useRef(new Map<string, ScholarshipStatus>());
  const undoable = useUndoableDelete<AdminScholarship>({
    getLabel: (item) => item.name,
    archiveMutation: {
      mutate: (id, options) =>
        setStatus.mutate({ id, status: "archived" }, options),
      mutateAsync: (id) => setStatus.mutateAsync({ id, status: "archived" }),
    },
    restoreMutation: {
      mutate: (id) =>
        setStatus.mutate({ id, status: previous.current.get(id) ?? "draft" }),
    },
  });
  return {
    ...undoable,
    archive: (item: AdminScholarship) => {
      previous.current.set(item.id, item.status);
      undoable.archive(item);
    },
  };
}

export function AdminScholarshipsPage() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion() ?? false;
  const query = useAdminScholarships();
  const setStatus = useSetScholarshipStatus();
  const markChecked = useMarkChecked();
  const undoable = useArchiveWithUndo();
  const [q, setQ] = useState("");
  const [status, setStatusFilter] = useState<StatusFilter>("all");
  const [attentionOnly, setAttentionOnly] = useState(false);

  const items = useMemo(() => query.data ?? [], [query.data]);
  const counts = useMemo(() => {
    const by = (s: ScholarshipStatus) =>
      items.filter((item) => item.status === s).length;
    return {
      all: items.length,
      published: by("published"),
      draft: by("draft"),
      archived: by("archived"),
    };
  }, [items]);
  const attentionCount = items.filter(
    (item) => issuesFor(item).length > 0,
  ).length;

  const rows = items
    .filter((item) => status === "all" || item.status === status)
    .filter((item) => !attentionOnly || issuesFor(item).length > 0)
    .filter((item) => {
      const needle = q.trim().toLowerCase();
      return (
        !needle ||
        item.name.toLowerCase().includes(needle) ||
        item.sponsor.toLowerCase().includes(needle)
      );
    })
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return (
    <PageContainer
      actions={
        <Button render={<Link to={`${EDITOR_PATH}/new`} />} size="sm">
          <Plus aria-hidden="true" />
          New scholarship
        </Button>
      }
      overlay={
        <UndoToast
          onDismiss={undoable.clearPending}
          onUndo={undoable.undo}
          pending={
            undoable.pending
              ? { label: undoable.pending.label, kind: "archived" }
              : null
          }
          reduceMotion={reduceMotion}
        />
      }
      title="Scholarship admin"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <SegmentedControl
          label="Status"
          onValueChange={setStatusFilter}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "published", label: "Published", count: counts.published },
            { value: "draft", label: "Drafts", count: counts.draft },
            { value: "archived", label: "Archived", count: counts.archived },
          ]}
          value={status}
        />
        <button
          aria-pressed={attentionOnly}
          className={
            "inline-flex h-7 shrink-0 cursor-pointer items-center gap-1.5 self-start rounded-full border px-2.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] md:self-auto " +
            (attentionOnly
              ? "border-[var(--warning-border)] bg-[var(--warning-surface)] text-[var(--warning-fg)]"
              : "border-[var(--edge-control)] text-[var(--ink-secondary)] hover:border-[var(--edge-control-strong)]")
          }
          onClick={() => setAttentionOnly((value) => !value)}
          type="button"
        >
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          Needs attention
          <span className="tabular-nums">{attentionCount}</span>
        </button>
        <div className="md:ms-auto md:w-80">
          <ScholarshipSearchField onChange={setQ} value={q} />
        </div>
      </div>

      {query.isError ? (
        <ErrorCard
          message="The workspace could not reach the scholarship list."
          onRetry={() => void query.refetch()}
          title="Could not load scholarships"
        />
      ) : query.isPending ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : rows.length === 0 ? (
        <Empty className="rounded-xl border border-[var(--edge)] bg-[var(--surface-raised)] py-14">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SearchX />
            </EmptyMedia>
            <EmptyTitle>No scholarships match</EmptyTitle>
            <EmptyDescription>Try another status or search.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="overflow-hidden rounded-xl border border-[var(--edge)] bg-[var(--surface-raised)] shadow-[var(--elevation-1)]">
          <Table className="table-fixed">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-auto ps-4">Scholarship</TableHead>
                <TableHead className="hidden w-36 md:table-cell">
                  Amount
                </TableHead>
                <TableHead className="hidden w-28 sm:table-cell">
                  Deadline
                </TableHead>
                <TableHead className="w-56">Status</TableHead>
                <TableHead className="hidden w-32 lg:table-cell">
                  Last checked
                </TableHead>
                <TableHead className="hidden w-32 lg:table-cell">
                  Updated
                </TableHead>
                <TableHead className="w-12 pe-3">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((item) => {
                const issues = issuesFor(item);
                const badge = STATUS_BADGE[item.status];
                return (
                  <TableRow
                    className="cursor-pointer"
                    key={item.id}
                    onClick={() => void navigate(`${EDITOR_PATH}/${item.id}`)}
                  >
                    <TableCell className="py-3 ps-4">
                      <div className="flex min-w-0 items-center gap-3">
                        <SponsorLogo scholarship={item} size="sm" />
                        <div className="min-w-0">
                          <Link
                            className="block truncate font-medium text-[var(--ink)] outline-none hover:underline focus-visible:underline"
                            onClick={(event) => event.stopPropagation()}
                            to={`${EDITOR_PATH}/${item.id}`}
                          >
                            {item.name || "Untitled scholarship"}
                          </Link>
                          <span className="block truncate text-xs text-[var(--ink-muted)]">
                            {item.sponsor}
                          </span>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      <span className="block font-medium tabular-nums text-[var(--ink)]">
                        {awardHeadline(item.award)}
                      </span>
                      <span className="block text-xs text-[var(--ink-muted)]">
                        {awardCadence(item.award)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden tabular-nums sm:table-cell">
                      <DeadlineCell item={item} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Badge variant={badge.variant}>{badge.label}</Badge>
                        {issues.map((issue) => (
                          <span
                            className="flex items-center gap-1 text-xs text-[var(--warning-fg)]"
                            key={issue}
                          >
                            <TriangleAlert
                              aria-hidden="true"
                              className="size-3"
                            />
                            {issue}
                          </span>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="hidden text-[var(--ink-secondary)] tabular-nums lg:table-cell">
                      {item.last_checked_on === null ? "Never checked" : formatShortDate(item.last_checked_on)}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="block text-[var(--ink-secondary)]">
                        {relativeUpdated(item.updated_at)}
                      </span>
                      <span className="block text-xs text-[var(--ink-muted)]">
                        {item.updated_by_email}
                      </span>
                    </TableCell>
                    <TableCell className="pe-3 text-right">
                      <RowMenu
                        item={item}
                        onArchive={() => undoable.archive(item)}
                        onMarkChecked={() =>
                          markChecked.mutate(item.id, {
                            onSuccess: () => toast.success("Marked checked today"),
                          })
                        }
                        onStatus={(next) =>
                          setStatus.mutate({
                            id: item.id,
                            status: next,
                            expected_version: item.version,
                          })
                        }
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </PageContainer>
  );
}
