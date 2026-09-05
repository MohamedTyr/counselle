// The tasks route's parent layout (plans/tasks-redesign-plan.md P6.1,
// plans/tasks-redesign-design.md §2.1-2.3). Hoists `useTasks()`,
// `useApplications()`, `useEssays()` once and threads the result — plus the
// four views' pre-computed groups, so a tab count, a page subtitle, and a
// rendered row count can never disagree (P6.1) — through `<Outlet
// context={…} />`. Also owns the page scaffold, the view tabs, the
// quick-add bar, the detail panel, and the undo-toast seam.
import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router";

import {
  useApplications,
  useEssays,
  useReorderTasks,
  useTasks,
} from "@/api/workspace/hooks";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { Skeleton } from "@/components/ui/skeleton";
import { UndoToast } from "@/components/undo-toast";
import { PageContainer } from "@/components/workspace/PageContainer";
import { taskFromApi, type Task } from "@/domain/task";
import {
  QuickAddBar,
  type QuickAddDefaults,
} from "@/features/tasks/QuickAddBar";
import { PlanWithCounselleButton } from "@/features/tasks/task-actions";
import { TaskDetailPanel } from "@/features/tasks/TaskDetailPanel";
import { TaskSearch } from "@/features/tasks/TaskSearch";
import { buildTasksDraftPrompt } from "@/features/tasks/task-plan-prompt";
import {
  getAnytimeGroups,
  getDoneThisWeekCount,
  getLogbookGroups,
  getTodayGroups,
  getUpcomingGroups,
  hasCompletedTodayPlan,
} from "@/features/tasks/task-filters";
import {
  formatPageSubtitle,
  getDateKey,
  type TaskSubtitleView,
} from "@/features/tasks/task-dates";
import {
  useTaskKeymap,
  type TaskKeymapView,
} from "@/features/tasks/useTaskKeymap";
import { useTaskRowActions } from "@/features/tasks/useTaskRowActions";
import { getNowDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { TasksOutletContext } from "@/features/tasks/tasks-outlet-context";

type TaskViewName = "today" | "upcoming" | "anytime" | "logbook";

function resolveView(pathname: string): TaskViewName {
  if (pathname.endsWith("/upcoming")) {
    return "upcoming";
  }
  if (pathname.endsWith("/anytime")) {
    return "anytime";
  }
  if (pathname.endsWith("/logbook")) {
    return "logbook";
  }
  return "today";
}

const VIEW_TITLES: Record<TaskViewName, string> = {
  anytime: "Anytime",
  logbook: "Logbook",
  today: "Today",
  upcoming: "Upcoming",
};

/** spec §8.1 — one default question per view. Logbook has none (the "Plan
 * with Counselle" button doesn't render there, same as the quick-add bar). */
const PLAN_DEFAULT_QUESTIONS: Record<"today" | "upcoming" | "anytime", string> =
  {
    anytime: "Which of these should I schedule, and when?",
    today: "Help me plan today.",
    upcoming: "Look at my next two weeks and tell me what's unrealistic.",
  };

function listOrEmpty<TItem>(value: TItem[] | undefined): TItem[] {
  return Array.isArray(value) ? value : [];
}

/** design doc §2.3 — one tab, shared by Today/Upcoming/Anytime. Logbook is
 * deliberately absent from the tab row (spec §6.4: footer link only).
 * `active` is computed by the caller (from the already-known `view`) rather
 * than from `NavLink`'s own render-prop `isActive`, so `aria-selected` can
 * sit on the same `role="tab"` element instead of a nested presentational
 * span. */
function ViewTab({
  active,
  count,
  label,
  to,
}: {
  active: boolean;
  count: number;
  label: string;
  to: string;
}) {
  return (
    <NavLink
      aria-selected={active}
      className={cn(
        "relative inline-flex h-8 cursor-pointer items-center gap-1.5 text-sm outline-none",
        "transition-[color] duration-150 ease-out",
        "focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--canvas)] focus-visible:rounded-sm",
        active
          ? "font-medium text-[var(--ink)] after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full after:bg-[var(--brand)]"
          : "text-[var(--ink-faint)] hover:text-[var(--ink-secondary)]",
      )}
      end
      role="tab"
      to={to}
    >
      {label}
      <span className="ml-2 text-[var(--ink-faint)] tabular-nums">{count}</span>
    </NavLink>
  );
}

/**
 * design doc §2.5 — one group-header treatment, every view. `isFirst` drops
 * the 24px `mt-6` for whichever group renders directly under the quick-add
 * bar (that gap is already the quick-add-to-content 8px, not the 24px
 * between-groups rhythm). `sticky` is true for Upcoming and Anytime only —
 * Today and Logbook have too few groups for it to matter.
 */
export function TaskGroupHeader({
  count,
  isFirst = false,
  label,
  sticky = false,
  variant,
}: {
  count: number;
  isFirst?: boolean;
  label: string;
  sticky?: boolean;
  variant?: "unplanned-deadlines";
}) {
  return (
    <div
      className={cn(
        "-mx-2 mb-1 flex h-7 items-center bg-[var(--canvas)] pr-2 pl-[var(--task-row-spine)]",
        !isFirst && "mt-6",
        sticky && "sticky top-0 z-[var(--z-sticky)]",
      )}
    >
      <span
        className={cn(
          "text-chrome font-medium",
          variant === "unplanned-deadlines"
            ? "text-[var(--ink-secondary)]"
            : "text-[var(--ink)]",
        )}
      >
        {label}
      </span>
      <span className="ml-2 text-chrome text-[var(--ink-faint)] tabular-nums">
        {count}
      </span>
    </div>
  );
}

/** design doc §2.5 — the hairline that closes "Deadlines without a plan",
 * the one rule in the list body. */
export function TaskGroupCloseRule() {
  return <div className="mt-3 h-px bg-[var(--hairline)]" aria-hidden="true" />;
}

export function TasksLayout() {
  const tasksQuery = useTasks();
  const applicationsQuery = useApplications();
  const essaysQuery = useEssays();
  const reorderTasksMutation = useReorderTasks();

  const [searchParams, setSearchParams] = useSearchParams();
  const [searchOpen, setSearchOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const view = resolveView(location.pathname);
  const referenceDate = getNowDate();

  const tasks = useMemo(
    () => listOrEmpty(tasksQuery.data).map(taskFromApi),
    [tasksQuery.data],
  );
  const applications = listOrEmpty(applicationsQuery.data);
  const essays = listOrEmpty(essaysQuery.data);
  const applicationsById = useMemo(
    () =>
      new Map(applications.map((application) => [application.id, application])),
    [applications],
  );
  const essaysById = useMemo(
    () => new Map(essays.map((essay) => [essay.id, essay])),
    [essays],
  );

  // Computed once, here, and threaded to every consumer (tabs, subtitle,
  // views) — the MUST from plan P6.1: never a separate count query, never
  // hand-duplicated filter logic.
  const todayGroups = useMemo(
    () => getTodayGroups(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- referenceDate is a fresh Date every render; the tasks list is the real dependency.
    [tasks],
  );
  const upcomingGroups = useMemo(
    () => getUpcomingGroups(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks],
  );
  const anytimeGroups = useMemo(
    () => getAnytimeGroups(tasks, applicationsById, essaysById),
    [tasks, applicationsById, essaysById],
  );
  const logbookGroups = useMemo(
    () => getLogbookGroups(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks],
  );
  const doneThisWeekCount = useMemo(
    () => getDoneThisWeekCount(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks],
  );
  const completedTodayPlan = useMemo(
    () => hasCompletedTodayPlan(tasks, referenceDate),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks],
  );

  const todayCount = todayGroups.main.length;
  const upcomingCount = upcomingGroups.reduce(
    (sum, group) => sum + group.tasks.length,
    0,
  );
  const anytimeCount = anytimeGroups.reduce(
    (sum, group) => sum + group.tasks.length,
    0,
  );

  const subtitleCount: Record<TaskViewName, number> = {
    anytime: anytimeCount,
    logbook: doneThisWeekCount,
    today: todayCount,
    upcoming: upcomingCount,
  };
  const subtitle = formatPageSubtitle(
    view as TaskSubtitleView,
    subtitleCount[view],
    referenceDate,
  );

  const activeTaskId = searchParams.get("task");
  const activeTask = tasks.find((task) => task.id === activeTaskId);

  function openTask(taskId: string) {
    setSearchParams(
      (currentParams) => {
        const nextParams = new URLSearchParams(currentParams);
        nextParams.set("task", taskId);
        return nextParams;
      },
      { replace: true },
    );
  }

  function closeTask() {
    setSearchParams(
      (currentParams) => {
        const nextParams = new URLSearchParams(currentParams);
        nextParams.delete("task");
        return nextParams;
      },
      { replace: true },
    );
  }

  // One source for the row verbs — see useTaskRowActions. `onAfterDelete`
  // closes a detail panel that is showing the row that just went away.
  const { actions, undo, undoToastProps } = useTaskRowActions({
    onAfterDelete: closeTask,
    onOpen: openTask,
    tasks,
  });

  function isTaskDone(taskId: string): boolean {
    return Boolean(tasks.find((task) => task.id === taskId)?.done_at);
  }

  // Today's manual reorder (plan P9, spec §6.1/§9). Both the drag grip
  // (TodayView's `useTaskReorder`) and `⌥↑/↓` funnel through here so there
  // is exactly one place that calls the mutation.
  function handleReorderToday(ids: string[]) {
    reorderTasksMutation.mutate(ids);
  }

  function handleReorderTodayByKey(taskId: string, direction: -1 | 1) {
    const ids = todayGroups.main.map((task) => task.id);
    const index = ids.indexOf(taskId);
    if (index === -1) {
      return;
    }
    const nextIndex = Math.min(Math.max(index + direction, 0), ids.length - 1);
    if (nextIndex === index) {
      return;
    }
    const reordered = [...ids];
    reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, taskId);
    handleReorderToday(reordered);
  }

  const quickAddDefaults: QuickAddDefaults =
    view === "today" ? { when_on: getDateKey(referenceDate) } : {};

  const isLoading = tasksQuery.isLoading;
  const isError = tasksQuery.isError;

  const planViewTasks: Task[] =
    view === "today"
      ? [...todayGroups.main, ...todayGroups.dueSoon]
      : view === "upcoming"
        ? upcomingGroups.flatMap((group) => group.tasks)
        : view === "anytime"
          ? anytimeGroups.flatMap((group) => group.tasks)
          : [];
  const draftPrompt =
    view !== "logbook"
      ? buildTasksDraftPrompt({
          applicationsById,
          defaultQuestion: PLAN_DEFAULT_QUESTIONS[view],
          essaysById,
          referenceDate,
          tasks: planViewTasks,
          viewName: VIEW_TITLES[view],
        })
      : "";

  useTaskKeymap({
    isTaskDone,
    onComplete: actions.onComplete,
    onDelete: actions.onDelete,
    onNavigateView: (nextView: TaskKeymapView) =>
      navigate(`/app/tasks/${nextView}`),
    onOpenSearch: () => setSearchOpen(true),
    onOpenTask: openTask,
    onReorder: handleReorderTodayByKey,
    onSchedule: actions.onSchedule,
    onToggleFlag: actions.onToggleFlag,
    onUndo: undo,
  });

  const outletContext: TasksOutletContext = {
    activeTaskId,
    anytimeGroups,
    applications,
    applicationsById,
    doneThisWeekCount,
    essays,
    essaysById,
    hasCompletedTodayPlan: completedTodayPlan,
    logbookGroups,
    onComplete: actions.onComplete,
    onDelete: actions.onDelete,
    onOpenTask: openTask,
    onReorderToday: handleReorderToday,
    onSchedule: actions.onSchedule,
    onToggleFlag: actions.onToggleFlag,
    tasks,
    todayGroups,
    upcomingGroups,
  };

  return (
    <PageContainer
      actions={
        <>
          <Button
            aria-label="Search tasks"
            aria-pressed={searchOpen}
            className="w-auto gap-1.5 px-2"
            onClick={() => setSearchOpen((current) => !current)}
            variant="ghost"
          >
            <Search aria-hidden="true" />
            <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
          </Button>
          {view !== "logbook" && (
            <PlanWithCounselleButton draftPrompt={draftPrompt}>
              Plan with Counselle
            </PlanWithCounselleButton>
          )}
        </>
      }
      className="gap-0"
      overlay={
        <>
          <UndoToast {...undoToastProps} />
          <TaskDetailPanel
            applicationsById={applicationsById}
            essaysById={essaysById}
            onDelete={actions.onDelete}
            onOpenChange={(open) => {
              if (!open) {
                closeTask();
              }
            }}
            open={Boolean(activeTask)}
            task={activeTask}
          />
          <TaskSearch
            applicationsById={applicationsById}
            essaysById={essaysById}
            onComplete={actions.onComplete}
            onDelete={actions.onDelete}
            onOpenChange={setSearchOpen}
            onOpenTask={openTask}
            onSchedule={actions.onSchedule}
            onToggleFlag={actions.onToggleFlag}
            open={searchOpen}
            tasks={tasks}
          />
        </>
      }
      subtitle={subtitle}
      title={VIEW_TITLES[view]}
      width="wide"
    >
      <div className="mb-4 flex h-8 items-center gap-6" role="tablist">
        <ViewTab
          active={view === "today"}
          count={todayCount}
          label="Today"
          to="/app/tasks/today"
        />
        <ViewTab
          active={view === "upcoming"}
          count={upcomingCount}
          label="Upcoming"
          to="/app/tasks/upcoming"
        />
        <ViewTab
          active={view === "anytime"}
          count={anytimeCount}
          label="Anytime"
          to="/app/tasks/anytime"
        />
      </div>

      {view !== "logbook" && (
        <div className="mb-2">
          <QuickAddBar
            applications={applications}
            defaults={quickAddDefaults}
            essays={essays}
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-0" role="list">
          {[0, 1, 2, 3, 4].map((index) => (
            <div className="flex h-9 items-center px-2" key={index}>
              <Skeleton className="h-4 w-4 rounded-[4px]" />
              <Skeleton className="ml-3 h-4 w-48 rounded-sm" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="rounded-xl border bg-card p-6">
          <div className="max-w-md space-y-3">
            <h2 className="font-heading text-lg font-medium">
              Could not load tasks
            </h2>
            <p className="text-sm text-muted-foreground">
              The workspace could not reach your tasks list.
            </p>
            <Button onClick={() => void tasksQuery.refetch()}>Try again</Button>
          </div>
        </div>
      ) : (
        <Outlet context={outletContext} />
      )}
    </PageContainer>
  );
}
