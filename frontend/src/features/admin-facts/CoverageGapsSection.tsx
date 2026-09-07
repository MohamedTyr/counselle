import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { CoverageCounts } from "@/api/admin/facts-status";

/**
 * "Coverage gaps" (plan §5.5's "crosswalk gaps"). `FactsStatusResponse`
 * gives us aggregate counts only — no itemized list of which slugs or
 * schools are missing — so this stays two honest count lines rather than a
 * fabricated table with nothing real to put in its rows.
 */
export function CoverageGapsSection({ coverage }: { coverage: CoverageCounts }) {
  const [open, setOpen] = useState(false);
  const schoolsWithoutFacts = Math.max(0, coverage.schools_total - coverage.schools_with_facts);

  return (
    <Collapsible onOpenChange={setOpen} open={open}>
      <CollapsibleTrigger asChild>
        <Button className="w-full justify-between" variant="outline">
          <span>
            {coverage.crosswalk_unmatched} unmatched slugs · {schoolsWithoutFacts} schools with no
            facts on file
          </span>
          <span aria-hidden="true">{open ? "Hide" : "Show"}</span>
        </Button>
      </CollapsibleTrigger>
      <CollapsibleContent className="flex flex-col gap-1 pt-3 text-sm text-muted-foreground">
        <p>
          <span className="font-medium text-foreground tabular-nums">
            {coverage.crosswalk_unmatched}
          </span>{" "}
          CollegeData slugs have no matching unitid.
        </p>
        <p>
          <span className="font-medium text-foreground tabular-nums">{schoolsWithoutFacts}</span>{" "}
          of {coverage.schools_total} schools have no facts on file yet.
        </p>
      </CollapsibleContent>
    </Collapsible>
  );
}
