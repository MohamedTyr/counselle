import { forwardRef } from "react";

import { cn } from "@/lib/utils";
import { satScrollFadeClass } from "@/features/sat/sat-chrome-styles";
import { SatContent } from "@/features/sat/SatContent";

export interface SatPassagePaneProps {
  contentSha: string;
  stimulus: string;
}

/** The left column of an R&W question with a stimulus (ui-spec §4, Q11):
 * its own scroll container beside the question, resets to top on navigation
 * via `key` in the parent (Q11a). Stacked on a phone it stops scrolling and
 * flows with the page, so there is never a scroll inside a scroll. Ref is
 * forwarded so `useSatHighlighter` can walk its text nodes (plan §6.3). */
export const SatPassagePane = forwardRef<HTMLDivElement, SatPassagePaneProps>(
  function SatPassagePane({ contentSha, stimulus }, ref) {
    return (
      <div
        className={cn(
          "h-full min-w-0 overflow-y-auto px-4 py-5 [scrollbar-gutter:stable] min-[861px]:px-10 min-[861px]:py-8 max-[860px]:h-auto max-[860px]:overflow-visible max-[860px]:border-b max-[860px]:border-[var(--hairline)]",
          satScrollFadeClass,
        )}
        ref={ref}
      >
        <div className="mx-auto min-w-0 max-w-[65ch] text-wrap-pretty">
          <SatContent
            className="sat-content--reading"
            contentSha={contentSha}
            field="stimulus"
            html={stimulus}
          />
        </div>
      </div>
    );
  },
);
