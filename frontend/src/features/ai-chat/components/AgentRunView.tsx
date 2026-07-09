import {
  CheckCircle2Icon,
  ChevronRightIcon,
  CircleIcon,
  LoaderCircleIcon,
  XCircleIcon,
} from "lucide-react";
import { useState } from "react";

import type { SourceEntry, StepData } from "@/api/chat/types";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

import { CitationRenderer } from "./CitationRenderer";

export { ToolStepBeat } from "./ToolWidgets";

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

/** Compact plan rendering for places that intentionally show a plan summary.
 * The chronological run itself renders `write_plan` as a normal tool beat. */
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

/** The agent's loud talk — response text, so it uses the same
 * markdown/citation renderer as the final answer. */
export function NarrationBeat({
  text,
  sources,
  onCitationOpen,
}: {
  text: string;
  sources?: SourceEntry[];
  onCitationOpen?: (index: number) => void;
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
          className={cn("size-3.5 shrink-0 transition-transform", open && "rotate-90")}
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
