import {
  AlertCircleIcon,
  CheckSquare2Icon,
  ChevronUpIcon,
  FilePenLineIcon,
  FileTextIcon,
  SearchIcon,
  SchoolIcon,
  SparklesIcon,
  TrophyIcon,
} from "lucide-react";
import { useState } from "react";

import type { StepData, WorkspacePreviewItem } from "@/api/chat/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { ToolBeatIcon, ToolBeatLabel, ToolBeatSubtitle } from "./ToolBeat";
import { toolBeatEnter, toolMoreChipClass } from "./tool-beat-style";

type Props = Readonly<{ isLiveSegment?: boolean; step: StepData }>;

function itemIcon(kind: WorkspacePreviewItem["kind"]) {
  const className = "size-3.5";
  if (kind === "task")
    return <CheckSquare2Icon aria-hidden="true" className={className} />;
  if (kind === "school")
    return <SchoolIcon aria-hidden="true" className={className} />;
  if (kind === "essay")
    return <FilePenLineIcon aria-hidden="true" className={className} />;
  if (kind === "activity")
    return <SparklesIcon aria-hidden="true" className={className} />;
  if (kind === "honor")
    return <TrophyIcon aria-hidden="true" className={className} />;
  return <FileTextIcon aria-hidden="true" className={className} />;
}

/** The kind of workspace surface a read touches — so the rail glyph names the
 * subject ("tasks", "schools") instead of a generic, contentless check. */
function railIcon(tool: string | undefined) {
  const className = "size-3.5";
  if (tool === "view_tasks" || tool === "search_tasks")
    return <CheckSquare2Icon className={className} />;
  if (
    tool === "view_schools" ||
    tool === "search_schools" ||
    tool === "get_school"
  )
    return <SchoolIcon className={className} />;
  if (tool === "view_essays" || tool === "read_essay")
    return <FilePenLineIcon className={className} />;
  if (tool === "view_documents" || tool === "read_document")
    return <FileTextIcon className={className} />;
  if (tool === "view_activities") return <SparklesIcon className={className} />;
  return <SearchIcon className={className} />;
}

function isIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function titleCase(value: string): string {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function displayMeta(label: string, value: string): string {
  if (
    (label === "Due" || label === "Deadline" || label === "Uploaded") &&
    isIsoDate(value)
  ) {
    const date = new Date(`${value}T00:00:00`);
    return `${label} ${new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
    }).format(date)}`;
  }
  if (label === "Tasks" || label === "Essays")
    return `${value} ${label.toLowerCase()}`;
  if (label === "Words") return `${value} words`;
  if (label === "Category" || label === "Round" || label === "Type")
    return titleCase(value);
  return value;
}

function metadata(item: WorkspacePreviewItem): string[] {
  const facts = item.meta.map(({ label, value }) => displayMeta(label, value));
  if (item.status && item.status !== "active")
    facts.push(titleCase(item.status));
  return facts;
}

function PreviewItem({
  item,
  compact = false,
}: {
  item: WorkspacePreviewItem;
  compact?: boolean;
}) {
  const facts = metadata(item);
  return (
    <div
      className={cn(
        "flex min-w-0 items-start gap-2.5 rounded-md",
        compact
          ? "min-h-11 max-w-[17rem] bg-muted/60 px-2.5 py-1.5"
          : "min-h-11 px-2 py-2",
      )}
    >
      <span className="flex h-5 shrink-0 items-center text-muted-foreground">
        {itemIcon(item.kind)}
      </span>
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            "block text-sm leading-5 text-foreground/90",
            compact ? "line-clamp-2" : "break-words text-pretty",
          )}
          title={compact ? item.title : undefined}
        >
          {item.title}
        </span>
        {facts.length > 0 && (
          <span className="block truncate text-xs leading-4 text-muted-foreground">
            {facts.join(" · ")}
          </span>
        )}
      </span>
    </div>
  );
}

function completedLabel(step: StepData): string {
  if (step.status !== "end") return step.label;
  return step.label
    .replace(/^Checking /, "Checked ")
    .replace(/^Searching /, "Searched ")
    .replace(/^Reading /, "Read ")
    .replace(/^Looking inside /, "Checked ");
}

function emptyCopy(tool: string | undefined): string {
  if (tool === "search_tasks")
    return "No tasks matched this search. Try a different keyword.";
  if (tool === "search_schools")
    return "No colleges matched this search. Try the official name.";
  if (tool === "view_tasks") return "Your task list is clear right now.";
  if (tool === "view_schools")
    return "There aren’t any colleges on your list yet.";
  if (tool === "view_essays") return "Your essay library is empty right now.";
  if (tool === "view_documents")
    return "You haven’t uploaded any documents yet.";
  if (tool === "view_activities")
    return "No activities or honors are on file yet.";
  return "Nothing was available to preview.";
}

