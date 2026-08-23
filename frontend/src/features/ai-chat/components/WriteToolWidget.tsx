import {
  AlertCircleIcon,
  ClipboardCheckIcon,
  FilePenLineIcon,
  ListPlusIcon,
  SchoolIcon,
  SparklesIcon,
  TrophyIcon,
  UserRoundPenIcon,
} from "lucide-react";
import type React from "react";

import type { StepData } from "@/api/chat/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { ToolBeatIcon, ToolBeatRow } from "./ToolBeat";

type Props = Readonly<{ isLiveSegment?: boolean; step: StepData }>;
type Family =
  "task" | "school" | "essay" | "activity" | "honor" | "profile" | "memory";
type Action = "create" | "update" | "archive" | "restore" | "reorder";

function familyOf(tool: string): Family {
  if (tool.includes("task")) return "task";
  if (tool.includes("school")) return "school";
  if (tool.includes("essay")) return "essay";
  if (tool.includes("activit")) return "activity";
  if (tool.includes("honor")) return "honor";
  if (tool === "update_profile") return "profile";
  return "memory";
}

function actionOf(tool: string): Action {
  if (tool.startsWith("archive") || tool === "forget") return "archive";
  if (tool.startsWith("restore")) return "restore";
  if (tool.startsWith("reorder")) return "reorder";
  if (
    tool.startsWith("create") ||
    tool.startsWith("add") ||
    tool === "duplicate_essay" ||
    tool === "remember"
  )
    return "create";
  return "update";
}

const FAMILY_LABEL: Record<Family, string> = {
  task: "tasks",
  school: "school list",
  essay: "essays",
  activity: "activities",
  honor: "honors",
  profile: "profile",
  memory: "memory",
};

const SINGLE_ITEM_TOOLS = new Set([
  "update_task",
  "restore_task",
  "update_school",
  "restore_school",
  "update_essay",
  "duplicate_essay",
  "restore_essay",
  "edit_essay",
  "write_essay",
  "update_activity",
  "restore_activity",
  "update_honor",
  "restore_honor",
  "update_profile",
  "update_memory",
]);

const SINGULAR_NOUN: Record<Family, string> = {
  task: "task",
  school: "school",
  essay: "essay",
  activity: "activity",
  honor: "honor",
  profile: "profile",
  memory: "memory",
};

function FamilyIcon({
  family,
  className,
}: {
  family: Family;
  className?: string;
}) {
  const props = { "aria-hidden": true, className } as const;
  if (family === "task") return <ClipboardCheckIcon {...props} />;
  if (family === "school") return <SchoolIcon {...props} />;
  if (family === "essay") return <FilePenLineIcon {...props} />;
  if (family === "activity") return <SparklesIcon {...props} />;
  if (family === "honor") return <TrophyIcon {...props} />;
  if (family === "profile") return <UserRoundPenIcon {...props} />;
  return <ListPlusIcon {...props} />;
}

function outcome(tool: string, status: StepData["status"]): string {
  const family = familyOf(tool);
  const action = actionOf(tool);
  const noun = SINGLE_ITEM_TOOLS.has(tool)
    ? SINGULAR_NOUN[family]
    : FAMILY_LABEL[family];
  if (status === "start") {
    if (action === "archive")
      return family === "memory" ? "Forgetting a memory" : `Archiving ${noun}`;
    if (action === "restore") return `Restoring ${noun}`;
    if (action === "reorder") return `Reordering ${noun}`;
    if (tool === "write_essay") return "Drafting the essay";
    if (tool === "edit_essay") return "Editing the essay";
    if (action === "create")
      return family === "memory" ? "Saving to memory" : `Adding ${noun}`;
    return `Updating ${noun}`;
  }
  if (status === "error")
    return `${noun[0].toUpperCase()}${noun.slice(1)} unchanged`;
  if (tool === "duplicate_essay") return "Essay copied";
  if (tool === "add_schools") return "School added to your list";
  if (tool === "update_school") return "School updated";
  if (tool === "archive_schools") return "School removed from your list";
  if (tool === "restore_school") return "School restored to your list";
  if (action === "archive")
    return family === "memory"
      ? "Memory forgotten"
      : `${noun[0].toUpperCase()}${noun.slice(1)} archived`;
  if (action === "restore")
    return `${noun[0].toUpperCase()}${noun.slice(1)} restored`;
  if (action === "reorder")
    return `${noun[0].toUpperCase()}${noun.slice(1)} reordered`;
  if (tool === "write_essay") return "Essay drafted";
  if (tool === "edit_essay") return "Essay edited";
  if (action === "create")
    return family === "memory"
      ? "Saved to memory"
      : `${noun[0].toUpperCase()}${noun.slice(1)} added`;
  return `${noun[0].toUpperCase()}${noun.slice(1)} updated`;
}

