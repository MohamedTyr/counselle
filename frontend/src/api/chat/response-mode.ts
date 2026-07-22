import type {
  ChatConfigWire,
  ResponseMode,
  ResponseModeOption,
} from "@/api/chat/types";

export const BUILT_IN_DEFAULT_RESPONSE_MODE: ResponseMode = "quick";

/** Quick-only, no display metadata worth trusting — the safe degrade when the
 * server's capability payload is missing/malformed (plan §8.1). */
export const BUILT_IN_RESPONSE_MODE_OPTIONS: readonly ResponseModeOption[] = [
  { id: "quick", model: "", modelDisplayName: "Quick", preview: false },
];

export function isResponseMode(value: unknown): value is ResponseMode {
  return value === "quick" || value === "think";
}

/** A historical/live wire mode resolves to one of two shapes: a known,
 * trusted mode, or a present-but-unsupported value that must still render
 * (never silently relabeled Quick) — plan §6.1/§8.1. */
export type ResponseModeStatus =
  { supported: true; mode: ResponseMode } | { supported: false; mode: null };

/** A genuinely absent key (pre-feature legacy record) is Quick; a present
 * value is preserved verbatim (known or not). */
export function responseModeStatusFromWire(value: unknown): ResponseModeStatus {
  if (value === undefined) {
    return { supported: true, mode: "quick" };
  }
  if (isResponseMode(value)) {
    return { supported: true, mode: value };
  }
  return { supported: false, mode: null };
}

function parseResponseModeOption(value: unknown): ResponseModeOption | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const wire = value as Partial<{
    id: unknown;
    model: unknown;
    model_display_name: unknown;
    preview: unknown;
  }>;
  if (
    !isResponseMode(wire.id) ||
    typeof wire.model !== "string" ||
    !wire.model ||
    typeof wire.model_display_name !== "string" ||
    !wire.model_display_name ||
    typeof wire.preview !== "boolean"
  ) {
    return null;
  }
  return {
    id: wire.id,
    model: wire.model,
    modelDisplayName: wire.model_display_name,
    preview: wire.preview,
  };
}

export type ResponseModeCapability = {
  defaultResponseMode: ResponseMode;
  responseModes: readonly ResponseModeOption[];
};

const BUILT_IN_CAPABILITY: ResponseModeCapability = {
  defaultResponseMode: BUILT_IN_DEFAULT_RESPONSE_MODE,
  responseModes: BUILT_IN_RESPONSE_MODE_OPTIONS,
};

/** Config modes must be unique, known, non-empty, and contain the declared
 * default (plan §8.1). Any violation degrades to the built-in Quick-only
 * capability — it never enables an unknown mode. */
export function resolveResponseModeCapability(
  config: Pick<ChatConfigWire, "default_response_mode" | "response_modes">,
): ResponseModeCapability {
  const { default_response_mode: defaultRaw, response_modes: modesRaw } =
    config;

  if (modesRaw === undefined && defaultRaw === undefined) {
    return BUILT_IN_CAPABILITY;
  }

  if (!Array.isArray(modesRaw) || modesRaw.length === 0) {
    return BUILT_IN_CAPABILITY;
  }

  const parsed = modesRaw.map(parseResponseModeOption);
  if (parsed.some((option) => option === null)) {
    return BUILT_IN_CAPABILITY;
  }

  const options = parsed as ResponseModeOption[];
  const ids = options.map((option) => option.id);
  if (new Set(ids).size !== ids.length) {
    return BUILT_IN_CAPABILITY;
  }

  if (!isResponseMode(defaultRaw) || !ids.includes(defaultRaw)) {
    return BUILT_IN_CAPABILITY;
  }

  return { defaultResponseMode: defaultRaw, responseModes: options };
}

/** Selecting a mode the server no longer advertises (e.g. Think disabled
 * after the session went sticky-Think) must not silently stick — the next
 * normal turn falls back to Quick. Historical/active/parked Think stays
 * truthfully labeled elsewhere; this only governs the *next-turn* selector
 * (plan §8.2). */
export function normalizeResponseModeSelection(
  mode: ResponseMode,
  capability: ResponseModeCapability,
): { mode: ResponseMode; wasNormalized: boolean } {
  if (capability.responseModes.some((option) => option.id === mode)) {
    return { mode, wasNormalized: false };
  }
  return { mode: "quick", wasNormalized: true };
}
