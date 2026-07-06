import type { ChatConfigWire, ComposerConfig } from "@/api/chat/types"
import {
  BUILT_IN_SOURCE_CONFIG,
  fromWireSourceConfig,
} from "@/api/chat/source-config"

export const FALLBACK_GREETING = "Where should we begin?"

type ResolveComposerConfigInput =
  | {
      status: "success"
      config: ChatConfigWire
    }
  | {
      status: "error"
    }

export function resolveComposerConfig(
  input: ResolveComposerConfigInput,
): ComposerConfig {
  if (input.status === "error") {
    return {
      greeting: FALLBACK_GREETING,
      sourceConfig: BUILT_IN_SOURCE_CONFIG,
    }
  }

  return {
    greeting: input.config.greeting.trim() || FALLBACK_GREETING,
    sourceConfig: fromWireSourceConfig(input.config.default_source_config),
  }
}
