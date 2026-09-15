import { cn } from "@/lib/utils";

import type { CalloutLayout } from "./academic-comparison-geometry";
import type { GpaCallout } from "./GpaComparison";

export function GpaMarkerRail({
  callouts,
  layout,
}: {
  callouts: GpaCallout[];
  layout: CalloutLayout;
}) {
  if (!callouts.length) return null;
  return (
    <div
      className={cn(
        "relative text-xs font-medium tabular-nums",
        layout === "value-row"
          ? "flex flex-wrap gap-x-3 gap-y-1 border-t border-[var(--school-chances-divider)] pt-2"
          : "h-14",
      )}
      data-callout-layout={layout}
      data-slot="gpa-comparison-markers"
      data-testid="gpa-marker-rail"
    >
      {layout === "rail" ? (
        <svg
          aria-hidden="true"
          className={cn("absolute inset-0 h-full w-full")}
          data-slot="gpa-comparison-callout-leaders"
          preserveAspectRatio="none"
          viewBox="0 0 100 56"
        >
          {callouts.map((callout, index) => (
            <path
              d={`M 50 ${index === 0 ? 14 : 38} H ${callout.position * 100} V 56`}
              fill="none"
              key={`${callout.variant}-${callout.label}`}
              stroke="var(--school-chances-profile-outline)"
              strokeWidth="1"
            />
          ))}
        </svg>
      ) : null}
      {callouts.map((callout, index) => (
        <span
          className={cn(
            layout === "separate" && "absolute",
            layout === "rail" &&
              (index === 0
                ? "absolute left-1/2 top-0 -translate-x-1/2"
                : "absolute left-1/2 top-6 -translate-x-1/2"),
          )}
          data-placement={callout.placement}
          key={`${callout.variant}-${callout.label}`}
          style={
            layout === "separate" ? calloutStyle(callout.position) : undefined
          }
        >
          {callout.label}
        </span>
      ))}
    </div>
  );
}

export function GpaEdgeTicks({ callouts }: { callouts: GpaCallout[] }) {
  const edges = callouts.filter((callout) => callout.placement !== undefined);
  if (!edges.length) return null;
  return (
    <div
      aria-hidden="true"
      className={cn("pointer-events-none absolute inset-0")}
      data-slot="gpa-comparison-edge-marks"
    >
      {edges.map((callout) => (
        <span
          className={cn(
            "absolute inset-y-0 border-l border-[var(--school-chances-profile-outline)]",
            callout.placement === "below-edge" ? "left-0" : "right-0",
            callout.variant === "profile" && "border-dashed",
            callout.variant === "scenario" && "border-l-2",
          )}
          data-placement={callout.placement}
          key={`${callout.variant}-${callout.label}`}
        />
      ))}
    </div>
  );
}

function calloutStyle(position: number): React.CSSProperties {
  if (position <= 0) return { left: "0%" };
  if (position >= 1) return { left: "100%", transform: "translateX(-100%)" };
  return { left: `${position * 100}%`, transform: "translateX(-50%)" };
}
