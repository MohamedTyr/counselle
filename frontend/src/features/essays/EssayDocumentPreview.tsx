import { FileText } from "lucide-react";
import { motion } from "motion/react";

import type { Essay } from "@/domain/essay";

type EssayDocumentPreviewProps = {
  essay: Essay;
  layoutId?: string;
};

export function EssayDocumentPreview({
  essay,
  layoutId,
}: EssayDocumentPreviewProps) {
  const hasContent = essay.previewLines.length > 0;

  return (
    <motion.div
      className="h-52 overflow-hidden font-document text-(--essay-document-foreground)"
      layoutId={layoutId}
      transition={{ layout: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } }}
    >
      {hasContent ? (
        <div className="mx-auto flex h-full max-w-[30rem] flex-col overflow-hidden">
          <h3 className="mb-5 truncate text-center text-[8px] leading-tight font-semibold">
            {essay.previewTitle}
          </h3>
          <div className="flex flex-col gap-2.5 overflow-hidden">
            {essay.previewLines.map((line) => (
              <p
                className="text-[7.5px] leading-[1.78] text-(--essay-document-muted)"
                key={line}
              >
                {line}
              </p>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-3 text-(--essay-document-muted)">
          <FileText aria-hidden="true" />
          <span className="text-xs">Blank essay</span>
        </div>
      )}
    </motion.div>
  );
}
