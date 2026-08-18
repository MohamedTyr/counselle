import { Link } from "react-router";

import { Button } from "@/components/ui/button";

/** Every readiness/processed sentence is built as plain text (§the pure
 * builders in `staging-model.ts`/`document-status.ts` are what's tested);
 * this just re-emphasises the digit runs at render time so numbers get
 * `font-medium text-foreground tabular-nums` per DESIGN.md §4.7 without the
 * builders having to return JSX. */
function EmphasizedNumbers({ text }: { text: string }) {
  const parts = text.split(/(\d+)/g);
  return (
    <>
      {parts.map((part, index) =>
        /^\d+$/.test(part) ? (
          <span className="font-medium text-foreground tabular-nums" key={index}>
            {part}
          </span>
        ) : (
          part
        ),
      )}
    </>
  );
}

/** DESIGN.md §4.7 — sticky inside the page (not the viewport), so it
 * respects the sidebar. The blocking reason lives in the sentence itself,
 * never a tooltip on a disabled button. */
export function BatchActionBar({
  isBatchComplete,
  isProcessed,
  isProcessing,
  onProcess,
  readyCount,
  sentence,
}: {
  isBatchComplete: boolean;
  isProcessed: boolean;
  isProcessing: boolean;
  onProcess: () => void;
  readyCount: number;
  sentence: string;
}) {
  return (
    <div className="sticky bottom-0 -mx-6 flex shrink-0 items-center justify-between gap-4 border-t bg-background px-6 py-3 md:-mx-10 md:px-10">
      <p aria-live="polite" className="text-sm text-muted-foreground">
        <EmphasizedNumbers text={sentence} />
      </p>
      {isProcessed ? (
        isBatchComplete ? (
          <Button render={<Link to="/app/admin/cds" />} variant="outline">
            Open coverage
          </Button>
        ) : null
      ) : (
        <Button disabled={readyCount === 0} loading={isProcessing} onClick={onProcess}>
          Process all (<span className="tabular-nums">{readyCount}</span>)
        </Button>
      )}
    </div>
  );
}
