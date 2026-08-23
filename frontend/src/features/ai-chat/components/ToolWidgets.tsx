import {
  CalendarDaysIcon,
  CheckCircle2Icon,
  CirclePlusIcon,
  SchoolIcon,
  XCircleIcon,
} from "lucide-react";
import type React from "react";
import { useState } from "react";

import type { StepData, StepDetail } from "@/api/chat/types";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import { safeExternalUrl } from "../citations";
import {
  isHistoricalOverflowStep,
  schoolDataToolPresentation,
} from "./school-data-tool-presentation";
import { SchoolDataToolRow } from "./SchoolDataToolRow";
import {
  dedupeStepSources,
  isSearchKind,
  MAX_VISIBLE_SOURCE_CHIPS,
  receiptText,
} from "./activity-trace-helpers";
import { SearchToolWidget } from "./SearchToolWidget";
import {
  ToolBeatIcon,
  ToolBeatLabel,
  ToolBeatRow,
  ToolBeatSubtitle,
} from "./ToolBeat";
import { isOtherReadTool } from "./other-read-tools";
import { OtherReadWidget } from "./OtherReadWidget";
import { isWorkspaceReadTool } from "./workspace-read-tools";
import { WorkspaceReadWidget } from "./WorkspaceReadWidget";
import { isWriteTool } from "./write-tools";
import { WriteToolWidget } from "./WriteToolWidget";
import { MutationReceiptRenderer } from "./mutation-receipts/MutationReceiptRenderer";

type ToolWidgetProps = {
  isLiveSegment?: boolean;
  step: StepData;
};

type ToolWidgetComponent = (props: ToolWidgetProps) => React.ReactElement;

