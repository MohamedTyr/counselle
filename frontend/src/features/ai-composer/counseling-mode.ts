import type { CounselingMode } from "@/api/chat/types";
import type { ChatMessage } from "@/features/ai-chat/model";

export type SplitSelectedSkills = {
  modeSkill: string | null;
  taskSkills: string[];
};

function modeNameSet(modes: readonly CounselingMode[]): Set<string> {
  return new Set(modes.map((mode) => mode.skillName));
}

export function findCounselingMode(
  modes: readonly CounselingMode[],
  skillName: string | null | undefined,
): CounselingMode | null {
  if (!skillName) {
    return null;
  }
  return modes.find((mode) => mode.skillName === skillName) ?? null;
}

export function defaultCounselingMode(
  modes: readonly CounselingMode[],
): CounselingMode | null {
  return modes.find((mode) => mode.isDefault) ?? null;
}

export function splitSelectedSkills(
  skills: readonly string[],
  modes: readonly CounselingMode[],
): SplitSelectedSkills {
  const modeNames = modeNameSet(modes);
  let modeSkill: string | null = null;
  const taskSkills: string[] = [];

  for (const skill of skills) {
    if (modeNames.has(skill)) {
      modeSkill ??= skill;
    } else {
      taskSkills.push(skill);
    }
  }

  return { modeSkill, taskSkills };
}

export function mergeModeAndTaskSkills(
  modeSkill: string | null | undefined,
  taskSkills: readonly string[],
): string[] {
  return modeSkill ? [modeSkill, ...taskSkills] : [...taskSkills];
}

export function deriveHistoricalModeSkill(
  messages: readonly ChatMessage[],
  modes: readonly CounselingMode[],
): string | null {
  const modeNames = modeNameSet(modes);
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.kind !== "user" || message.synthesized === true) {
      continue;
    }
    const modeSkill = message.skills?.find((skill) => modeNames.has(skill));
    if (modeSkill) {
      return modeSkill;
    }
  }
  return defaultCounselingMode(modes)?.skillName ?? null;
}

export function filterModeSkills(
  skills: readonly string[],
  modes: readonly CounselingMode[],
): string[] {
  const modeNames = modeNameSet(modes);
  return skills.filter((skill) => !modeNames.has(skill));
}
