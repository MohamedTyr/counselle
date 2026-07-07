import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  LoaderCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";

import type { StepData } from "@/api/chat/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { safeExternalUrl } from "../citations";
import { dedupeStepSources, MAX_VISIBLE_SOURCE_CHIPS, receiptText } from "./activity-trace-helpers";

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

/** One tool call, rendered inline at its point in the chronological stream
 * (running → done, per the target surface — no whole-trace drawer). */
export function ToolStepBeat({ step }: { step: StepData }) {
  const receipt = receiptText(step);
  const labelClass = cn(
    "text-sm leading-normal",
    step.status === "start" ? "font-medium text-foreground" : "text-muted-foreground",
    step.status === "error" && "text-destructive",
  );

  return (
    <div className="not-prose grid grid-cols-[16px_1fr] gap-3 py-1.5">
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

/** The pinned plan checklist — the latest `write_plan` update only; earlier
 * updates never render as their own rows (a plan is one evolving widget, not
 * a log of edits). */
export function PlanChecklist({ step }: { step: StepData }) {
  const items = step.detail?.items ?? [];
  if (items.length === 0) {
    return null;
  }

  const completed = step.detail?.completed ?? items.filter((item) => item.status === "completed").length;
  const total = step.detail?.total ?? items.length;

  return (
    <div className="not-prose mb-3 rounded-md border bg-muted/30 px-3 py-2.5">
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

/** The agent's loud talk — normal visible prose, not italic/muted (that
 * styling is reserved for the collapsed raw-thinking beat below). */
export function NarrationBeat({ text }: { text: string }) {
  return <p className="not-prose py-1 text-[13.5px] leading-relaxed text-foreground">{text}</p>;
}

/** Native raw reasoning (only emitted when `thinking_summaries` is on) —
 * collapsed by default, one line per occurrence, expandable inline. */
export function ThinkingBeat({ id, text }: { id: string; text: string }) {
  const [open, setOpen] = useState(false);
  const contentId = `thinking-content-${id}`;

  return (
    <Collapsible className="not-prose py-1" onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger
        className="flex items-center gap-1 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        id={contentId}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
        />
        <span>Thought{open ? "" : " for a moment"}</span>
      </CollapsibleTrigger>
      <CollapsibleContent aria-labelledby={contentId}>
        <p className="mt-1 pl-[18px] text-[13px] whitespace-pre-wrap text-muted-foreground italic">
          {text}
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