function SourceChips({ step }: { step: StepData }) {
  const sources = dedupeStepSources(step.sources);
  const [expanded, setExpanded] = useState(false);

  if (sources.length === 0) {
    return null;
  }

  const visible = expanded
    ? sources
    : sources.slice(0, MAX_VISIBLE_SOURCE_CHIPS);
  const extra = sources.length - visible.length;

  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {visible.map((source, index) => {
        const href = safeExternalUrl(source.url);
        const className =
          "rounded-md border bg-muted px-1.5 py-0.5 text-xs text-muted-foreground";

        return href === undefined ? (
          <span
            className={className}
            key={source.url ?? `${source.label}-${index}`}
          >
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
// Three genuinely distinct shapes, not three colors of the same dot: an
// unfilled ring while running, a filled circle when it settles cleanly, and
// a filled diamond on error — so status still reads on hover/print/
// colorblind-safe views where the muted-foreground/destructive tint alone
// wouldn't. See PRODUCT.md's "status is never color-alone" rule.
function StepDot({ status }: { status: StepData["status"] }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2.5 border",
        status === "start" && "rounded-full border-foreground",
        status === "end" &&
          "rounded-full border-transparent bg-muted-foreground",
        status === "error" &&
          "rounded-[2px] border-transparent bg-destructive rotate-45",
      )}
    />
  );
}

type DetailRow = {
  label: string;
  value: React.ReactNode;
};

function textRow(label: string, value: string | undefined): DetailRow | null {
  return value !== undefined && value.trim().length > 0
    ? { label, value }
    : null;
}

function numberRow(label: string, value: number | undefined): DetailRow | null {
  return typeof value === "number"
    ? { label, value: value.toLocaleString() }
    : null;
}

function listRow(
  label: string,
  values: string[] | undefined,
): DetailRow | null {
  const clean = values?.map((value) => value.trim()).filter(Boolean) ?? [];
  return clean.length > 0 ? { label, value: clean.join(", ") } : null;
}

function itemsRow(items: StepDetail["items"]): DetailRow | null {
  if (!Array.isArray(items) || items.length === 0) {
    return null;
  }

  return {
    label: "Items",
    value: (
      <ul className="list-disc space-y-0.5 pl-4">
        {items.map((item, index) => (
          <li key={`${item.content}-${index}`}>
            {item.content}
            {item.status !== undefined && (
              <span className="text-muted-foreground">
                {" "}
                ({item.status.replaceAll("_", " ")})
              </span>
            )}
          </li>
        ))}
      </ul>
    ),
  };
}

function progressRow(
  completed: number | undefined,
  total: number | undefined,
): DetailRow | null {
  if (typeof completed !== "number" && typeof total !== "number") {
    return null;
  }

  if (typeof completed === "number" && typeof total === "number") {
    return {
      label: "Progress",
      value: `${completed.toLocaleString()}/${total.toLocaleString()}`,
    };
  }

  return numberRow(
    completed === undefined ? "Total" : "Completed",
    completed ?? total,
  );
}

function detailRows(step: StepData): DetailRow[] {
  const detail = step.detail;
  if (detail === null) {
    return [];
  }

  return [
    isSearchKind(step.kind) ? textRow("Query", detail.query) : null,
    textRow("Summary", detail.summary),
    listRow("Domains", detail.domains),
    textRow("Domain", detail.domain_id),
    numberRow("Results", detail.result_count),
    numberRow("Values", detail.value_count),
    numberRow("Duration", detail.duration_ms),
    textRow("Tool", detail.tool),
    textRow("Visualization", detail.viz_type?.replaceAll("_", " ")),
    listRow("Schools", detail.schools),
    listRow("Sources", detail.sources),
    itemsRow(detail.items),
    progressRow(detail.completed, detail.total),
    listRow("Next", detail.next_actions),
    textRow("Error", detail.error),
  ].filter((row): row is DetailRow => row !== null);
}

function PublicStepDetails({ step }: { step: StepData }) {
  const rows = detailRows(step);

  if (rows.length === 0) {
    return null;
  }

  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none text-[var(--ink-secondary)] hover:text-foreground">
        Details
      </summary>
      <dl className="mt-2 grid gap-1.5">
        {rows.map((row) => (
          <div className="grid grid-cols-[96px_1fr] gap-2" key={row.label}>
            <dt className="font-medium text-muted-foreground">{row.label}</dt>
            <dd className="min-w-0 text-[var(--ink-secondary)]">{row.value}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

export function DefaultToolWidget({ step }: ToolWidgetProps) {
  const receipt = receiptText(step);

  return (
    <ToolBeatRow>
      <ToolBeatIcon tone={step.status === "error" ? "error" : "muted"}>
        <StepDot status={step.status} />
      </ToolBeatIcon>
      <div className="min-w-0">
        <ToolBeatLabel
          state={
            step.status === "start"
              ? "running"
              : step.status === "error"
                ? "error"
                : "settled"
          }
        >
          {step.label}
        </ToolBeatLabel>
        {receipt !== null && <ToolBeatSubtitle>{receipt}</ToolBeatSubtitle>}
        <PublicStepDetails step={step} />
        <SourceChips step={step} />
      </div>
    </ToolBeatRow>
  );
}

function stringValue(
  data: Record<string, unknown>,
  keys: string[],
): string | null {
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
  const title =
    stringValue(data, ["title", "task", "task_title"]) ?? step.label;
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
      <div className="min-w-0 rounded-md border bg-[var(--control-track)] px-3 py-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {step.status === "end" && (
                <CheckCircle2Icon
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground"
                />
              )}
              {step.status === "error" && (
                <XCircleIcon
                  aria-hidden="true"
                  className="size-3.5 text-destructive"
                />
              )}
              {step.status === "start" && <Spinner className="size-3.5" />}
              <span className="text-sm font-medium text-foreground">
                Task added
              </span>
            </div>
            <p className="mt-1 text-sm leading-normal text-foreground">
              {title}
            </p>
          </div>
          {status !== null && (
            <Badge
              size="sm"
              variant={step.status === "error" ? "error" : "secondary"}
            >
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

export function ToolStepBeat({ isLiveSegment = false, step }: ToolWidgetProps) {
  if (isHistoricalOverflowStep(step)) {
    return null;
  }

  const schoolDataPresentation = schoolDataToolPresentation(step);
  if (schoolDataPresentation !== null) {
    return (
      <SchoolDataToolRow
        isLive={isLiveSegment && step.status === "start"}
        presentation={schoolDataPresentation}
      />
    );
  }

  if (isSearchKind(step.kind)) {
    return <SearchToolWidget isLiveSegment={isLiveSegment} step={step} />;
  }

  if (isWorkspaceReadTool(step.tool)) {
    return <WorkspaceReadWidget isLiveSegment={isLiveSegment} step={step} />;
  }

  if (isOtherReadTool(step.tool)) {
    return <OtherReadWidget isLiveSegment={isLiveSegment} step={step} />;
  }

  if (isWriteTool(step.tool)) {
    // Routing priority (plan §11.1): a pending (start) write keeps the
    // existing presentation; a terminal write with the mutation-contract
    // marker routes to the typed receipt (which itself synthesizes a safe
    // "unknown" row if the nested mutation is missing/invalid — §6.7);
    // marker-absent terminal steps are pre-feature history and keep the
    // legacy fallback.
    if (step.status !== "start" && step.detail?.mutation_contract === 1) {
      return <MutationReceiptRenderer isLiveSegment={isLiveSegment} step={step} />;
    }
    return <WriteToolWidget isLiveSegment={isLiveSegment} step={step} />;
  }

  const Widget =
    step.ui?.widget !== undefined ? TOOL_WIDGETS[step.ui.widget] : undefined;
  return Widget === undefined ? (
    <DefaultToolWidget step={step} />
  ) : (
    <Widget step={step} />
  );
}
