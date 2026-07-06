import type { SourceConfig, SourceConfigWire, Subreddit } from "@/api/chat/types"

// Frontend-visible subreddit toggles only. The backend may expand a `null`
// reddit_subreddits value to an internal `{school}` search slot; that pseudo
// subreddit is agent behavior, not a user-facing filter.
export const FULL_SUBREDDIT_MENU: readonly Subreddit[] = [
  "r/ApplyingToCollege",
  "r/chanceme",
  "r/financialaid",
  "r/premed",
  "r/csMajors",
]

export const BUILT_IN_SOURCE_CONFIG: SourceConfig = {
  webSearch: true,
  eduSources: true,
  reddit: true,
  selectedSubreddits: [...FULL_SUBREDDIT_MENU],
}

const fullBareMenu = FULL_SUBREDDIT_MENU.map(stripPrefix)
const knownBareMenu = new Set(fullBareMenu)

function stripPrefix(subreddit: string) {
  return subreddit.replace(/^r\//, "")
}

function cloneDefaults(): SourceConfig {
  return {
    ...BUILT_IN_SOURCE_CONFIG,
    selectedSubreddits: [...FULL_SUBREDDIT_MENU],
  }
}

function sameMembers(left: readonly string[], right: readonly string[]) {
  if (left.length !== right.length) {
    return false
  }
  const rightSet = new Set(right)
  return left.every((item) => rightSet.has(item))
}

export function toWireSourceConfig(config: SourceConfig): SourceConfigWire {
  const selectedBare = config.selectedSubreddits.map(stripPrefix)

  return {
    web: config.webSearch,
    edu: config.eduSources,
    reddit: config.reddit,
    reddit_subreddits: sameMembers(selectedBare, fullBareMenu)
      ? null
      : selectedBare,
  }
}

function boolOrDefault(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback
}

function subredditsFromWire(value: unknown): Subreddit[] {
  if (!Array.isArray(value)) {
    return [...FULL_SUBREDDIT_MENU]
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .filter((item) => knownBareMenu.has(item))
    .map((item) => `r/${item}` as Subreddit)
}

export function fromWireSourceConfig(wire: unknown): SourceConfig {
  if (wire === null || typeof wire !== "object") {
    return cloneDefaults()
  }

  const config = wire as Partial<SourceConfigWire>

  return {
    webSearch: boolOrDefault(config.web, BUILT_IN_SOURCE_CONFIG.webSearch),
    eduSources: boolOrDefault(config.edu, BUILT_IN_SOURCE_CONFIG.eduSources),
    reddit: boolOrDefault(config.reddit, BUILT_IN_SOURCE_CONFIG.reddit),
    selectedSubreddits:
      config.reddit_subreddits === null ||
      config.reddit_subreddits === undefined
        ? [...FULL_SUBREDDIT_MENU]
        : subredditsFromWire(config.reddit_subreddits),
  }
}
