// What each chip says, visibly and to assistive tech. The accessible name always
// leads with the state word, so a status never rests on colour alone
// (DESIGN.md §14.3).
import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import { formatRelativeDay } from "@/features/calendar/calendar-grid";
import {
  calendarRoundLabel,
  getItemState,
  pluralSchools,
  schoolFieldLabel,
  type CalendarItem,
  type CalendarItemState,
} from "@/features/calendar/calendar-items";

const STATE_WORD: Record<CalendarItemState, string> = {
  done: "Done",
  "due-soon": "Due soon",
  normal: "Due",
  overdue: "Overdue",
  passed: "Passed",
  submitted: "Submitted",
};

/** The visible label: a name that may truncate and a suffix that never does. */
export function chipText(item: CalendarItem): {
  name: string;
  suffix?: string;
} {
  switch (item.kind) {
    case "task":
      return { name: item.task.title };
    case "due":
      return {
        name:
          "task" in item.source
            ? item.source.task.title
            : item.source.essay.title,
      };
    case "school":
      return {
        name: item.application.school_name,
        suffix: `· ${schoolFieldLabel(item.application, item.field)}`,
      };
    case "aggregate": {
      const round = `· ${calendarRoundLabel(item.round)}`;
      return item.schools.length === 1
        ? { name: item.schools[0].school_name, suffix: round }
        : { name: String(item.schools.length), suffix: round };
    }
  }
}

export function chipAccessibleName(item: CalendarItem, today: Date): string {
  const state = getItemState(item, today);
  switch (item.kind) {
    case "task": {
      const parts = [
        state === "done" ? `Done, ${item.task.title}` : item.task.title,
      ];
      if (item.task.flagged) {
        parts.push("flagged");
      }
      if (item.isAlsoDue && state !== "done") {
        parts.push("due this day");
      }
      return parts.join(", ");
    }
    case "due":
      return `${STATE_WORD[state]}, ${chipText(item).name}`;
    case "school":
      return `${STATE_WORD[state]}, ${item.application.school_name} ${schoolFieldLabel(
        item.application,
        item.field,
        "long",
      ).toLowerCase()}`;
    case "aggregate":
      return item.schools.length === 1
        ? `${calendarRoundLabel(item.round, "long")}, ${item.schools[0].school_name}`
        : `${calendarRoundLabel(item.round, "long")}, ${pluralSchools(item.schools.length)}`;
  }
}

/** The second line Week view gives a chip: the school a task belongs to, or
 * how far off a deadline is. */
export function chipSubtitle(
  item: CalendarItem,
  lookups: {
    applicationsById: ReadonlyMap<string, ApplicationView>;
    essaysById: ReadonlyMap<string, EssaySummary>;
  },
  today: Date,
): string | undefined {
  if (item.kind === "task") {
    const application = item.task.application_id
      ? lookups.applicationsById.get(item.task.application_id)
      : undefined;
    const essay = item.task.essay_id
      ? lookups.essaysById.get(item.task.essay_id)
      : undefined;
    return application?.school_name ?? essay?.school_name ?? undefined;
  }
  if (item.kind === "aggregate" && item.schools.length > 1) {
    return pluralSchools(item.schools.length);
  }
  return formatRelativeDay(item.date, today);
}

/** `2026-27` → `2026–27`, the typographic range the copy uses. */
export function formatCycle(period: string): string {
  // A word joiner after the dash keeps the range on one line.
  return period.replace("-", "–\u2060");
}