function detailText(step: StepData): string | null {
  if (step.status === "error")
    return (
      step.detail?.error ??
      "The change could not be completed. Nothing was updated."
    );
  if (step.status === "start") return step.label;
  return step.detail?.summary === "Change completed"
    ? null
    : (step.detail?.summary ?? step.label);
}

function taskPreview(step: StepData): React.ReactElement | null {
  if (step.ui?.widget !== "task_added") return null;
  const data = step.ui.data;
  const title = typeof data.title === "string" ? data.title : null;
  if (title === null) return null;
  const facts = [data.school, data.due_date].filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  return (
    <div className="mt-2.5 flex min-h-11 items-start gap-2.5 rounded-md bg-[var(--control-track)] px-2.5 py-1.5">
      <span className="flex h-5 shrink-0 items-center text-muted-foreground">
        <ClipboardCheckIcon aria-hidden="true" className="size-3.5" />
      </span>
      <div className="min-w-0">
        <p className="line-clamp-2 text-sm leading-5 text-[var(--ink-secondary)]">
          {title}
        </p>
        {facts.length > 0 && (
          <p className="text-xs leading-4 text-muted-foreground text-pretty">
            {facts.join(" · ")}
          </p>
        )}
      </div>
    </div>
  );
}

export function WriteToolWidget({ isLiveSegment = false, step }: Props) {
  const tool = step.tool ?? "";
  const family = familyOf(tool);
  const live = isLiveSegment && step.status === "start";
  const detail = detailText(step);
  const taskCount =
    typeof step.ui?.data.count === "number" && step.ui.data.count > 0
      ? step.ui.data.count
      : 1;
  const taskOutcome =
    step.status === "start"
      ? taskCount === 1
        ? "Adding a task"
        : `Adding ${taskCount} tasks`
      : step.status === "error"
        ? taskCount === 1
          ? "Task not added"
          : "Tasks not added"
        : taskCount === 1
          ? "Task added"
          : `${taskCount} tasks added`;
  const outcomeText =
    step.ui?.widget === "task_added" && tool === "create_tasks"
      ? taskOutcome
      : outcome(tool, step.status);
  const visibleDetail = detail === outcomeText ? null : detail;

  return (
    <ToolBeatRow aria-live={live ? "polite" : undefined}>
      <ToolBeatIcon tone={step.status === "error" ? "error" : "muted"}>
        {live ? (
          <Spinner className="size-3.5" />
        ) : step.status === "error" ? (
          <AlertCircleIcon aria-hidden="true" className="size-3.5" />
        ) : (
          <FamilyIcon family={family} className="size-3.5" />
        )}
      </ToolBeatIcon>
      <div className="min-w-0">
        <p
          className={cn(
            "min-w-0 text-sm font-medium leading-5 text-foreground",
            step.status === "error" && "text-destructive",
          )}
        >
          {outcomeText}
        </p>
        {live ? (
          <div className="mt-1.5 space-y-1.5">
            <Skeleton className="h-3 w-48 max-w-full" />
            <Skeleton className="h-3 w-28 max-w-[60%]" />
          </div>
        ) : visibleDetail !== null ? (
          <p
            className={cn(
              "mt-0.5 max-w-[65ch] text-xs leading-5 text-muted-foreground",
              step.status === "error" && "text-[var(--danger-fg)]",
            )}
            role={step.status === "error" ? "alert" : undefined}
          >
            {visibleDetail}
          </p>
        ) : null}
        {taskPreview(step)}
      </div>
    </ToolBeatRow>
  );
}
