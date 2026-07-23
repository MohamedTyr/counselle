export const COUNSELING_MODE_DEFINITIONS = {
  "focused-answer": { order: 10, default: true },
  "deep-research": { order: 20, default: false },
  "guided-counselor": { order: 30, default: false },
} as const satisfies Record<string, { order: number; default: boolean }>;

export const COUNSELING_MODE_SKILL_NAMES = Object.keys(
  COUNSELING_MODE_DEFINITIONS,
);

export function isCounselingModeSkillName(skillName: string): boolean {
  return Object.hasOwn(COUNSELING_MODE_DEFINITIONS, skillName);
}
