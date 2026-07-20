import {
  AlertCircleIcon,
  CheckIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  GlobeIcon,
  SearchIcon,
} from "lucide-react";
import { useState } from "react";

import type { StepData, StepSource } from "@/api/chat/types";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { safeExternalUrl } from "../citations";
import { dedupeStepSources } from "./activity-trace-helpers";
import { ToolBeatIcon, ToolBeatLabel, ToolBeatSubtitle } from "./ToolBeat";
import {
  toolBeatEnter,
  toolChipClass,
  toolMoreChipClass,
} from "./tool-beat-style";

type SearchToolWidgetProps = Readonly<{
  isLiveSegment?: boolean;
  step: StepData;
}>;

function sourceHost(source: StepSource): string {
  const href = safeExternalUrl(source.url);
  if (href === undefined) return source.label;
  try {
    return new URL(href).hostname.replace(/^www\./, "");
  } catch {
    return source.label;
  }
}

function SourceIcon({
  source,
  className,
}: {
  source: StepSource;
  className?: string;
}) {
  return source.favicon === undefined ? (
    <GlobeIcon
      aria-hidden="true"
      className={cn("shrink-0 text-muted-foreground", className)}
    />
  ) : (
    <img
      alt=""
      className={cn("shrink-0 rounded-[3px]", className)}
      src={source.favicon}
    />
  );
}

function ResultChip({ source }: { source: StepSource }) {
  const href = safeExternalUrl(source.url);
  const title = source.title ?? source.label;
  const content = (
    <>
      <SourceIcon className="size-3.5" source={source} />
      <span className="min-w-0 truncate">{title}</span>
      {href !== undefined && (
        <ExternalLinkIcon
          aria-hidden="true"
          className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70"
        />
      )}
      {href !== undefined && (
        <span className="sr-only"> (opens in a new tab)</span>
      )}
    </>
  );
  const className = cn(toolChipClass(true), "group max-w-[15rem]");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {href === undefined ? (
          <span className={className}>{content}</span>
        ) : (
          <a className={className} href={href} rel="noreferrer" target="_blank">
            {content}
          </a>
        )}
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{title}</TooltipContent>
    </Tooltip>
  );
}

function ExpandedResult({ source }: { source: StepSource }) {
  const href = safeExternalUrl(source.url);
  const title = source.title ?? source.label;
  const row = (
    <>
      <SourceIcon className="mt-0.5 size-4" source={source} />
      <span className="min-w-0 flex-1">
        <span className="block text-sm leading-5 text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          {sourceHost(source)}
        </span>
      </span>
      {href !== undefined && (
        <ExternalLinkIcon
          aria-hidden="true"
          className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
        />
      )}
    </>
  );

  return href === undefined ? (
    <li className="flex min-h-11 items-start gap-2.5 rounded-md px-2 py-2">
      {row}
    </li>
  ) : (
    <li>
      <a
        className="flex min-h-11 items-start gap-2.5 rounded-md px-2 py-2 transition-colors duration-200 hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
        href={href}
        rel="noreferrer"
        target="_blank"
      >
        {row}
        <span className="sr-only"> (opens in a new tab)</span>
      </a>
    </li>
  );
}

function searchScope(step: StepData): string {
  if (step.kind === "edu_search")
    return step.detail?.domains?.[0] ?? "Official site";
  if (step.kind === "reddit_search") return "Community";
  return "Open web";
}

function SearchStatus({ step, isLive }: { step: StepData; isLive: boolean }) {
  const iconClass = "size-3.5";
  if (step.status === "start") {
    return isLive ? (
      <Spinner className={iconClass} />
    ) : (
      <SearchIcon aria-hidden="true" className={iconClass} />
    );
  }
  if (step.status === "error")
    return <AlertCircleIcon aria-hidden="true" className={iconClass} />;
  return <CheckIcon aria-hidden="true" className={iconClass} />;
}

