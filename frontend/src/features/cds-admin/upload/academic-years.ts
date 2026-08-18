/**
 * DESIGN.md §4.6 asks the Year select's options to come "from the API's
 * year list," but no endpoint on this screen's contract (`api/cds-admin/*`)
 * exposes one — `CoverageResult.years` belongs to the Coverage screen's own
 * query, and adding a new request just for a static option list was out of
 * scope. A generated range anchored on the current calendar year covers
 * every CDS document an admin will realistically stage. Deviation noted in
 * the PR description.
 */
const YEARS_BACK = 6;
const YEARS_FORWARD = 1;

/** Most recent first, e.g. `[2027, 2026, …, 2020]` for a 2026 reference date. */
export function buildAcademicYearOptions(referenceDate = new Date()): number[] {
  const currentYear = referenceDate.getFullYear();
  const years: number[] = [];
  for (let year = currentYear + YEARS_FORWARD; year >= currentYear - YEARS_BACK; year -= 1) {
    years.push(year);
  }
  return years;
}
