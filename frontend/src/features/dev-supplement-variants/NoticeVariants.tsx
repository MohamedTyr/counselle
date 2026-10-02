import { ChevronDown, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { PromptChange } from "@/domain/essay";
import { useSupplementActions } from "@/features/essays/supplement-actions";
import { wordDiff } from "@/features/dev-supplement-variants/variant-utils";
import { cn } from "@/lib/utils";

/* Variant 4 alternatives for "the school changed this essay's prompt". Each
 * renders inside an essay row, under the title. */
type NoticeProps = {
  change: Extract<PromptChange, { kind: "updated" }>;
  essayId: string;
  prompt: string;
};

function Diff({ after, before }: { after: string; before: string }) {
  return (
    <p className="text-[13px] leading-6">
      {wordDiff(before, after).map((part, index) => (
        <span
          className={cn(
            part.kind === "added" && "rounded-[3px] bg-(--success-surface) text-(--success-fg)",
            part.kind === "removed" && "text-muted-foreground line-through decoration-muted-foreground/60",
          )}
          key={index}
        >
          {part.text}
        </span>
      ))}
    </p>
  );
}

function ReviewedButton({ essayId }: { essayId: string }) {
  const actions = useSupplementActions();
  return (
    <Button disabled={actions.isAcknowledging} onClick={() => actions.acknowledge(essayId)} size="sm" variant="outline">
      Mark as reviewed
    </Button>
  );
}

/* A: badge. A warning badge beside the status says "changed" in two words;
 * the badge opens the comparison with the changes marked. */
export function NoticeVariantA({ change, essayId, prompt }: NoticeProps) {
  return (
    <Popover>
      <PopoverTrigger className="relative z-10 w-fit rounded-md outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)">
        <Badge variant="warning">Prompt changed</Badge>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))]">
        <PopoverTitle className="text-sm font-semibold">What the school changed</PopoverTitle>
        <PopoverDescription className="mt-1 text-xs text-muted-foreground">
          Your draft is unchanged. Removed words are struck out, new words are highlighted.
        </PopoverDescription>
        <div className="mt-3"><Diff after={prompt} before={change.previous ?? ""} /></div>
        <div className="mt-4 flex justify-end"><ReviewedButton essayId={essayId} /></div>
      </PopoverContent>
    </Popover>
  );
}

/* B: banner. A warning strip inside the row that cannot be missed; the full
 * before/after opens in a dialog with room to read both versions. */
export function NoticeVariantB({ change, essayId, prompt }: NoticeProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="relative z-10 flex items-center gap-2 rounded-lg bg-(--warning-surface) px-2.5 py-2 text-xs text-(--warning-fg)">
        <TriangleAlert aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 font-medium">The school reworded this prompt</span>
        <button
          className="shrink-0 rounded-sm font-semibold underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
          onClick={() => setOpen(true)}
          type="button"
        >
          Compare versions
        </button>
      </div>
      <Dialog onOpenChange={setOpen} open={open}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>The school reworded this prompt</DialogTitle>
            <DialogDescription>Your draft is unchanged. Check it still answers the current prompt.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Before</p>
              <p className="mt-1 text-[13px] leading-6 text-muted-foreground">{change.previous}</p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">Now</p>
              <p className="mt-1 text-[13px] leading-6">{prompt}</p>
            </div>
          </div>
          <DialogFooter><ReviewedButton essayId={essayId} /></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/* C: inline diff. A quiet line that unfolds in place into the marked-up
 * change, so the student never leaves the list to see what moved. */
export function NoticeVariantC({ change, essayId, prompt }: NoticeProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative z-10">
      <button
        aria-expanded={open}
        className="flex items-center gap-1 rounded-sm text-xs font-medium text-(--warning-fg) outline-none focus-visible:ring-2 focus-visible:ring-(--focus-ring)"
        onClick={() => setOpen((v) => !v)}
        type="button"
      >
        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
        Prompt changed · see what changed
        <ChevronDown aria-hidden="true" className={cn("size-3.5 transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {open ? (
        <div className="mt-2 flex flex-col gap-3 border-s border-(--warning-fg)/40 ps-3">
          <Diff after={prompt} before={change.previous ?? ""} />
          <div><ReviewedButton essayId={essayId} /></div>
        </div>
      ) : null}
    </div>
  );
}
