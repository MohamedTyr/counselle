import type { SkillCatalogEntry } from "@/api/chat/types";

export type SkillPickerOption = SkillCatalogEntry;

export type SkillTextSelection = {
  start: number;
  end: number;
};

export type SkillPickerAnnouncement = string | null;
