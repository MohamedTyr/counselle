// Turns the workspace's tasks, essays and applications, plus every school's
// published deadlines, into one sorted list of single-day items per day.
// Inheritance is never recomputed here: `ApplicationView.deadline` is already
// the effective date, and the all-schools dates already passed the server's
// `inherited_date` + not-offered rules.
import type { CalendarRound, SchoolDeadlineItem } from "@/api/calendar/types";
import type {
  ApplicationView,
  EssaySummary,
  Round,
} from "@/api/workspace/types";
import type { Task } from "@/domain/task";
import {
  roundSortRank,
  statusSortRank,
} from "@/features/schools/schools-config";
import {
  getDeadlineState,
  isValidDateKey,
  toDateKey,
} from "@/features/tasks/task-dates";

export const CALENDAR_ROUND_ORDER: readonly CalendarRound[] = [
  "ED",
  "ED2",
  "EA",
  "EA2",
  "RD",
];

export type SchoolDeadlineField =
  | "deadline"
  | "aid_deadline"
  | "scholarship_deadline";

const SCHOOL_FIELDS: readonly SchoolDeadlineField[] = [
  "deadline",
  "aid_deadline",
  "scholarship_deadline",
];

export type CalendarItem =
  | { kind: "task"; key: string; date: string; task: Task; isAlsoDue: boolean }
  | {
      kind: "due";
      key: string;
      date: string;
      source: { task: Task } | { essay: EssaySummary };
    }
  | {
      kind: "school";
      key: string;
      date: string;
      application: ApplicationView;
      field: SchoolDeadlineField;
    }
  | {
      kind: "aggregate";
      key: string;
      date: string;
      round: CalendarRound;
      /** One school renders as a named chip; more as a count. */
      schools: SchoolDeadlineItem[];
    };

export type CalendarLayers = {
  tasks: boolean;
  due: boolean;
  mySchools: boolean;
  allSchools: boolean;
  allSchoolsRounds: CalendarRound[];
  showCompleted: boolean;
};

export const DEFAULT_LAYERS: CalendarLayers = {
  allSchools: false,
  allSchoolsRounds: [...CALENDAR_ROUND_ORDER],
  due: true,
  mySchools: true,
  showCompleted: true,
  tasks: true,
};

export type CalendarItemsInput = {
  tasks: Task[];
  essays: EssaySummary[];
  applications: ApplicationView[];
  /** Every school's dates, or `undefined` until both they and the student's
   * own list have loaded — the exclusion below needs the list, or the
   * student's own schools would briefly show as "other". */
  schoolDeadlines: SchoolDeadlineItem[] | undefined;
  layers: CalendarLayers;
};

// ---- labels ----

const ROUND_SHORT: Record<Round | CalendarRound, string> = {
  EA: "EA",
  EA2: "EA II",
  ED: "ED",
  ED2: "ED II",
  Priority: "Priority",
  RD: "RD",
  REA: "REA",
  Rolling: "Rolling",
};

const ROUND_LONG: Record<Round | CalendarRound, string> = {
  EA: "Early action",
  EA2: "Early action II",
  ED: "Early decision",
  ED2: "Early decision II",
  Priority: "Priority",
  RD: "Regular decision",
  REA: "Restrictive early action",
  Rolling: "Rolling",
};

export function calendarRoundLabel(
  round: Round | CalendarRound,
  form: "short" | "long" = "short",
): string {
  return form === "short" ? ROUND_SHORT[round] : ROUND_LONG[round];
}

/** What a school chip's suffix reads: the round, or `Aid` / `Scholarship`. */
export function schoolFieldLabel(
  application: ApplicationView,
  field: SchoolDeadlineField,
  form: "short" | "long" = "short",
): string {
  if (field === "aid_deadline") {
    return form === "short" ? "Aid" : "Financial aid";
  }
  if (field === "scholarship_deadline") {
    return "Scholarship";
  }
  return calendarRoundLabel(application.round, form);
}

export function pluralSchools(count: number): string {
  return count === 1 ? "1 other school" : `${count} other schools`;
}

// ---- state ----

export type CalendarItemState =
  | "overdue"
  | "due-soon"
  | "normal"
  | "done"
  | "submitted"
  | "passed";

