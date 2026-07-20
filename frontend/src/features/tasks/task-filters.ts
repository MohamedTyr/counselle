import type { Task, TaskStatus } from "@/domain/task";
import { getNowDate } from "@/lib/time";
import type { UpcomingGroup } from "@/features/tasks/task-types";
import {
  assigneeLabel,
  categoryLabel,
  priorityLabel,
  statusLabel,
} from "@/features/tasks/task-config";
import {
  formatPlannedDateLabel,
  formatShortDate,
  getCalendarDayDiff,
  isTaskPlannedForToday,
} from "@/features/tasks/task-dates";
import { sortPlanningTasks } from "@/features/tasks/task-sort";

export function isTaskInUpcomingView(
  task: Task,
  referenceDate: Date = getNowDate(),
) {
  if (task.status === "done") {
    return false;
  }

  return task.planned_for ? !isTaskPlannedForToday(task, referenceDate) : true;
}

export function getColumnTasks(tasks: Task[], status: TaskStatus) {
  return tasks.filter((task) => task.status === status);
}

export function getSearchableTaskText(task: Task) {
  return [
    task.title,
    task.notes,
    task.planned_for ? formatPlannedDateLabel(task.planned_for) : undefined,
    task.due_at ? formatShortDate(task.due_at) : undefined,
    task.reminder_at ? formatShortDate(task.reminder_at) : undefined,
    categoryLabel[task.category],
    priorityLabel[task.priority],
    assigneeLabel[task.assignee],
    task.needs_input ? "Needs input" : undefined,
    statusLabel[task.status],
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export function getUpcomingGroups(
  tasks: Task[],
  referenceDate: Date = getNowDate(),
) {
  const activeTasks = sortPlanningTasks(
    tasks.filter((task) => isTaskInUpcomingView(task, referenceDate)),
  );
  const overdueTasks: Task[] = [];
  const tomorrowTasks: Task[] = [];
  const thisWeekTasks: Task[] = [];
  const laterTasks: Task[] = [];
  const needsPlanningTasks: Task[] = [];
  const unscheduledTasks: Task[] = [];

  activeTasks.forEach((task) => {
    if (!task.planned_for) {
      if (task.due_at) {
        needsPlanningTasks.push(task);
        return;
      }

      unscheduledTasks.push(task);
      return;
    }

    const workDate = new Date(task.planned_for);
    const dayDiff = getCalendarDayDiff(workDate, referenceDate);

    if (dayDiff < 0) {
      overdueTasks.push(task);
      return;
    }

    if (dayDiff === 1) {
      tomorrowTasks.push(task);
      return;
    }

    if (dayDiff <= 6) {
      thisWeekTasks.push(task);
      return;
    }

    laterTasks.push(task);
  });

  const groups: UpcomingGroup[] = [];

  if (overdueTasks.length > 0) {
    groups.push({
      id: "overdue",
      title: "Needs attention",
      subtitle: "Past dates that should be handled before future planning.",
      tasks: overdueTasks,
    });
  }

  groups.push({
    id: "tomorrow",
    title: "Tomorrow",
    subtitle: "Work explicitly planned for the next day.",
    tasks: tomorrowTasks,
  });

  groups.push({
    id: "this-week",
    title: "This week",
    subtitle: "Planned work after tomorrow but inside the next seven days.",
    tasks: thisWeekTasks,
  });

  groups.push({
    id: "later",
    title: "Later",
    subtitle: "Planned work beyond the next seven days.",
    tasks: laterTasks,
  });

  groups.push({
    id: "needs-planning",
    title: "Needs planning",
    subtitle: "Due-dated work without a work date yet.",
    tasks: needsPlanningTasks,
  });

  groups.push({
    id: "unscheduled",
    title: "Unscheduled",
    subtitle: "Useful work with no work date or due date.",
    tasks: unscheduledTasks,
  });

  return groups;
}

export function filterTasksByQuery(tasks: Task[], query: string) {
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery) {
    return tasks;
  }

  return tasks.filter((task) =>
    getSearchableTaskText(task).includes(normalizedQuery),
  );
}

export function groupTasksByStatus(tasks: Task[]) {
  return tasks.reduce(
    (groups, task) => ({
      ...groups,
      [task.status]: [...groups[task.status], task],
    }),
    {
      todo: [],
      doing: [],
      waiting: [],
      done: [],
    } as Record<TaskStatus, Task[]>,
  );
}
