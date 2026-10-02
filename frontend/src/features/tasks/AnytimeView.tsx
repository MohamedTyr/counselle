// spec §6.3, design doc §2.5. Renders the hoisted `anytimeGroups` from
// `TasksLayout` — no query of its own (P6.1's MUST).
import { Inbox } from "lucide-react";

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

export function AnytimeView() {
  const {
    activeTaskId,
    anytimeGroups,
    applicationsById,
    essaysById,
    onComplete,
    onDelete,
    onOpenTask,
    onSchedule,
    onToggleFlag,
  } = useTasksOutletContext();

  if (anytimeGroups.length === 0) {
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Inbox aria-hidden="true" />
          </EmptyMedia>
          <EmptyTitle className="text-sm font-medium text-[var(--ink)]">
            Nothing waiting
          </EmptyTitle>
          <EmptyDescription className="max-w-[36ch] text-sm text-pretty text-[var(--ink-secondary)]">
            Tasks with no date live here. Add one above.
          </EmptyDescription>
        </EmptyHeader>
        {/* No action — the quick-add is 40px away (design doc §8). */}
      </Empty>
    );
  }

  return (
    <TaskSheet>
      {anytimeGroups.map((group) => (
        <TaskSheetSection
          count={group.tasks.length}
          key={group.id}
          label={
            group.id === "unlabelled" && anytimeGroups.length === 1
              ? undefined
              : group.label
          }
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
              suppress={{ label: true }}
              task={task}
            />
          ))}
        </TaskSheetSection>
      ))}
    </TaskSheet>
  );
}
