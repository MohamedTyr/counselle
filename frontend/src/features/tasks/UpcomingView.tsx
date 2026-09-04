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
import {
  TaskGroupCloseRule,
  TaskGroupHeader,
} from "@/features/tasks/TasksLayout";
import { useTasksOutletContext } from "@/features/tasks/tasks-outlet-context";
import { TaskRow } from "@/features/tasks/TaskRow";

export function UpcomingView() {
  const {
    activeTaskId,
    applicationsById,
    essaysById,
    onComplete,
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
          <Button render={<Link to="/app/tasks/anytime" />} size="sm" variant="ghost">
            Go to Anytime
          </Button>
        </EmptyContent>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col">
      {upcomingGroups.map((group, index) => (
        <div key={group.id}>
          <TaskGroupHeader
            count={group.tasks.length}
            isFirst={index === 0}
            label={group.label}
            sticky
            variant={group.variant}
          />
          <ul className="-mx-2 flex flex-col" role="list">
            {group.tasks.map((task) => (
              <TaskRow
                applicationsById={applicationsById}
                essaysById={essaysById}
                isSelected={task.id === activeTaskId}
                key={task.id}
                onComplete={onComplete}
                onOpen={onOpenTask}
                onSchedule={onSchedule}
                onToggleFlag={onToggleFlag}
                scheduleAffordanceAtRest={group.variant === "unplanned-deadlines"}
                suppress={group.variant === "unplanned-deadlines" ? undefined : { when: true }}
                task={task}
              />
            ))}
          </ul>
          {group.variant === "unplanned-deadlines" && <TaskGroupCloseRule />}
        </div>
      ))}
    </div>
  );
}
