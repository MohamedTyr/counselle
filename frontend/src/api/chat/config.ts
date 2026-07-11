import { useQuery } from "@tanstack/react-query";

import { chatKeys } from "@/api/chat/hooks";
import { chatTransport } from "@/api/chat/transport";
import type {
  ChatConfigWire,
  ComposerConfig,
  SkillCatalogEntry,
} from "@/api/chat/types";
import {
  BUILT_IN_SOURCE_CONFIG,
  fromWireSourceConfig,
} from "@/api/chat/source-config";

export const FALLBACK_GREETING = "Where should we begin?";
const NO_SELECTED_SKILLS = 0;

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
    return {
      greeting: FALLBACK_GREETING,
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
      skills: [],
      maxSelectedSkills: NO_SELECTED_SKILLS,
    };
  }

  const skills = parseSkillCatalog(input.config.skills);
  const maxSelectedSkills = parseMaxSelectedSkills(
    input.config.max_selected_skills,
  );
  const supportsSkillPicker =
    skills.length > 0 && maxSelectedSkills > NO_SELECTED_SKILLS;

  return {
    greeting: input.config.greeting.trim() || FALLBACK_GREETING,
    sourceConfig: fromWireSourceConfig(input.config.default_source_config),
    skills: supportsSkillPicker ? skills : [],
    maxSelectedSkills: supportsSkillPicker
      ? maxSelectedSkills
      : NO_SELECTED_SKILLS,
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
