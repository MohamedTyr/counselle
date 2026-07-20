import {
  AlertCircleIcon,
  BarChart3Icon,
  BookOpenIcon,
  CheckIcon,
  DatabaseIcon,
  SchoolIcon,
  SparklesIcon,
} from "lucide-react";

import type { StepData } from "@/api/chat/types";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

import {
  ToolBeatIcon,
  ToolBeatLabel,
  ToolBeatRow,
  ToolBeatSubtitle,
} from "./ToolBeat";
import { toolChipClass } from "./tool-beat-style";

type Props = Readonly<{ isLiveSegment?: boolean; step: StepData }>;

function settledLabel(step: StepData): string {
  if (step.status !== "end") return step.label;
  if (step.tool === "query_database") return "Checked the admissions database";
  if (step.tool === "render_viz")
    return step.label.replace(/^Building /, "Prepared ");
  return step.label
    .replace(/^Consulting /, "Consulted ")
    .replace(/^Working: /, "Used ");
}

function subtitle(step: StepData): string | null {
  if (step.status === "error")
    return step.detail?.error ?? "This read was unavailable";
  if (step.detail?.summary) return step.detail.summary;
  if (step.tool === "query_database") return "Official admissions data";
  if (step.tool === "load_skill") return "Guidance applied to this answer";
  if (step.tool === "render_viz") {
    const count = step.detail?.schools?.length ?? 0;
    return count > 0 ? `${count} schools compared` : "Visualization prepared";
  }
  return "Read completed";
}

function ToolIcon({ tool }: { tool: string | undefined }) {
  const className = "size-3.5";
  if (tool === "query_database")
    return <DatabaseIcon aria-hidden="true" className={className} />;
  if (tool === "load_skill")
    return <BookOpenIcon aria-hidden="true" className={className} />;
  if (tool === "render_viz")
    return <BarChart3Icon aria-hidden="true" className={className} />;
  return <SparklesIcon aria-hidden="true" className={className} />;
}

export function OtherReadWidget({ isLiveSegment = false, step }: Props) {
  const running = step.status === "start";
  const failed = step.status === "error";
  const schools =
    step.tool === "render_viz" ? (step.detail?.schools ?? []) : [];

  return (
    <ToolBeatRow aria-live="polite">
      <ToolBeatIcon tone={failed ? "error" : "muted"}>
        {running && isLiveSegment ? (
          <Spinner className="size-3.5" />
        ) : running ? (
          <ToolIcon tool={step.tool} />
        ) : failed ? (
          <AlertCircleIcon className="size-3.5" />
        ) : (
          <CheckIcon className="size-3.5" />
        )}
      </ToolBeatIcon>

      <div className="min-w-0">
        <ToolBeatLabel
          state={running ? "running" : failed ? "error" : "settled"}
        >
          {settledLabel(step)}
        </ToolBeatLabel>
        {!running && subtitle(step) !== null && (
          <ToolBeatSubtitle tone={failed ? "error" : "muted"}>
            {subtitle(step)}
          </ToolBeatSubtitle>
        )}

        {!running && !failed && schools.length > 0 && (
          <div
            className="mt-2 flex flex-wrap gap-1.5"
            aria-label="Schools in this visualization"
          >
            {schools.slice(0, 3).map((school) => (
              <span className={cn(toolChipClass(), "max-w-56")} key={school}>
                <SchoolIcon
                  aria-hidden="true"
                  className="size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="truncate" title={school}>
                  {school}
                </span>
              </span>
            ))}
            {schools.length > 3 && (
              <span className={cn(toolChipClass(), "text-muted-foreground")}>
                +{schools.length - 3}
              </span>
            )}
          </div>
        )}
      </div>
    </ToolBeatRow>
  );
}
