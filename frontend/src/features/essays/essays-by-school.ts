import type { ApplicationView } from "@/api/workspace/types";
import type { Essay } from "@/domain/essay";

export type SchoolEssayGroup = {
  application: ApplicationView;
  essays: Essay[];
};

export type EssaysBySchool = {
  /* The one essay every school reads. A second personal statement (a
   * duplicate, a rewrite) is still an essay the student owns, so it falls
   * through to `unlinked` rather than disappearing. */
  personalStatement: Essay | null;
  schools: SchoolEssayGroup[];
  /* Essays tied to no school on the list: extra personal statements,
   * scholarship and optional essays, and any whose school was removed. */
  unlinked: Essay[];
};

/* Ready and Submitted are the two states where nothing is left to write. */
export function isEssayDone(essay: Essay) {
  return essay.status === "Ready" || essay.status === "Submitted";
}

/* Earliest deadline first, so the school that needs work soonest leads.
 * Plain ISO dates compare correctly as strings; undated schools go last. */
function compareSchools(a: SchoolEssayGroup, b: SchoolEssayGroup) {
  const left = a.application.deadline;
  const right = b.application.deadline;
  if (left !== right) {
    if (!left) return 1;
    if (!right) return -1;
    return left < right ? -1 : 1;
  }
  return a.application.school_name.localeCompare(b.application.school_name);
}

export function groupEssaysBySchool(
  essays: Essay[],
  applications: ApplicationView[],
): EssaysBySchool {
  const byApplication = new Map<string, Essay[]>(
    applications.map((application) => [application.id, []]),
  );
  let personalStatement: Essay | null = null;
  const unlinked: Essay[] = [];

  for (const essay of essays) {
    const schoolEssays = essay.applicationId
      ? byApplication.get(essay.applicationId)
      : undefined;
    if (schoolEssays) {
      schoolEssays.push(essay);
    } else if (essay.type === "Personal statement" && !personalStatement) {
      personalStatement = essay;
    } else {
      unlinked.push(essay);
    }
  }

  const schools = applications
    .map((application) => ({
      application,
      essays: byApplication.get(application.id) ?? [],
    }))
    .sort(compareSchools);

  return { personalStatement, schools, unlinked };
}
