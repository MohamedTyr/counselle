import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverTitle,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { PromptChange } from "@/domain/essay";
import { useSupplementActions } from "@/features/essays/supplement-actions";
import { cn } from "@/lib/utils";

/* When the school rewords or drops a prompt this essay answers. Warning tone
 * because it needs the student (§14): their draft may answer the old
 * question. The essay itself is never changed, so this only informs. */
export function PromptChangeNotice({
  change,
  className,
  essayId,
  prompt,
}: {
  change: PromptChange;
  className?: string;
  essayId: string;
  prompt: string | null;
}) {
  const actions = useSupplementActions();
  if (change.kind === "removed") {
    return (
      <p className={cn("text-xs font-medium text-(--warning-fg)", className)}>
        The school no longer asks this prompt
      </p>
    );
  }
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "relative z-10 w-fit rounded-sm text-start text-xs font-medium text-(--warning-fg) underline decoration-current/40 underline-offset-2 outline-none hover:decoration-current focus-visible:ring-2 focus-visible:ring-(--focus-ring)",
          className,
        )}
      >
        Prompt updated by the school · Review
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(26rem,calc(100vw-2rem))]">
        <PopoverTitle className="text-sm font-semibold">
          The school changed this prompt
        </PopoverTitle>
        <PopoverDescription className="mt-1 text-xs text-muted-foreground">
          Your draft is unchanged. Check it still answers the new prompt.
        </PopoverDescription>
        <dl className="mt-3 flex flex-col gap-3 text-[13px] leading-5">
          {change.previous ? (
            <div>
              <dt className="text-xs font-medium text-muted-foreground">Before</dt>
              <dd className="mt-0.5 text-muted-foreground line-through decoration-muted-foreground/50">
                {change.previous}
              </dd>
            </div>
          ) : null}
          <div>
            <dt className="text-xs font-medium text-muted-foreground">Now</dt>
            <dd className="mt-0.5 whitespace-pre-line">{prompt ?? "not available"}</dd>
          </div>
        </dl>
        <div className="mt-4 flex justify-end">
          <Button
            disabled={actions.isAcknowledging}
            onClick={() => actions.acknowledge(essayId)}
            size="sm"
            variant="outline"
          >
            Mark as reviewed
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
