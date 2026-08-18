import { Button } from "@/components/ui/button";

/**
 * Page-level fetch-error card, DESIGN.md §1.9 #1 — the Schools error card
 * verbatim so it looks native across the app. Owned by P6a; see the note in
 * `cds-format.ts` about why this exists here already.
 */
export function CdsErrorCard({
  title,
  message,
  onRetry,
}: {
  title: string;
  message: string;
  onRetry: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card p-6">
      <div className="max-w-md space-y-3">
        <h2 className="font-heading text-lg font-medium">{title}</h2>
        <p className="text-sm text-muted-foreground">{message}</p>
        <Button onClick={onRetry}>Try again</Button>
      </div>
    </div>
  );
}