export function isSubmittedOrLater(application: ApplicationView): boolean {
  return (
    application.status !== "Withdrawn" &&
    statusSortRank[application.status] >= statusSortRank.Submitted
  );
}

export function isItemDone(item: CalendarItem): boolean {
  if (item.kind === "task") {
    return Boolean(item.task.done_at);
  }
  if (item.kind === "due") {
    return "task" in item.source
      ? Boolean(item.source.task.done_at)
      : item.source.essay.status === "Submitted";
  }
  return false;
}

/** The one state rule for every chip (plan §2.2). Done wins. Only a school's
 * round deadline can read `submitted` or `passed`: nothing records whether an
 * aid or scholarship application went in, so those take the plain due forms. */
export function getItemState(
  item: CalendarItem,
  today: Date,
): CalendarItemState {
  if (isItemDone(item)) {
    return "done";
  }
  if (item.kind === "aggregate") {
    return "normal";
  }
  const deadline = getDeadlineState(item.date, today);
  if (item.kind === "school" && item.field === "deadline") {
    if (isSubmittedOrLater(item.application)) {
      return "submitted";
    }
    if (deadline === "overdue") {
      return "passed";
    }
  }
  if (item.kind === "task") {
    return "normal";
  }
  return deadline === "hidden" ? "normal" : deadline;
}

// ---- ordering ----

function itemGroup(item: CalendarItem): number {
  if (isItemDone(item)) {
    return 5;
  }
  switch (item.kind) {
    case "school":
      return 0;
    case "due":
      return 1;
    case "task":
      return item.task.flagged ? 2 : 3;
    case "aggregate":
      return 4;
  }
}

function itemTitle(item: CalendarItem): string {
  switch (item.kind) {
    case "task":
      return item.task.title;
    case "due":
      return "task" in item.source
        ? item.source.task.title
        : item.source.essay.title;
    case "school":
      return item.application.school_name;
    case "aggregate":
      return item.schools[0]?.school_name ?? "";
  }
}

function compareWithinGroup(a: CalendarItem, b: CalendarItem): number {
  if (a.kind === "school" && b.kind === "school") {
    return (
      roundSortRank[a.application.round] - roundSortRank[b.application.round] ||
      SCHOOL_FIELDS.indexOf(a.field) - SCHOOL_FIELDS.indexOf(b.field)
    );
  }
  if (a.kind === "task" && b.kind === "task") {
    const orderA = a.task.sort_order ?? Number.POSITIVE_INFINITY;
    const orderB = b.task.sort_order ?? Number.POSITIVE_INFINITY;
    if (orderA !== orderB) {
      return orderA < orderB ? -1 : 1;
    }
    return a.task.created_at.localeCompare(b.task.created_at);
  }
  if (a.kind === "aggregate" && b.kind === "aggregate") {
    return (
      CALENDAR_ROUND_ORDER.indexOf(a.round) -
      CALENDAR_ROUND_ORDER.indexOf(b.round)
    );
  }
  return 0;
}

export function compareCalendarItems(a: CalendarItem, b: CalendarItem): number {
  return (
    itemGroup(a) - itemGroup(b) ||
    compareWithinGroup(a, b) ||
    itemTitle(a).localeCompare(itemTitle(b)) ||
    a.key.localeCompare(b.key)
  );
}

// ---- building ----

function validKey(value: string | null | undefined): string | undefined {
  const key = toDateKey(value ?? undefined);
  return key && isValidDateKey(key) ? key : undefined;
}

function taskItems(
  tasks: Task[],
  layers: CalendarLayers,
): CalendarItem[] {
  const items: CalendarItem[] = [];
  for (const task of tasks) {
    if (task.done_at && !layers.showCompleted) {
      continue;
    }
    const whenOn = validKey(task.when_on);
    const deadlineOn = validKey(task.deadline_on);
    const merged = layers.tasks && whenOn !== undefined && whenOn === deadlineOn;
    if (layers.tasks && whenOn) {
      items.push({
        date: whenOn,
        isAlsoDue: merged && layers.due,
        key: `task:${task.id}`,
        kind: "task",
        task,
      });
    }
    if (layers.due && deadlineOn && !merged) {
      items.push({
        date: deadlineOn,
        key: `due:task:${task.id}`,
        kind: "due",
        source: { task },
      });
    }
  }
  return items;
}

