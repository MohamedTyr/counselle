import {
  CalendarDaysIcon,
  CheckCircle2Icon,
  CirclePlusIcon,
  SchoolIcon,
  XCircleIcon,
} from "lucide-react";
import type React from "react";
import { useState } from "react";

import type { StepData } from "@/api/chat/types";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { safeExternalUrl } from "../citations";
import { dedupeStepSources, MAX_VISIBLE_SOURCE_CHIPS, receiptText } from "./activity-trace-helpers";

type ToolWidgetProps = {
  step: StepData;
};

type ToolWidgetComponent = (props: ToolWidgetProps) => React.ReactElement;

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
        status === "start" && "border-foreground",
        status === "end" && "border-transparent bg-muted-foreground",
        status === "error" && "border-transparent bg-destructive",
      )}
    />
  );
}

export function DefaultToolWidget({ step }: ToolWidgetProps) {
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

function stringValue(data: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }

  return null;
}

function TaskAddedWidget({ step }: ToolWidgetProps) {
  const data = step.ui?.data ?? {};
  const title = stringValue(data, ["title", "task", "task_title"]) ?? step.label;
  const school = stringValue(data, ["school", "school_name"]);
  const dueDate = stringValue(data, ["due_date", "deadline", "due"]);
  const status = stringValue(data, ["status"]);

  return (
    <div className="not-prose grid grid-cols-[16px_1fr] gap-3 py-1.5">
      <CirclePlusIcon
        aria-hidden="true"
        className={cn(
          "mt-0.5 size-4 justify-self-center text-muted-foreground",
          step.status === "error" && "text-destructive",
        )}
      />
      <div className="min-w-0 rounded-md border bg-muted/30 px-3 py-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {step.status === "end" && (
                <CheckCircle2Icon aria-hidden="true" className="size-3.5 text-muted-foreground" />
              )}
              {step.status === "error" && (
                <XCircleIcon aria-hidden="true" className="size-3.5 text-destructive" />
              )}
              {step.status === "start" && <Spinner className="size-3.5" />}
              <span className="text-sm font-medium text-foreground">Task added</span>
            </div>
            <p className="mt-1 text-sm leading-normal text-foreground">{title}</p>
          </div>
          {status !== null && (
            <Badge size="sm" variant={step.status === "error" ? "error" : "secondary"}>
              {status}
            </Badge>
          )}
        </div>
        {(school !== null || dueDate !== null) && (
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
            {school !== null && (
              <span className="inline-flex items-center gap-1">
                <SchoolIcon aria-hidden="true" className="size-3.5" />
                {school}
              </span>
            )}
            {dueDate !== null && (
              <span className="inline-flex items-center gap-1">
                <CalendarDaysIcon aria-hidden="true" className="size-3.5" />
                {dueDate}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const TOOL_WIDGETS: Readonly<Record<string, ToolWidgetComponent>> = {
  task_added: TaskAddedWidget,
};

export function ToolStepBeat({ step }: ToolWidgetProps) {
  const Widget = step.ui?.widget !== undefined ? TOOL_WIDGETS[step.ui.widget] : undefined;
  return Widget === undefined ? <DefaultToolWidget step={step} /> : <Widget step={step} />;
}
