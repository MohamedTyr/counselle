import { DatabaseZap } from "lucide-react";

import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

/**
 * The 503 "not configured" state, DESIGN.md §1.9 #2 — rendered identically
 * on all three CDS admin screens. No retry button: retrying can't fix a
 * missing environment variable. Owned by P6a; see the note in
 * `cds-format.ts` about why this exists here already.
 */
export function CdsUnavailable() {
  return (
    <Empty className="rounded-xl border bg-card">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <DatabaseZap />
        </EmptyMedia>
        <EmptyTitle>CDS admin isn't configured</EmptyTitle>
        <EmptyDescription>
          This server has no pipeline database connection. Set{" "}
          <code>COUNSELLE_DB_PIPELINE_DSN</code> and restart.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
