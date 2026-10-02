import { useMemo } from "react";

import type { ApplicationView, EssaySummary } from "@/api/workspace/types";

/** Id → record maps for the rows and the detail panel, built once per list. */
export function useTaskLookups(
  applications: ApplicationView[],
  essays: EssaySummary[],
) {
  const applicationsById = useMemo(
    () =>
      new Map(applications.map((application) => [application.id, application])),
    [applications],
  );
  const essaysById = useMemo(
    () => new Map(essays.map((essay) => [essay.id, essay])),
    [essays],
  );
  return { applicationsById, essaysById };
}
