import { motion } from "motion/react";

import type { Essay } from "@/domain/essay";
import { getPreviewLines } from "@/features/essays/essay-content";
import { cn } from "@/lib/utils";

type EssayDocumentPreviewProps = {
  essay: Essay;
  layoutId?: string;
};

/* The paper band fades into its own bottom edge so the excerpt reads as the
 * top of a page that continues, rather than a block of text that stops. */
const paperFade =
  "[-webkit-mask-image:linear-gradient(to_bottom,#000_76%,transparent_100%)] [mask-image:linear-gradient(to_bottom,#000_76%,transparent_100%)]";

export function EssayDocumentPreview({
  essay,
  layoutId,
}: EssayDocumentPreviewProps) {
  const previewLines = getPreviewLines(essay.preview);
  const prompt = essay.prompt?.trim();

  return (
    <motion.div
      className="relative h-28 overflow-hidden border-b border-(--essay-document-border) bg-(--essay-document-surface) font-document text-(--essay-document-foreground)"
      layoutId={layoutId}
      transition={{ layout: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}
    >
      {previewLines.length > 0 ? (
        <div className={cn("flex flex-col gap-2 px-4 pt-3.5", paperFade)}>
          {previewLines.map((line) => (
            <p className="text-[11px] leading-[1.6]" key={line}>
              {line}
            </p>
          ))}
        </div>
      ) : prompt ? (
        /* No draft yet, but the prompt is real data and it is the thing the
         * student has to answer — far more useful than a blank sheet. */
        <div className={cn("flex flex-col gap-1.5 px-4 pt-3.5", paperFade)}>
          <span className="font-sans text-[10px] font-medium text-(--ink-muted)">
            Prompt
          </span>
          <p className="text-[11px] leading-[1.6] text-(--essay-document-muted)">
            {prompt}
          </p>
        </div>
      ) : (
        // A label, not a control — no chip, no fill. The card is the button;
        // this only says what pressing it does, and warms its ink on hover so
        // it never reads as a second thing to click.
        <div className="flex size-full items-center justify-center">
          <span className="font-sans text-xs text-(--ink-muted) transition-colors duration-200 group-hover/essay-card:text-(--ink-secondary)">
            Start writing
          </span>
        </div>
      )}
    </motion.div>
  );
}
