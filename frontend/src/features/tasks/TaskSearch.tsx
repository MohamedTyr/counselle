// Search (plans/tasks-redesign-plan.md P7.3, spec §6.5, decision D3). Built
// on the existing `CommandDialog` (cmdk-backed). Filters the already-cached
// task list client-side — no new backend route, no new fetch — and renders
// results as ordinary `TaskRow`s. The external contract is deliberately
// "query string in, task list out": `filterTasksByQuery` owns the match
// logic, so a server-backed search can replace it later without this
// component changing.
import { useState } from "react";
import { Search } from "lucide-react";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
} from "@/components/ui/command";
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
import { filterTasksByQuery } from "@/features/tasks/task-filters";
import { TaskRow } from "@/features/tasks/TaskRow";
import type { TaskRowActions } from "@/features/tasks/TaskRowMenu";

// `onOpen` is omitted: opening a result also has to close the dialog, so
// this component wraps `onOpenTask` in its own `openResult`.
export type TaskSearchProps = Omit<TaskRowActions, "onOpen"> & {
  applicationsById: ReadonlyMap<string, ApplicationView>;
  essaysById: ReadonlyMap<string, EssaySummary>;
  onOpenChange: (open: boolean) => void;
  onOpenTask: (taskId: string) => void;
  open: boolean;
  tasks: Task[];
};

export function TaskSearch({
  applicationsById,
  essaysById,
  onComplete,
  onDelete,
  onOpenChange,
  onOpenTask,
  onSchedule,
  onToggleFlag,
  open,
  tasks,
}: TaskSearchProps) {
  const [query, setQuery] = useState("");
  const trimmedQuery = query.trim();
  const results = trimmedQuery
    ? filterTasksByQuery(tasks, trimmedQuery, applicationsById, essaysById)
    : [];

  function handleOpenChange(nextOpen: boolean) {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setQuery("");
    }
  }

  function openResult(taskId: string) {
    onOpenTask(taskId);
    handleOpenChange(false);
  }

  return (
    <CommandDialog
      description="Search open and done tasks"
      onOpenChange={handleOpenChange}
      open={open}
      title="Search tasks"
    >
      {/*
        CommandDialog supplies only the Dialog shell — the cmdk Command root
        has to be provided here, exactly as AddSchoolDialog does, or
        CommandInput has no store to subscribe to. Filtering is ours (a
        client-side pass over the cached list), so shouldFilter is off.
      */}
      <Command shouldFilter={false}>
        <CommandInput
          onValueChange={setQuery}
          placeholder="Search tasks…"
          value={query}
        />
        <CommandList>
          {trimmedQuery && results.length === 0 ? (
            // design doc §8's filtered-to-zero template, not the empty
            // template — the student has data, a query is hiding it.
            <Empty className="py-12">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Search aria-hidden="true" />
                </EmptyMedia>
                <EmptyTitle className="text-sm font-medium text-[var(--ink)]">
                  No tasks match
                </EmptyTitle>
                <EmptyDescription className="max-w-[36ch] text-sm text-pretty text-[var(--ink-secondary)]">
                  Nothing matches &quot;{trimmedQuery}&quot; in open or done
                  tasks.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button onClick={() => setQuery("")} size="sm" variant="ghost">
                  Clear search
                </Button>
              </EmptyContent>
            </Empty>
          ) : (
            <ul className="flex flex-col" role="list">
              {results.map((task) => (
                <TaskRow
                  applicationsById={applicationsById}
                  essaysById={essaysById}
                  isSelected={false}
                  key={task.id}
                  onComplete={onComplete}
                  onDelete={onDelete}
                  onOpen={openResult}
                  onSchedule={onSchedule}
                  onToggleFlag={onToggleFlag}
                  task={task}
                />
              ))}
            </ul>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
