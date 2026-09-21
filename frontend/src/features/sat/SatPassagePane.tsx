import { forwardRef } from "react";

import { SatContent } from "@/features/sat/SatContent";

export interface SatPassagePaneProps {
  contentSha: string;
  stimulus: string;
}

/** The left column of an R&W question with a stimulus (ui-spec §4, Q11):
 * its own scroll container, resets to top on navigation via `key` in the
 * parent (Q11a). Ref is forwarded so `useSatHighlighter` can walk its text
 * nodes (plan §6.3). */
export const SatPassagePane = forwardRef<HTMLDivElement, SatPassagePaneProps>(
  function SatPassagePane({ contentSha, stimulus }, ref) {
    return (
      <div className="h-full overflow-y-auto px-10 py-6" ref={ref}>
        <div className="mx-auto max-w-[65ch] text-base leading-[1.72] text-wrap-pretty">
          <SatContent contentSha={contentSha} field="stimulus" html={stimulus} />
        </div>
      </div>
    );
  },
);