function groupedItems(items: WorkspacePreviewItem[]) {
  const groups = new Map<string, WorkspacePreviewItem[]>();
  for (const item of items) {
    const key = item.group ?? "Results";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups.entries()];
}

export function WorkspaceReadWidget({ isLiveSegment = false, step }: Props) {
  const [open, setOpen] = useState(false);
  const items = step.detail?.workspace_items ?? [];
  const total = step.detail?.result_count ?? items.length;
  const running = step.status === "start";
  const failed = step.status === "error";
  const single = ["get_school", "read_essay", "read_document"].includes(
    step.tool ?? "",
  );
  const hiddenAfterTwo = Math.max(items.length - 2, 0);
  const hiddenAfterThree = Math.max(items.length - 3, 0);
  const summary =
    items.length > 0 && items.length < total
      ? `${items.length} of ${total} results available`
      : (step.detail?.summary ?? `${total} result${total === 1 ? "" : "s"}`);

  return (
    <Collapsible
      aria-live="polite"
      className={cn(
        "not-prose @container/workspace grid grid-cols-[16px_minmax(0,1fr)] gap-3 py-2",
        toolBeatEnter,
      )}
      onOpenChange={setOpen}
      open={open}
    >
      <ToolBeatIcon tone={failed ? "error" : "muted"}>
        {running && isLiveSegment ? (
          <Spinner className="size-3.5" />
        ) : failed ? (
          <AlertCircleIcon className="size-3.5" />
        ) : (
          railIcon(step.tool)
        )}
      </ToolBeatIcon>

      <div className="min-w-0">
        <ToolBeatLabel
          state={running ? "running" : failed ? "error" : "settled"}
        >
          {completedLabel(step)}
        </ToolBeatLabel>

        {!running && (
          <ToolBeatSubtitle tone={failed ? "error" : "muted"}>
            {failed ? (step.detail?.error ?? "Workspace unavailable") : summary}
          </ToolBeatSubtitle>
        )}

        {running && (
          <div
            aria-label="Loading workspace results"
            className="mt-2 flex gap-1.5"
          >
            <Skeleton className="h-11 w-44 rounded-md" />
            <Skeleton className="h-11 w-32 rounded-md" />
          </div>
        )}

        {!running && !failed && items.length > 0 && single && (
          <div className="mt-2 max-w-xl rounded-md bg-muted/35 p-1">
            <PreviewItem item={items[0]} />
          </div>
        )}

        {!running && !failed && items.length > 0 && !single && (
          <>
            <div
              className="mt-2 flex min-w-0 flex-wrap gap-1.5 data-[open=true]:hidden"
              data-open={open}
            >
              {items.slice(0, 2).map((item, index) => (
                <PreviewItem
                  compact
                  item={item}
                  key={`${item.kind}-${item.title}-${index}`}
                />
              ))}
              {items[2] !== undefined && (
                <span className="hidden @xl/workspace:block">
                  <PreviewItem compact item={items[2]} />
                </span>
              )}
              {hiddenAfterTwo > 0 && (
                <CollapsibleTrigger
                  aria-label={`Show ${hiddenAfterTwo} more workspace items`}
                  className={cn(toolMoreChipClass(), "@xl/workspace:hidden")}
                >
                  +{hiddenAfterTwo}
                  <span className="sr-only"> more workspace items</span>
                </CollapsibleTrigger>
              )}
              {hiddenAfterThree > 0 && (
                <CollapsibleTrigger
                  aria-label={`Show ${hiddenAfterThree} more workspace items`}
                  className={cn(
                    toolMoreChipClass(),
                    "hidden @xl/workspace:inline-flex",
                  )}
                >
                  +{hiddenAfterThree}
                  <span className="sr-only"> more workspace items</span>
                </CollapsibleTrigger>
              )}
            </div>

            <CollapsibleContent className="mt-3 overflow-hidden rounded-lg bg-muted/25 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 motion-reduce:animate-none">
              <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border/60 px-2.5">
                <span className="text-xs font-medium text-foreground">
                  {items.length} available
                </span>
                <CollapsibleTrigger className="inline-flex min-h-11 cursor-pointer items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  Collapse{" "}
                  <ChevronUpIcon aria-hidden="true" className="size-3.5" />
                </CollapsibleTrigger>
              </div>
              <div className="p-1">
                {groupedItems(items).map(([group, groupItems]) => (
                  <section aria-label={group} key={group}>
                    {group !== "Results" && (
                      <h4 className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                        {group}
                      </h4>
                    )}
                    <div className="divide-y divide-border/50">
                      {groupItems.map((item, index) => (
                        <PreviewItem
                          item={item}
                          key={`${item.kind}-${item.title}-${index}`}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </CollapsibleContent>
          </>
        )}

        {!running && !failed && total === 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {emptyCopy(step.tool)}
          </p>
        )}
      </div>
    </Collapsible>
  );
}
