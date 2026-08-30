import { Upload } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";

function HiddenFileInput({
  inputRef,
  onFilesSelected,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  onFilesSelected: (files: File[]) => void;
}) {
  return (
    <label className="sr-only">
      Choose Common Data Set PDF files
      <input
        accept="application/pdf"
        multiple
        onChange={(event) => {
          if (event.target.files) {
            onFilesSelected(Array.from(event.target.files));
          }
          event.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />
    </label>
  );
}

/** DESIGN.md §4.5. Hero when the batch is empty, a slim strip once rows
 * exist — the zone's prominence is inversely proportional to how much work
 * is already staged. Both variants share the page-level `isDragging`
 * signal for their highlight; see `cds-upload-page.tsx` for why drag
 * listeners live on the section, not here (a nested listener would double
 * -handle every drop). */
export function FileDropZone({
  className,
  isDragging,
  onFilesSelected,
  variant,
}: {
  className?: string;
  isDragging: boolean;
  onFilesSelected: (files: File[]) => void;
  variant: "hero" | "strip";
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  if (variant === "hero") {
    return (
      <div
        className={cn(
          "rounded-xl border border-dashed p-12 transition-colors",
          isDragging && "border-ring bg-accent/50",
          className,
        )}
      >
        {/* `md:p-0` as well as `p-0`: `Empty`'s own `md:py-20` is a different
            breakpoint, so `twMerge` keeps both and the zone renders ~460px tall
            — the wrapper's `p-12` is the only padding this needs. */}
        <Empty className="p-0 md:p-0">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Upload />
            </EmptyMedia>
            <EmptyTitle className="font-heading text-lg font-medium">
              Drop Common Data Set PDFs here
            </EmptyTitle>
            <EmptyDescription>
              School and year are detected automatically.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => inputRef.current?.click()} type="button">
              Choose files
            </Button>
            <span className="text-xs text-muted-foreground">
              PDF only · up to 50 MB each
            </span>
          </EmptyContent>
        </Empty>
        <HiddenFileInput inputRef={inputRef} onFilesSelected={onFilesSelected} />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-14 items-center justify-center gap-2 rounded-lg border border-dashed text-sm text-muted-foreground transition-colors",
        isDragging && "border-ring bg-accent/50",
        className,
      )}
    >
      Drop more PDFs, or
      <Button onClick={() => inputRef.current?.click()} size="sm" type="button" variant="link">
        choose files
      </Button>
      <HiddenFileInput inputRef={inputRef} onFilesSelected={onFilesSelected} />
    </div>
  );
}

/** The whole-page drop overlay (§4.5) — aiming at a 56px strip is annoying
 * once rows exist, so any drag anywhere on the page renders this instead.
 * The only entry/exit motion this component owns; degrades to an instant
 * swap under reduced motion (§1.11). */
export function PageDropOverlay({
  reduceMotion,
  visible,
}: {
  reduceMotion: boolean;
  visible: boolean;
}) {
  return (
    <AnimatePresence>
      {visible ? (
        <motion.div
          animate={reduceMotion ? undefined : { opacity: 1 }}
          className="pointer-events-none absolute inset-4 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-ring bg-background/80"
          exit={reduceMotion ? undefined : { opacity: 0 }}
          initial={reduceMotion ? false : { opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.15 }}
        >
          <p className="font-heading text-lg font-medium">
            Drop to add to this batch
          </p>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
