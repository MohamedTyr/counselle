import { useQuery } from "@tanstack/react-query";

import { chatKeys } from "@/api/chat/hooks";
import { chatTransport } from "@/api/chat/transport";
import type {
  ChatConfigWire,
  CounselingMode,
  ComposerConfig,
  SkillCatalogEntry,
} from "@/api/chat/types";
import {
  BUILT_IN_SOURCE_CONFIG,
  fromWireSourceConfig,
} from "@/api/chat/source-config";
import { resolveResponseModeCapability } from "@/api/chat/response-mode";
import { COUNSELING_MODE_DEFINITIONS } from "@/api/chat/counseling-mode";

export const FALLBACK_GREETING = "Where should we begin?";
const NO_SELECTED_SKILLS = 0;
const SUPPORTED_SKILL_MODE_NAMES = new Set(
  Object.keys(COUNSELING_MODE_DEFINITIONS),
);

type ResolveComposerConfigInput =
  | {
      status: "success";
      config: ChatConfigWire;
    }
  | {
      status: "error";
    };

function parseSkillCatalog(value: unknown): SkillCatalogEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const catalog: SkillCatalogEntry[] = [];
  const names = new Set<string>();
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") {
      return [];
    }
    const wire = entry as Partial<{
      name: unknown;
      display_name: unknown;
      description: unknown;
    }>;
    if (
      typeof wire.name !== "string" ||
      typeof wire.display_name !== "string" ||
      typeof wire.description !== "string" ||
      !wire.name ||
      !wire.display_name ||
      !wire.description ||
      names.has(wire.name)
    ) {
      return [];
    }
    names.add(wire.name);
    catalog.push({
      name: wire.name,
      displayName: wire.display_name,
      description: wire.description,
    });
  }
  return catalog;
}

function parseSkillModes(value: unknown): CounselingMode[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    return [];
  }

  const modes: CounselingMode[] = [];
  const names = new Set<string>();
  const orders = new Set<number>();
  let defaults = 0;
  for (const entry of value) {
    if (entry === null || typeof entry !== "object") {
      return [];
    }
    const wire = entry as Partial<{
      name: unknown;
      display_name: unknown;
      description: unknown;
      order: unknown;
      default: unknown;
    }>;
    if (
      typeof wire.name !== "string" ||
      typeof wire.display_name !== "string" ||
      typeof wire.description !== "string" ||
      typeof wire.order !== "number" ||
      typeof wire.default !== "boolean" ||
      !wire.name ||
      !wire.display_name ||
      !wire.description ||
      !Number.isSafeInteger(wire.order) ||
      wire.order < 0 ||
      names.has(wire.name) ||
      orders.has(wire.order)
    ) {
      return [];
    }
    const expected =
      COUNSELING_MODE_DEFINITIONS[
        wire.name as keyof typeof COUNSELING_MODE_DEFINITIONS
      ];
    if (
      expected === undefined ||
      wire.order !== expected.order ||
      wire.default !== expected.default
    ) {
      return [];
    }
    names.add(wire.name);
    orders.add(wire.order);
    defaults += wire.default ? 1 : 0;
    modes.push({
      skillName: wire.name,
      displayName: wire.display_name,
      description: wire.description,
      order: wire.order,
      isDefault: wire.default,
    });
  }

  if (
    modes.length !== SUPPORTED_SKILL_MODE_NAMES.size ||
    defaults !== 1 ||
    modes.some((mode) => !SUPPORTED_SKILL_MODE_NAMES.has(mode.skillName))
  ) {
    return [];
  }
  return [...modes].sort((left, right) => left.order - right.order);
}

function parseMaxSelectedSkills(value: unknown): number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value > NO_SELECTED_SKILLS
    ? value
    : NO_SELECTED_SKILLS;
}

export function resolveComposerConfig(
  input: ResolveComposerConfigInput,
): ComposerConfig {
  if (input.status === "error") {
    const capability = resolveResponseModeCapability({});
    return {
      greeting: FALLBACK_GREETING,
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
      skills: [],
      skillModes: [],
      defaultSkillMode: null,
      maxSelectedSkills: NO_SELECTED_SKILLS,
      defaultResponseMode: capability.defaultResponseMode,
      responseModes: [...capability.responseModes],
    };
  }

  const skills = parseSkillCatalog(input.config.skills);
  const skillModes = parseSkillModes(input.config.skill_modes);
  const maxSelectedSkills = parseMaxSelectedSkills(
    input.config.max_selected_skills,
  );
  const supportsSkillPicker =
    skills.length > 0 && maxSelectedSkills > NO_SELECTED_SKILLS;
  const capability = resolveResponseModeCapability(input.config);

  return {
    greeting: input.config.greeting.trim() || FALLBACK_GREETING,
    sourceConfig: fromWireSourceConfig(input.config.default_source_config),
    skills: supportsSkillPicker ? skills : [],
    skillModes,
    defaultSkillMode:
      skillModes.find((mode) => mode.isDefault === true) ?? null,
    maxSelectedSkills: supportsSkillPicker
      ? maxSelectedSkills
      : NO_SELECTED_SKILLS,
    defaultResponseMode: capability.defaultResponseMode,
    responseModes: [...capability.responseModes],
  };
}

/**
 * The composer boot payload is shared by the landing and in-session routes.
 * Keeping the query key here means a landing-page fetch is reused after the
 * redirect, while a direct session load still obtains the public skill catalog.
 */
export function useChatConfig() {
  const query = useQuery({
    queryKey: chatKeys.config(),
    queryFn: chatTransport.getChatConfig,
    retry: false,
  });

  const config =
    query.status === "success"
      ? resolveComposerConfig({ status: "success", config: query.data })
      : query.status === "error"
        ? resolveComposerConfig({ status: "error" })
        : null;

  return { ...query, config };
}
