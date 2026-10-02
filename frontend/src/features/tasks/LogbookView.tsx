// spec §6.4, design doc §2.5. Renders the hoisted `logbookGroups` from
// `TasksLayout` — no query of its own (P6.1's MUST). Reachable from the
// Today footer only; not in the primary tab row (design doc §2.3).
import { Archive } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { TaskSheet, TaskSheetSection } from "@/features/tasks/TaskSheet";
import { useTasksOutletContext } from "@/features/tasks/tasks-outlet-context";
import { TaskRow } from "@/features/tasks/TaskRow";

export function LogbookView() {
  const {
    activeTaskId,
    applicationsById,
    essaysById,
    logbookGroups,
    onComplete,
    onDelete,
    onOpenTask,
    onSchedule,
    onToggleFlag,
  } = useTasksOutletContext();

  if (logbookGroups.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Archive aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle className="text-sm font-medium text-[var(--ink)]">
            Nothing completed yet
          </EmptyTitle>
          <EmptyDescription className="max-w-[36ch] text-sm text-pretty text-[var(--ink-secondary)]">
            Finished tasks land here, newest first.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <TaskSheet>
      {logbookGroups.map((group) => (
        <TaskSheetSection
          count={group.tasks.length}
          key={group.id}
          label={group.label}
        >
          {group.tasks.map((task) => (
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
              task={task}
            />
          ))}
        </TaskSheetSection>
      ))}
    </TaskSheet>
  );
}
