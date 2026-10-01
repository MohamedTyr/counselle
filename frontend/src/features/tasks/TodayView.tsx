// spec §6.1, design doc §2.5/§2.6. Renders the hoisted `todayGroups` from
// `TasksLayout` — no query of its own (P6.1's MUST).
import { useMemo } from "react";
import { ArrowRight, CalendarCheck, CheckCheck } from "lucide-react";
import { Link } from "react-router";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import type { Task } from "@/domain/task";
import { PlanWithCounselleButton } from "@/features/tasks/task-actions";
import { buildTasksDraftPrompt } from "@/features/tasks/task-plan-prompt";
import { TaskGroup, TaskList, TaskSheet } from "@/features/tasks/TaskSheet";
import { useTasksOutletContext } from "@/features/tasks/tasks-outlet-context";
import { TaskRow } from "@/features/tasks/TaskRow";
import { useTaskReorder } from "@/features/tasks/useTaskReorder";
import { getNowDate } from "@/lib/time";

export function TodayView() {
  const {
    activeTaskId,
    applicationsById,
    doneThisWeekCount,
    essaysById,
    hasCompletedTodayPlan,
    onComplete,
    onDelete,
    onOpenTask,
    onReorderToday,
    onSchedule,
    onToggleFlag,
    todayGroups,
  } = useTasksOutletContext();

  const { main, dueSoon } = todayGroups;

  // Today's manual reorder (plan P9, design doc §3.10.2): `main` is already
  // in its authoritative order (sort_order-first per task-filters.ts); this
  // hook only tracks the *live* order while a drag is in progress, and
  // commits the id list on drop.
  const mainIds = useMemo(() => main.map((task) => task.id), [main]);
  const mainById = useMemo(
    () => new Map(main.map((task) => [task.id, task])),
    [main],
  );
  const reorder = useTaskReorder(mainIds, onReorderToday);
  const orderedMain = reorder.order
    .map((id) => mainById.get(id))
    .filter((task): task is Task => Boolean(task));

  if (main.length === 0 && dueSoon.length === 0) {
    return hasCompletedTodayPlan ? (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CheckCheck aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle className="text-sm font-medium text-[var(--ink)]">
            Today is done
          </EmptyTitle>
          <EmptyDescription className="max-w-[36ch] text-sm text-pretty text-[var(--ink-secondary)]">
            Everything you planned for today is finished.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            render={<Link to="/app/tasks/logbook" />}
            size="sm"
            variant="ghost"
          >
            Open logbook
          </Button>
        </EmptyContent>
      </Empty>
    ) : (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarCheck aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle className="text-sm font-medium text-[var(--ink)]">
            Nothing planned
          </EmptyTitle>
          <EmptyDescription className="max-w-[36ch] text-sm text-pretty text-[var(--ink-secondary)]">
            Pull something over from Upcoming, or ask Counselle to plan your
            day.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent className="flex-row justify-center">
          <PlanWithCounselleButton
            draftPrompt={buildTasksDraftPrompt({
              applicationsById,
              defaultQuestion: "Help me plan today.",
              essaysById,
              referenceDate: getNowDate(),
              tasks: [],
              viewName: "Today",
            })}
            size="sm"
            variant="default"
          >
            Plan with Counselle
          </PlanWithCounselleButton>
          <Button
            render={<Link to="/app/tasks/upcoming" />}
            size="sm"
            variant="ghost"
          >
            Go to Upcoming
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {/*
        The reorder grip is absolutely positioned at `-left-4` on the row, so
        it hangs just outside the sheet's left edge instead of pushing every
        Today title right of the other views' (design doc §3.10.2).
      */}
      {main.length > 0 && (
        <TaskSheet>
          <TaskList>
            {orderedMain.map((task) => (
              <TaskRow
                applicationsById={applicationsById}
                essaysById={essaysById}
                isSelected={task.id === activeTaskId}
                key={task.id}
                onComplete={onComplete}
                onDelete={onDelete}
                onOpen={onOpenTask}
                onSchedule={onSchedule}
                onToggleFlag={onToggleFlag}
                reorder={{
                  onDragEnd: reorder.endDrag,
                  onDragOverRow: () => reorder.dragOverTask(task.id),
                  onDragStart: () => reorder.startDrag(task.id),
                  onDrop: reorder.drop,
                }}
                suppress={{ when: true }}
                task={task}
              />
            ))}
          </TaskList>
        </TaskSheet>
      )}

      {dueSoon.length > 0 && (
        <TaskGroup count={dueSoon.length} label="Due soon">
          {dueSoon.map((task) => (
            <TaskRow
              applicationsById={applicationsById}
              essaysById={essaysById}
              isSelected={task.id === activeTaskId}
              key={task.id}
              onComplete={onComplete}
              onDelete={onDelete}
              onOpen={onOpenTask}
              onSchedule={onSchedule}
              onToggleFlag={onToggleFlag}
              scheduleAffordanceAtRest
              task={task}
            />
          ))}
        </TaskGroup>
      )}

      {doneThisWeekCount > 0 && (
        <Link
          className="-mt-4 inline-flex h-7 w-fit items-center gap-1.5 rounded-full bg-[var(--control-quiet-surface)] px-3 text-xs text-[var(--ink-secondary)] outline-none transition-[background-color,color,scale] duration-150 ease-out hover:bg-[var(--control-quiet-hover)] hover:text-[var(--ink)] focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)] active:scale-[0.97] motion-reduce:transition-none"
          to="/app/tasks/logbook"
        >
          {doneThisWeekCount} done this week
          <ArrowRight aria-hidden="true" className="size-3.5" />
        </Link>
      )}
    </div>
  );
}
