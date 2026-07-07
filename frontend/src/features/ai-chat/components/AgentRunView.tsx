import {
  CheckCircle2Icon,
  ChevronDownIcon,
  CircleIcon,
  LoaderCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { StepData } from "@/api/chat/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { safeExternalUrl } from "../citations";
import type { TimelineEntry, TurnStatus } from "../turn-reducer";
import {
  dedupeStepSources,
  formatDurationMs,
  isLiveStatus,
  latestPlanStep,
  MAX_VISIBLE_SOURCE_CHIPS,
  receiptText,
} from "./activity-trace-helpers";

export type AgentRunViewProps = {
  timeline: TimelineEntry[];
  status: TurnStatus;
  durationMs?: number;
};

const TICK_MS = 250;

function useElapsed(live: boolean): number {
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!live) {
      return undefined;
    }

    const start = Date.now();
    const id = setInterval(() => setElapsed(Date.now() - start), TICK_MS);
    return () => clearInterval(id);
  }, [live]);

  return elapsed;
}

function SourceChips({ step }: { step: StepData }) {
  const sources = dedupeStepSources(step.sources);
  const [expanded, setExpanded] = useState(false);

  if (sources.length === 0) {
    return null;
  }

  const visible = expanded ? sources : sources.slice(0, MAX_VISIBLE_SOURCE_CHIPS);
  const extra = sources.length - visible.length;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {visible.map((source, index) => {
        const href = safeExternalUrl(source.url);
        const className =
          "rounded-md border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground";

        return href === undefined ? (
          <span className={className} key={source.url ?? `${source.label}-${index}`}>
            {source.label}
          </span>
        ) : (
          <a
            className={cn(className, "hover:text-foreground")}
            href={href}
            key={source.url ?? `${source.label}-${index}`}
            rel="noreferrer"
            target="_blank"
          >
            {source.label}
          </a>
        );
      })}
      {extra > 0 && (
        <button
          aria-label={`Show ${extra} more ${extra === 1 ? "source" : "sources"}`}
          className="rounded px-1 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(true)}
          type="button"
        >
          +{extra} more
        </button>
      )}
    </div>
  );
}

function StepDot({ status }: { status: StepData["status"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "mt-1 size-2.5 justify-self-center rounded-full border",
        status === "end" && "border-transparent bg-muted-foreground",
        status === "error" && "border-transparent bg-destructive",
        status === "start" && "border-foreground",
      )}
    />
  );
}

function StepRow({ step }: { step: StepData }) {
  const receipt = receiptText(step);
  const labelClass = cn(
    "text-sm leading-normal",
    step.status === "start" ? "font-medium text-foreground" : "text-muted-foreground",
    step.status === "error" && "text-destructive",
  );

  return (
    <div className="grid grid-cols-[16px_1fr] gap-3 pb-3.5">
      <StepDot status={step.status} />
      <div className="min-w-0">
        <span className={labelClass}>{step.label}</span>
        {receipt !== null && (
          <p className="mt-0.5 text-xs text-muted-foreground">{receipt}</p>
        )}
        <SourceChips step={step} />
      </div>
    </div>
  );
}

function ThinkRow({ text }: { text: string }) {
  return (
    <div className="grid grid-cols-[16px_1fr] gap-3 pb-3.5">
      <span
        aria-hidden="true"
        className="mt-1.5 size-1.5 justify-self-center rounded-full bg-muted-foreground"
      />
      <p className="min-w-0 text-[13.5px] text-muted-foreground italic">{text}</p>
    </div>
  );
}

function PlanStatusIcon({ status }: { status: string }) {
  if (status === "completed") {
    return <CheckCircle2Icon aria-hidden="true" className="mt-0.5 size-3.5" />;
  }
  if (status === "in_progress") {
    return <LoaderCircleIcon aria-hidden="true" className="mt-0.5 size-3.5" />;
  }
  if (status === "cancelled") {
    return <XCircleIcon aria-hidden="true" className="mt-0.5 size-3.5" />;
  }
  return <CircleIcon aria-hidden="true" className="mt-0.5 size-3.5" />;
}

function PlanChecklist({ step }: { step: StepData }) {
  const items = step.detail?.items ?? [];
  if (items.length === 0) {
    return null;
  }

  const completed = step.detail?.completed ?? items.filter((item) => item.status === "completed").length;
  const total = step.detail?.total ?? items.length;

  return (
    <div className="mb-3 rounded-md border bg-muted/30 px-3 py-2.5">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="text-sm font-medium text-foreground">Plan</span>
        <span className="text-xs tabular-nums text-muted-foreground">
          {completed}/{total}
        </span>
      </div>
      <ol className="flex flex-col gap-1.5">
        {items.map((item, index) => (
          <li
            className={cn(
              "grid grid-cols-[16px_1fr] gap-2 text-xs leading-5",
              item.status === "completed" ? "text-muted-foreground" : "text-foreground",
            )}
            key={`${item.content}-${index}`}
          >
            <PlanStatusIcon status={item.status} />
            <span>{item.content}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function visibleTimelineEntries(timeline: TimelineEntry[]): TimelineEntry[] {
  return timeline.filter(
    (entry) => entry.type !== "step" || entry.step.kind !== "write_plan",
  );
}

function latestActivityLabel(entries: TimelineEntry[], planStep: StepData | null): string {
  const last = entries.at(-1);
  if (last === undefined) {
    return planStep !== null ? "Updating the plan" : "Starting agent run";
  }
  return last.type === "step" ? last.step.label : last.text;
}

export function AgentRunView({ timeline, status, durationMs }: AgentRunViewProps) {
  const live = isLiveStatus(status);
  const [open, setOpen] = useState(live);
  const wasLiveRef = useRef(live);
  const elapsed = useElapsed(live);
  const planStep = useMemo(() => latestPlanStep(timeline), [timeline]);
  const visibleEntries = useMemo(() => visibleTimelineEntries(timeline), [timeline]);

  useEffect(() => {
    const wasLive = wasLiveRef.current;
    wasLiveRef.current = live;
    if (!live || wasLive) {
      return undefined;
    }

    const id = window.setTimeout(() => setOpen(true), 0);
    return () => window.clearTimeout(id);
  }, [live]);

  if (timeline.length === 0 && !live) {
    return null;
  }

  const settledDuration =
    durationMs !== undefined ? `Thought for ${formatDurationMs(durationMs)}` : "Run trace";
  const headerLabel = live ? latestActivityLabel(visibleEntries, planStep) : settledDuration;
  const showStartingPlaceholder = visibleEntries.length === 0 && live && planStep === null;

  return (
    <div className="not-prose my-2">
      <Collapsible onOpenChange={setOpen} open={open}>
        <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md py-1 text-left text-muted-foreground transition-colors hover:text-foreground">
          <ChevronDownIcon
            aria-hidden="true"
            className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-180")}
          />
          <span className="min-w-0 flex-1 truncate text-[13px]">{headerLabel}</span>
          {live && (
            <span className="shrink-0 text-[13px] tabular-nums">
              {formatDurationMs(elapsed)}
            </span>
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-2.5">
          <div className="flex flex-col pl-0.5">
            {planStep !== null && <PlanChecklist step={planStep} />}
            {showStartingPlaceholder && (
              <p className="pb-3.5 pl-7 text-[13.5px] text-muted-foreground">
                Starting agent run
              </p>
            )}
            {visibleEntries.map((entry) =>
              entry.type === "step" ? (
                <StepRow key={`step-${entry.step.step_id}`} step={entry.step} />
              ) : (
                <ThinkRow key={entry.id} text={entry.text} />
              ),
            )}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
