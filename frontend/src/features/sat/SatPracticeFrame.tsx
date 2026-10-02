import type React from "react";

import { BeamsBackground } from "@/app/shell/BeamsBackground";
import { cn } from "@/lib/utils";

/** The full-viewport focus environment: the shell's quiet beams, no sidebar.
 * Every practice state (loading, error, empty, the question itself) renders
 * inside it so none of them falls back to a flat grey page. */
export function SatPracticeFrame({
  children,
  className,
  ref,
  ...props
}: React.ComponentProps<"div">): React.ReactElement {
  return (
    <div
      className={cn(
        "relative isolate flex h-dvh min-w-0 flex-col overflow-hidden bg-[var(--canvas)]",
        className,
      )}
      ref={ref}
      {...props}
    >
      <BeamsBackground quiet />
      {children}
    </div>
  );
}
