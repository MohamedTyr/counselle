// Net-new: essay pages had no task section at all before the tasks redesign
// (plans/tasks-redesign-plan.md P7.1, spec §6.6 — "Unchanged in structure;
// their task section becomes a `TaskRow` list with a context-defaulted
// quick-add bar," which for essays means adding the section for the first
// time). Filtered to this essay's own tasks (`essay_id === essay.id`);
// quick-add defaults `essay_id` so a task captured here is linked without
// the student picking it manually — the same context-default pattern
// `QuickAddTask` on the school page proved out.
import { useMemo } from "react";
import { useNavigate } from "react-router";

import { useApplications, useEssays, useTasks } from "@/api/workspace/hooks";
import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import { UndoToast } from "@/components/undo-toast";
import { taskFromApi } from "@/domain/task";
import { QuickAddBar } from "@/features/tasks/QuickAddBar";
import { TaskRow } from "@/features/tasks/TaskRow";
import { useTaskRowActions } from "@/features/tasks/useTaskRowActions";

function listOrEmpty<TItem>(value: TItem[] | undefined): TItem[] {
  return Array.isArray(value) ? value : [];
}

export function EssayTasksSection({ essayId }: { essayId: string }) {
  const navigate = useNavigate();
  const tasksQuery = useTasks();
  const applicationsQuery = useApplications();
  const essaysQuery = useEssays();

  const applications = listOrEmpty(applicationsQuery.data);
  const essays = listOrEmpty(essaysQuery.data);
  const applicationsById = useMemo<ReadonlyMap<string, ApplicationView>>(
    () =>
      new Map(applications.map((application) => [application.id, application])),
    [applications],
  );
  const essaysById = useMemo<ReadonlyMap<string, EssaySummary>>(
    () => new Map(essays.map((essay) => [essay.id, essay])),
    [essays],
  );

  const tasks = useMemo(
    () =>
      listOrEmpty(tasksQuery.data)
        .filter((task) => task.essay_id === essayId)
        .map(taskFromApi),
    [tasksQuery.data, essayId],
  );

  const { actions, undoToastProps } = useTaskRowActions({
    onOpen: (taskId) => navigate(`/app/tasks?task=${taskId}`),
    tasks,
  });

  return (
    <section
      aria-labelledby="essay-tasks-heading"
      className="flex flex-col gap-3"
    >
      <h2
        className="text-sm font-medium text-[var(--ink)]"
        id="essay-tasks-heading"
      >
        Tasks
      </h2>
      <QuickAddBar
        applications={applications}
        defaults={{ essay_id: essayId }}
        essays={essays}
      />
      {tasks.length > 0 && (
        <ul className="-mx-2 flex flex-col" role="list">
          {tasks.map((task) => (
            <TaskRow
              {...actions}
              applicationsById={applicationsById}
              essaysById={essaysById}
              isSelected={false}
              key={task.id}
              suppress={{ label: true }}
              task={task}
            />
          ))}
        </ul>
      )}
      <UndoToast {...undoToastProps} />
    </section>
  );
}
