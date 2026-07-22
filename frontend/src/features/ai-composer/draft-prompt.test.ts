import { describe, expect, it } from "vitest";

import { parseDraftPromptState } from "@/features/ai-composer/draft-prompt";

describe("parseDraftPromptState", () => {
  it("returns null for missing or non-object state", () => {
    expect(parseDraftPromptState(null)).toBeNull();
    expect(parseDraftPromptState(undefined)).toBeNull();
    expect(parseDraftPromptState("draftPrompt")).toBeNull();
  });

  it("returns null when draftPrompt is absent or the wrong type", () => {
    expect(parseDraftPromptState({})).toBeNull();
    expect(parseDraftPromptState({ draftPrompt: 42 })).toBeNull();
    expect(parseDraftPromptState({ draftPrompt: null })).toBeNull();
  });

  it("returns null for an empty or whitespace-only string", () => {
    expect(parseDraftPromptState({ draftPrompt: "" })).toBeNull();
    expect(parseDraftPromptState({ draftPrompt: "   " })).toBeNull();
  });

  it("returns the trimmed string for a valid, bounded draft prompt", () => {
    expect(parseDraftPromptState({ draftPrompt: "  Help me plan.  " })).toBe("Help me plan.");
  });

  it("returns null for an implausibly long string", () => {
    expect(parseDraftPromptState({ draftPrompt: "a".repeat(2001) })).toBeNull();
  });
});
