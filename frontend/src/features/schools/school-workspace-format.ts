/*
 * Shared vocabulary for the school workspace surfaces.
 *
 * Extracted from SchoolWorkspace.tsx, which had grown to 1489 lines against
 * the 800-line house limit. Pure move: every function below is byte-identical
 * to what it replaced, so this file changes structure and nothing else.
 */

export function humanize(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (character) => character.toUpperCase());
}

export function cycleLabel(cycleYear: number | null | undefined) {
  return cycleYear
    ? `${cycleYear - 1}-${String(cycleYear).slice(-2)}`
    : "cycle not confirmed";
}
