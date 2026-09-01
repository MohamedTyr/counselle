import { AccordionItem, AccordionPanel, AccordionTrigger } from "@/components/ui/accordion";
import type { ReviewSection as ReviewSectionData } from "@/api/cds-admin/types";
import { FlagChip } from "@/features/cds-admin/cds-status";
import { MetricRow } from "@/features/cds-admin/review/MetricRow";
import { sectionLetter } from "@/features/cds-admin/review/review-order";
import {
  countSectionUnresolved,
  sectionRailSeverity,
  sortMetricsFlaggedFirst,
} from "@/features/cds-admin/review/flag-queue";
import { cn } from "@/lib/utils";

const railClass = {
  error: "border-l-2 border-destructive",
  warning: "border-l-2 border-warning",
  none: "border-l-2 border-transparent",
} as const;

/** One CDS domain's accordion item (§5.6). The panel is genuinely unmounted
 * when collapsed (base-ui's default, no `keepMounted`) — with ~1,149
 * metrics across a manifest, that's what keeps the DOM small enough to
 * skip virtualisation entirely (§5.1.3/§8). */
export function ReviewSection({
  section,
  documentId,
  flaggedFirst,
  readOnly,
}: {
  section: ReviewSectionData;
  documentId: number;
  flaggedFirst: boolean;
  readOnly: boolean;
}) {
  const letter = sectionLetter(section);
  const verified = section.counts.verified ?? 0;
  const total = section.metrics.length;
  const unresolved = countSectionUnresolved(section);
  const rail = sectionRailSeverity(section);
  const metrics = sortMetricsFlaggedFirst(section.metrics, flaggedFirst);

  return (
    <AccordionItem className={cn(railClass[rail ?? "none"])} value={section.domain_id}>
      <AccordionTrigger className="px-3 py-2.5 text-sm">
        <span className="font-heading text-base font-medium">
          {letter ? `${letter}. ${section.title}` : section.title}
        </span>
        <span className="flex-1" />
        <span className="text-xs text-muted-foreground tabular-nums">
          {verified}/{total} verified
        </span>
        {unresolved > 0 && (
          <FlagChip
            ariaLabel={`${unresolved} unresolved flag${unresolved === 1 ? "" : "s"} in this section`}
            code={String(unresolved)}
            severity={rail ?? "warning"}
          />
        )}
      </AccordionTrigger>
      <AccordionPanel className="px-3">
        {metrics.map((metric) => (
          <MetricRow
            documentId={documentId}
            domainId={section.domain_id}
            key={metric.ref}
            metric={metric}
            readOnly={readOnly}
          />
        ))}
      </AccordionPanel>
    </AccordionItem>
  );
}