function essayItems(
  essays: EssaySummary[],
  applicationsById: ReadonlyMap<string, ApplicationView>,
  layers: CalendarLayers,
): CalendarItem[] {
  if (!layers.due) {
    return [];
  }
  const items: CalendarItem[] = [];
  for (const essay of essays) {
    const date = validKey(essay.deadline);
    if (!date || essay.archived_at) {
      continue;
    }
    if (essay.status === "Submitted" && !layers.showCompleted) {
      continue;
    }
    // `EssaySummary.deadline` falls back to its application's deadline, so a
    // date equal to that one is the school's, already on the school chip.
    const application = essay.application_id
      ? applicationsById.get(essay.application_id)
      : undefined;
    if (application && validKey(application.deadline) === date) {
      continue;
    }
    items.push({
      date,
      key: `due:essay:${essay.id}`,
      kind: "due",
      source: { essay },
    });
  }
  return items;
}

function schoolItems(
  applications: ApplicationView[],
  layers: CalendarLayers,
): CalendarItem[] {
  if (!layers.mySchools) {
    return [];
  }
  const items: CalendarItem[] = [];
  for (const application of applications) {
    if (application.status === "Withdrawn" || application.archived_at) {
      continue;
    }
    for (const field of SCHOOL_FIELDS) {
      const date = validKey(application[field]);
      if (date) {
        items.push({
          application,
          date,
          field,
          key: `school:${application.id}:${field}`,
          kind: "school",
        });
      }
    }
  }
  return items;
}

function aggregateItems(
  deadlines: SchoolDeadlineItem[] | undefined,
  applications: ApplicationView[],
  layers: CalendarLayers,
): CalendarItem[] {
  if (!layers.allSchools || !deadlines) {
    return [];
  }
  const listed = new Set(
    applications.map((application) => application.school_unitid),
  );
  const rounds = new Set(layers.allSchoolsRounds);
  const groups = new Map<string, SchoolDeadlineItem[]>();
  for (const school of deadlines) {
    const date = validKey(school.date);
    if (!date || listed.has(school.unitid) || !rounds.has(school.round)) {
      continue;
    }
    const groupKey = `${date}|${school.round}`;
    const group = groups.get(groupKey);
    if (group) {
      group.push(school);
    } else {
      groups.set(groupKey, [school]);
    }
  }
  return [...groups].map(([groupKey, schools]) => {
    const [date, round] = groupKey.split("|") as [string, CalendarRound];
    return {
      date,
      key: `aggregate:${date}:${round}`,
      kind: "aggregate",
      round,
      schools: [...schools].sort((a, b) =>
        a.school_name.localeCompare(b.school_name),
      ),
    };
  });
}

/** Every item, bucketed by `YYYY-MM-DD` and sorted by `compareCalendarItems`. */
export function buildCalendarItems(
  input: CalendarItemsInput,
): Map<string, CalendarItem[]> {
  const applicationsById = new Map(
    input.applications.map((application) => [application.id, application]),
  );
  const all = [
    ...taskItems(input.tasks, input.layers),
    ...essayItems(input.essays, applicationsById, input.layers),
    ...schoolItems(input.applications, input.layers),
    ...aggregateItems(input.schoolDeadlines, input.applications, input.layers),
  ];
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of all) {
    const day = byDay.get(item.date);
    if (day) {
      day.push(item);
    } else {
      byDay.set(item.date, [item]);
    }
  }
  for (const items of byDay.values()) {
    items.sort(compareCalendarItems);
  }
  return byDay;
}

/** The chips a cell can show in `visible` slots: when the day overflows, the
 * first aggregate is pinned to the last shown slot, so a deadline cluster
 * like Jan 1's is never the thing hidden behind `N more`. */
export function visibleCellItems(
  items: CalendarItem[],
  visible: number,
): { shown: CalendarItem[]; hiddenCount: number } {
  if (items.length <= visible) {
    return { hiddenCount: 0, shown: items };
  }
  const slots = Math.max(visible - 1, 0);
  const shown = items.slice(0, slots);
  const aggregate = items.find((item) => item.kind === "aggregate");
  if (aggregate && slots > 0 && !shown.includes(aggregate)) {
    shown[slots - 1] = aggregate;
  }
  return { hiddenCount: items.length - shown.length, shown };
}
