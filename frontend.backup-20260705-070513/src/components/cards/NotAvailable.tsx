/**
 * The designed "not available" state (PRD story 29): muted, italic, dashed
 * underline — shared by the stat block and the comparison table so NA reads
 * identically everywhere.
 */
export function NotAvailableValue() {
  return (
    <span className="text-sm italic text-text-secondary underline decoration-dashed underline-offset-4">
      not available
    </span>
  );
}
