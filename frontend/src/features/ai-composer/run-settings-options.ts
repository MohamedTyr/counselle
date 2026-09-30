import {
  BrainCircuit,
  MessagesSquare,
  Search,
  Target,
  Zap,
  type LucideIcon,
} from "lucide-react";

import googleLogo from "@/assets/app-shell/google.svg";
import harvardLogo from "@/assets/app-shell/harvard.png";
import redditLogo from "@/assets/app-shell/reddit.svg";
import type {
  CounselingMode,
  ResponseMode,
  SourceConfig,
} from "@/api/chat/types";

type ModeLook = {
  /** The one word the bar and the segmented control show. */
  short: string;
  /** How far the mode digs, 1 to 3: drawn as the bar's depth meter. */
  depth: 1 | 2 | 3;
  icon: LucideIcon;
};

const MODE_LOOKS: Record<string, ModeLook> = {
  "focused-answer": { short: "Focused", depth: 1, icon: Target },
  "guided-counselor": { short: "Guided", depth: 2, icon: MessagesSquare },
  "deep-research": { short: "Research", depth: 3, icon: Search },
};

export function modeLook(mode: CounselingMode): ModeLook {
  return (
    MODE_LOOKS[mode.skillName] ?? {
      short: mode.displayName.split(" ")[0],
      depth: 1,
      icon: Target,
    }
  );
}

export const SPEED_LOOKS: Record<
  ResponseMode,
  { label: string; icon: LucideIcon }
> = {
  quick: { label: "Quick", icon: Zap },
  think: { label: "Think", icon: BrainCircuit },
};

export type SourceKey = "webSearch" | "eduSources" | "reddit";

export type SourceOption = {
  key: SourceKey;
  /** The full name, used as the control's accessible name. */
  label: string;
  short: string;
  logo: string;
};

export const SOURCE_OPTIONS: readonly SourceOption[] = [
  { key: "webSearch", label: "Web search", short: "Web", logo: googleLogo },
  { key: "eduSources", label: ".edu sources", short: ".edu", logo: harvardLogo },
  { key: "reddit", label: "Reddit communities", short: "Reddit", logo: redditLogo },
];

export function enabledSourceCount(sourceConfig: SourceConfig) {
  return SOURCE_OPTIONS.filter((source) => sourceConfig[source.key]).length;
}
