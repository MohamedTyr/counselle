import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  LoaderCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";

import type {
  ReplaySourceEntry,
  SourceFocus,
  StepData,
} from "@/api/chat/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Meter, MeterIndicator, MeterTrack } from "@/components/ui/meter";
import { cn } from "@/lib/utils";

import { CitationRenderer } from "./CitationRenderer";
import { ToolBeatIcon, ToolBeatLabel, ToolBeatRow } from "./ToolBeat";

export { ToolStepBeat } from "./ToolWidgets";

function PlanStatusIcon({
  isLive,
  status,
}: {
  isLive: boolean;
  status: string;
}) {
  if (status === "completed") {
    return <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-3.5" />;
  }
  if (status === "in_progress") {
    return (
      <LoaderCircleIcon
        aria-hidden="true"
        className={cn("mt-0.5 size-3.5", isLive && "animate-spin")}
      />
    );
  }
  if (status === "cancelled") {
    return <XCircleIcon aria-hidden="true" className="mt-0.5 size-3.5" />;
  }
  return <CircleIcon aria-hidden="true" className="mt-0.5 size-3.5" />;
}

/** Compact plan rendering for places that intentionally show a plan summary.
 * The chronological run itself renders `write_plan` as a normal tool beat.
 * `isLive` gates the in-progress spinner — a finished or cancelled run must
 * settle, not lie about activity. */
export function PlanChecklist({
  isLive = false,
  step,
}: {
  isLive?: boolean;
  step: StepData;
}) {
  const items = step.detail?.items ?? [];
  if (items.length === 0) {
    return null;
  }

  const completed =
    step.detail?.completed ??
    items.filter((item) => item.status === "completed").length;
  const total = step.detail?.total ?? items.length;
  const remaining = items.filter(
    (item) => item.status === "pending" || item.status === "in_progress",
  ).length;

  return (
    <div className="not-prose mb-3 rounded-lg bg-[var(--control-track)] px-3.5 py-3">
      <div className="mb-2.5 flex items-center justify-between gap-3">
        <div>
          <span className="text-sm font-medium text-foreground">Plan</span>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {remaining === 0
              ? "All steps complete"
              : `${remaining} ${remaining === 1 ? "step" : "steps"} remaining`}
          </p>
        </div>
        <span
          className="rounded-full bg-[var(--surface-raised)] px-2 py-1 text-xs tabular-nums text-muted-foreground"
          aria-label={`${completed} of ${total} steps complete`}
        >
          {completed}/{total}
        </span>
      </div>
      <Meter
        aria-label="Plan progress"
        className="mb-3 gap-0"
        max={Math.max(total, 1)}
        value={completed}
      >
        <MeterTrack className="h-1 rounded-full">
          <MeterIndicator className="rounded-full transition-[transform] duration-200" />
        </MeterTrack>
      </Meter>
      <ol className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <li
            className={cn(
              "grid grid-cols-[16px_1fr] gap-2 text-xs leading-5",
              item.status === "completed"
                ? "text-muted-foreground"
                : "text-foreground",
            )}
            key={`${item.content}-${index}`}
          >
            <PlanStatusIcon isLive={isLive} status={item.status} />
            <span>
              <span className="sr-only">
                {item.status.replaceAll("_", " ")}:{" "}
              </span>
              {item.content}
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The agent's loud talk — response text, so it uses the same
 * markdown/citation renderer as the final answer. */
export function NarrationBeat({
  text,
  sources,
  onCitationOpen,
}: {
  text: string;
  sources?: ReplaySourceEntry[];
  onCitationOpen?: (focus: SourceFocus) => void;
}) {
  return (
    <div className="py-1">
      <CitationRenderer
        markdown={text}
        onCitationOpen={onCitationOpen}
        sources={sources}
      />
    </div>
  );
}

/** Native provider thought output — collapsed by default, one episode per
 * continuous thinking run, expandable inline. */
export function ThinkingBeat({
  id,
  isLive = false,
  text,
}: {
  id: string;
  isLive?: boolean;
  text: string;
}) {
  const [open, setOpen] = useState(false);
  const contentId = `thinking-content-${id}`;
  const label = isLive ? "Thinking" : "Thought";

  return (
    <Collapsible className="not-prose py-1" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        className="flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        id={contentId}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "size-3.5 shrink-0 transition-transform",
            open && "rotate-90",
          )}
        />
        <span className={cn(isLive && "animate-pulse")}>{label}</span>
      </CollapsibleTrigger>
      <CollapsibleContent aria-labelledby={contentId}>
        {text.trim().length > 0 && (
          <p className="mt-1 pl-[18px] text-[13px] whitespace-pre-wrap text-muted-foreground italic">
            {text}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export function StartingRunBeat() {
  return (
    <ToolBeatRow aria-live="polite" aria-atomic="true">
      <ToolBeatIcon>
        <LoaderCircleIcon
          aria-hidden="true"
          className="size-3.5 motion-safe:animate-spin"
        />
      </ToolBeatIcon>
      <div className="min-w-0">
        <ToolBeatLabel state="running">Starting response...</ToolBeatLabel>
      </div>
    </ToolBeatRow>
  );
}