export function SearchToolWidget({
  isLiveSegment = false,
  step,
}: SearchToolWidgetProps) {
  const [open, setOpen] = useState(false);
  const sources = dedupeStepSources(step.sources);
  const resultCount = step.detail?.result_count ?? sources.length;
  const isRunning = step.status === "start";
  const isError = step.status === "error";
  const hiddenAfterTwo = Math.max(sources.length - 2, 0);
  const hiddenAfterThree = Math.max(sources.length - 3, 0);
  const resultNoun = step.kind === "reddit_search" ? "thread" : "result";
  const countSummary =
    sources.length > 0 && sources.length !== resultCount
      ? `${sources.length.toLocaleString()} of ${resultCount.toLocaleString()} ${resultNoun}${resultCount === 1 ? "" : "s"} available`
      : `${resultCount.toLocaleString()} ${resultNoun}${resultCount === 1 ? "" : "s"}`;

  return (
    <TooltipProvider>
      <Collapsible
        aria-live="polite"
        className={cn(
          "not-prose @container/search grid grid-cols-[16px_minmax(0,1fr)] gap-3 py-2",
          toolBeatEnter,
        )}
        onOpenChange={setOpen}
        open={open}
      >
        <ToolBeatIcon tone={isError ? "error" : "muted"}>
          <SearchStatus isLive={isLiveSegment} step={step} />
        </ToolBeatIcon>
        <div className="min-w-0">
          <ToolBeatLabel
            state={isRunning ? "running" : isError ? "error" : "settled"}
          >
            {step.label}
          </ToolBeatLabel>

          {!isRunning && (
            <ToolBeatSubtitle tone={isError ? "error" : "muted"}>
              {isError ? "Search unavailable" : countSummary}
              <span aria-hidden="true"> · </span>
              {searchScope(step)}
            </ToolBeatSubtitle>
          )}

          {isRunning && (
            <div
              aria-label="Searching for results"
              className="mt-2 flex gap-1.5"
            >
              <Skeleton className="h-11 w-36" />
              <Skeleton className="h-11 w-24" />
            </div>
          )}

          {!isRunning && !isError && sources.length > 0 && (
            <>
              <div
                className="mt-2 flex min-w-0 flex-wrap gap-1.5 data-[open=true]:hidden"
                data-open={open}
              >
                {sources.slice(0, 2).map((source) => (
                  <ResultChip
                    key={source.url ?? source.label}
                    source={source}
                  />
                ))}
                {sources[2] !== undefined && (
                  <span className="hidden @xl/search:inline-flex">
                    <ResultChip source={sources[2]} />
                  </span>
                )}
                {hiddenAfterTwo > 0 && (
                  <CollapsibleTrigger
                    className={cn(toolMoreChipClass(), "@xl/search:hidden")}
                  >
                    +{hiddenAfterTwo}
                    <span className="sr-only"> more results</span>
                  </CollapsibleTrigger>
                )}
                {hiddenAfterThree > 0 && (
                  <CollapsibleTrigger
                    className={cn(
                      toolMoreChipClass(),
                      "hidden @xl/search:inline-flex",
                    )}
                  >
                    +{hiddenAfterThree}
                    <span className="sr-only"> more results</span>
                  </CollapsibleTrigger>
                )}
              </div>

              <CollapsibleContent className="mt-3 overflow-hidden rounded-lg bg-muted/30 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-top-1 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-top-1 motion-reduce:animate-none">
                <div className="flex min-h-11 items-center justify-between gap-3 border-b border-border/60 px-2.5">
                  <span className="text-xs font-medium text-foreground">
                    {sources.length} available {resultNoun}
                    {sources.length === 1 ? "" : "s"}
                  </span>
                  <CollapsibleTrigger className="inline-flex min-h-11 cursor-pointer items-center gap-1 px-1 text-xs text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    Collapse{" "}
                    <ChevronUpIcon aria-hidden="true" className="size-3.5" />
                  </CollapsibleTrigger>
                </div>
                <ol className="p-1">
                  {sources.map((source) => (
                    <ExpandedResult
                      key={source.url ?? source.label}
                      source={source}
                    />
                  ))}
                </ol>
              </CollapsibleContent>
            </>
          )}

          {!isRunning && !isError && resultCount === 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              No useful results found for this search.
            </p>
          )}
        </div>
      </Collapsible>
    </TooltipProvider>
  );
}
