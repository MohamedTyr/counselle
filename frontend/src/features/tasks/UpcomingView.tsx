// spec §6.2, design doc §2.5. Renders the hoisted `upcomingGroups` from
// `TasksLayout` — no query of its own (P6.1's MUST).
import { CalendarDays } from "lucide-react";
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
import {
  TaskGroup,
  TaskSheet,
  TaskSheetSection,
} from "@/features/tasks/TaskSheet";
import { useTasksOutletContext } from "@/features/tasks/tasks-outlet-context";
import { TaskRow } from "@/features/tasks/TaskRow";

export function UpcomingView() {
  const {
    activeTaskId,
    applicationsById,
    essaysById,
    onComplete,
    onDelete,
    onOpenTask,
    onSchedule,
    onToggleFlag,
    upcomingGroups,
  } = useTasksOutletContext();

  if (upcomingGroups.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle className="text-sm font-medium text-[var(--ink)]">
            Nothing scheduled ahead
          </EmptyTitle>
          <EmptyDescription className="max-w-[36ch] text-sm text-pretty text-[var(--ink-secondary)]">
            Give a task a When date and it will show up here.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button
            render={<Link to="/app/tasks/anytime" />}
            size="sm"
            variant="ghost"
          >
            Go to Anytime
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  const unplanned = upcomingGroups.filter(
    (group) => group.variant === "unplanned-deadlines",
  );
  const dated = upcomingGroups.filter(
    (group) => group.variant !== "unplanned-deadlines",
  );

  function renderRow(task: Task, isUnplanned: boolean) {
    return (
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
        scheduleAffordanceAtRest={isUnplanned}
        suppress={isUnplanned ? undefined : { when: true }}
        task={task}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8">
      {unplanned.map((group) => (
        <TaskGroup
          count={group.tasks.length}
          key={group.id}
          label={group.label}
          variant={group.variant}
        >
          {group.tasks.map((task) => renderRow(task, true))}
        </TaskGroup>
      ))}
      {dated.length > 0 && (
        <TaskSheet>
          {dated.map((group) => (
            <TaskSheetSection
              count={group.tasks.length}
              key={group.id}
              label={group.label}
            >
              {group.tasks.map((task) => renderRow(task, false))}
            </TaskSheetSection>
          ))}
        </TaskSheet>
      )}
    </div>
  );
}
