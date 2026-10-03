// The card a deadline chip opens (plan P5.6). A deadline is a fact, so a card
// is enough: whose it is, which round, the date, where the date came from, and
// the one or two things worth doing next.
import { CalendarPlus, Plus } from "lucide-react";
import { Link } from "react-router";

import type { SchoolDeadlineItem } from "@/api/calendar/types";
import type { ApplicationView } from "@/api/workspace/types";
import { Button } from "@/components/ui/button";
import { useCalendarContext } from "@/features/calendar/calendar-context";
import {
  formatDayLabel,
  formatRelativeDay,
} from "@/features/calendar/calendar-grid";
import {
  calendarRoundLabel,
  getItemState,
  schoolFieldLabel,
  type CalendarItem,
} from "@/features/calendar/calendar-items";
import { formatCycle } from "@/features/calendar/calendar-labels";
import { canAddRound } from "@/features/calendar/useAddToList";
import { SchoolAvatar, StatusBadge } from "@/features/schools/school-cells";
import { deadlineSourceLabel } from "@/features/schools/school-workspace-format";
import { parseDateOnly } from "@/features/tasks/task-dates";

export type DeadlineCardItem = Extract<
  CalendarItem,
  { kind: "school" } | { kind: "aggregate" }
>;

function sourceLine(
  item: DeadlineCardItem,
  period: string | undefined,
): string | null {
  if (item.kind === "aggregate") {
    const base = deadlineSourceLabel("facts", item.schools[0].checked_at);
    return base && period ? `${base} · ${formatCycle(period)}` : base;
  }
  const application = item.application;
  if (item.field === "deadline") {
    return deadlineSourceLabel(
      application.deadline_source,
      application.deadline_checked_at,
    );
  }
  if (item.field === "aid_deadline") {
    return deadlineSourceLabel(
      application.aid_deadline_source,
      application.aid_deadline_checked_at,
    );
  }
  // Scholarship deadlines are only ever the student's own.
  return deadlineSourceLabel("student", null);
}

function whenWord(item: DeadlineCardItem, today: Date): string {
  const state = getItemState(item, today);
  if (state === "passed") {
    return "Passed";
  }
  if (state === "submitted") {
    return "Submitted";
  }
  if (state === "overdue") {
    return "Overdue";
  }
  return formatRelativeDay(item.date, today);
}

function CardHeader({
  application,
  school,
  subtitle,
}: {
  application?: ApplicationView;
  school: { name: string; websiteUrl: string | null };
  subtitle: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <SchoolAvatar
        name={school.name}
        size="sm"
        websiteUrl={school.websiteUrl}
      />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="truncate text-sm leading-5 font-medium text-[var(--ink)]">
          {school.name}
        </p>
        <p className="text-xs text-[var(--ink-secondary)]">{subtitle}</p>
      </div>
      {application ? <StatusBadge status={application.status} /> : null}
    </div>
  );
}

export function DeadlineCard({
  item,
  onAddTask,
  onAddToList,
  onClose,
  reportedPeriod,
}: {
  item: DeadlineCardItem;
  onAddTask: (application: ApplicationView, date: string) => void;
  onAddToList: (school: SchoolDeadlineItem) => void;
  onClose: () => void;
  reportedPeriod: string | undefined;
}) {
  const ctx = useCalendarContext();
  const school =
    item.kind === "school"
      ? {
          name: item.application.school_name,
          unitid: item.application.school_unitid,
          websiteUrl: item.application.website_url,
        }
      : {
          name: item.schools[0].school_name,
          unitid: item.schools[0].unitid,
          websiteUrl: item.schools[0].website_url,
        };
  const subtitle =
    item.kind === "school"
      ? schoolFieldLabel(item.application, item.field, "long")
      : calendarRoundLabel(item.round, "long");
  const source = sourceLine(item, reportedPeriod);

  return (
    <div className="flex w-72 flex-col">
      <CardHeader
        application={item.kind === "school" ? item.application : undefined}
        school={school}
        subtitle={subtitle}
      />
      <div className="my-3 h-px bg-[var(--hairline)]" />
      <p className="text-sm text-[var(--ink)]">
        {formatDayLabel(parseDateOnly(item.date))}
        <span className="text-[var(--ink-secondary)]">
          {" "}
          · {whenWord(item, ctx.today)}
        </span>
      </p>
      {source ? (
        <p className="mt-1 text-xs text-[var(--ink-faint)]">{source}</p>
      ) : null}
      <div className="my-3 h-px bg-[var(--hairline)]" />
      <div className="flex items-center justify-between gap-2">
        <Button
          onClick={onClose}
          render={<Link to={`/app/schools/${school.unitid}`} />}
          size="sm"
          variant="outline"
        >
          Open school
        </Button>
        {item.kind === "school" ? (
          <Button
            onClick={() => onAddTask(item.application, item.date)}
            size="sm"
            variant="ghost"
          >
            <CalendarPlus aria-hidden="true" />
            Add a task
          </Button>
        ) : canAddRound(item.round) ? (
          <Button
            onClick={() => onAddToList(item.schools[0])}
            size="sm"
            variant="default"
          >
            <Plus aria-hidden="true" />
            Add to list
          </Button>
        ) : null}
      </div>
    </div>
  );
}
