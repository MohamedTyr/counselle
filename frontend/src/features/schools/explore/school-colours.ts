import table from "@/features/schools/explore/school-colours.json";

/*
 * Each school's colour, derived once from its favicon by
 * `scripts/build_school_colours.py`: the fill the card is tinted with, and
 * the same hue darkened until it reads as text on white. Schools whose
 * favicon has no dominant colour are absent and render in neutral grey.
 */
const COLOURS: Record<string, string[] | undefined> = table;

export type SchoolColour = { fill: string; ink: string };

export function schoolColour(unitid: number): SchoolColour | null {
  const [fill, ink] = COLOURS[String(unitid)] ?? [];
  return fill && ink ? { fill, ink } : null;
}
