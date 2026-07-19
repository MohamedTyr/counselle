import {
  CheckIcon,
  CircleAlertIcon,
  CircleMinusIcon,
  LoaderCircleIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

import type { SchoolDataToolPresentation } from "./school-data-tool-presentation";

type SchoolDataToolRowProps = {
  isLive: boolean;
  presentation: SchoolDataToolPresentation;
};

function StatusIcon({ isLive, presentation }: SchoolDataToolRowProps) {
  const className = cn(
    "absolute inset-0 size-3.5 transition-[opacity,color] duration-[175ms] ease-out motion-reduce:transition-none",
    presentation.state === "error"
      ? "text-destructive"
      : "text-muted-foreground",
  );

  return (
    <span aria-hidden="true" className="relative block size-3.5 shrink-0">
      <LoaderCircleIcon
        className={cn(
          className,
          presentation.icon === "loading" ? "opacity-100" : "opacity-0",
          presentation.icon === "loading" &&
            isLive &&
            "motion-safe:animate-spin",
        )}
      />
      <CheckIcon
        className={cn(
          className,
          presentation.icon === "check" ? "opacity-100" : "opacity-0",
        )}
      />
      <CircleMinusIcon
        className={cn(
          className,
          presentation.icon === "minus" ? "opacity-100" : "opacity-0",
        )}
      />
      <CircleAlertIcon
        className={cn(
          className,
          presentation.icon === "alert" ? "opacity-100" : "opacity-0",
        )}
      />
    </span>
  );
}

export function SchoolDataToolRow({
  isLive,
  presentation,
}: SchoolDataToolRowProps) {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className="not-prose grid min-h-7 grid-cols-[14px_minmax(0,1fr)] items-start gap-2.5 py-1"
      data-school-data-tool={presentation.tool}
    >
      <span className="flex h-5 items-center justify-center">
        <StatusIcon isLive={isLive} presentation={presentation} />
      </span>
      <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <span
          className={cn(
            "min-w-0 flex-[1_1_18rem] text-[13px] leading-5 [overflow-wrap:anywhere]",
            presentation.state === "error"
              ? "text-destructive"
              : "text-muted-foreground",
          )}
        >
          {presentation.label}
        </span>
        {presentation.metadata !== undefined && (
          <span className="basis-full text-xs leading-5 tabular-nums text-muted-foreground min-[420px]:basis-auto">
            {presentation.metadata}
          </span>
        )}
      </div>
    </div>
  );
}
