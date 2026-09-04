// The shape TasksLayout threads down to the four views, in its own module so
// TasksLayout.tsx exports only components (react-refresh/only-export-components).
import { useOutletContext } from "react-router";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import type { Task } from "@/domain/task";
import type { TaskGroup, TodayGroups } from "@/features/tasks/task-filters";

export type TasksOutletContext = {
  tasks: Task[];
  applications: ApplicationView[];
  essays: EssaySummary[];
  applicationsById: ReadonlyMap<string, ApplicationView>;
  essaysById: ReadonlyMap<string, EssaySummary>;
  todayGroups: TodayGroups;
  upcomingGroups: TaskGroup[];
  anytimeGroups: TaskGroup[];
  logbookGroups: TaskGroup[];
  doneThisWeekCount: number;
  hasCompletedTodayPlan: boolean;
  activeTaskId: string | null;
  onOpenTask: (taskId: string) => void;
  onComplete: (taskId: string, done: boolean) => void;
  onSchedule: (
    taskId: string,
    field: "when_on" | "deadline_on",
    value: string | null,
  ) => void;
  onToggleFlag: (taskId: string) => void;
};

export function useTasksOutletContext() {
  return useOutletContext<TasksOutletContext>();
}
