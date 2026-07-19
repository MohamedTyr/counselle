import { describe, expect, test } from "vitest";

import type { StepData } from "@/api/chat/types";

import {
  isHistoricalOverflowStep,
  schoolDataToolPresentation,
  stepToolIdentity,
} from "./school-data-tool-presentation";

function step(overrides: Partial<StepData> = {}): StepData {
  return {
    step_id: "s1",
    status: "end",
    kind: "db_tool",
    label: "Read Yale University’s admissions data",
    tier: "official",
    tool: "get_domain",
    detail: { tool: "get_domain", value_count: 72, domain_id: "admissions" },
    ...overrides,
  };
}

describe("schoolDataToolPresentation", () => {
  test("uses the backend label and derives running intent without parsing it", () => {
    const presentation = schoolDataToolPresentation(
      step({ status: "start", label: "Finding “Yale”…", detail: null }),
    );

    expect(presentation).toEqual({
      tool: "get_domain",
      state: "running",
      icon: "loading",
      label: "Finding “Yale”…",
    });
  });

  test("uses legacy terminal detail identity but never guesses for a legacy start", () => {
    expect(schoolDataToolPresentation(step({ tool: undefined }))?.tool).toBe(
      "get_domain",
    );
    expect(
      schoolDataToolPresentation(
        step({ status: "start", tool: undefined, detail: null }),
      ),
    ).toBeNull();
  });

  test.each(["query_database", "search_web", "view_tasks", "future_tool"])(
    "does not claim the generic %s tool",
    (tool) => {
      expect(
        schoolDataToolPresentation(
          step({ tool, detail: { tool, value_count: 2 } }),
        ),
      ).toBeNull();
    },
  );

  test("renders one resolved match without redundant metadata", () => {
    expect(
      schoolDataToolPresentation(
        step({
          tool: "resolve_school",
          label: "Found Yale University",
          detail: { tool: "resolve_school", result_count: 1 },
        }),
      ),
    ).toEqual({
      tool: "resolve_school",
      state: "complete",
      icon: "check",
      label: "Found Yale University",
    });
  });

  test("formats ambiguous matches with locale-aware singular/plural metadata", () => {
    expect(
      schoolDataToolPresentation(
        step({
          tool: "resolve_school",
          label: "Found possible matches for “Yale”",
          detail: { tool: "resolve_school", result_count: 1_200 },
        }),
        "en-US",
      )?.metadata,
    ).toBe("1,200 matches");
  });

  test.each([
    ["get_school_profile", 0, "unavailable", undefined],
    ["get_school_profile", 1, "complete", "1 value"],
    ["get_domain", 72, "complete", "72 values"],
  ] as const)(
    "maps %s count %i honestly",
    (tool, valueCount, state, metadata) => {
      const presentation = schoolDataToolPresentation(
        step({ tool, detail: { tool, value_count: valueCount } }),
      );

      expect(presentation?.state).toBe(state);
      expect(presentation?.metadata).toBe(metadata);
    },
  );

  test("treats no school match as unavailable without error copy", () => {
    const presentation = schoolDataToolPresentation(
      step({
        tool: "resolve_school",
        label: "No school found for “Yale”",
        detail: {
          tool: "resolve_school",
          result_count: 0,
          error: "internal details",
        },
      }),
    );

    expect(presentation).toEqual({
      tool: "resolve_school",
      state: "unavailable",
      icon: "minus",
      label: "No school found for “Yale”",
    });
    expect(JSON.stringify(presentation)).not.toContain("internal details");
  });

  test("maps errors without surfacing receipt error text", () => {
    const presentation = schoolDataToolPresentation(
      step({
        status: "error",
        tool: "get_school_profile",
        label: "Couldn’t read Yale University’s profile",
        detail: { tool: "get_school_profile", error: "database host leaked" },
      }),
    );

    expect(presentation).toEqual({
      tool: "get_school_profile",
      state: "error",
      icon: "alert",
      label: "Couldn’t read Yale University’s profile",
    });
    expect(JSON.stringify(presentation)).not.toContain("database host leaked");
  });

  test("falls back for incomplete or dishonest terminal counts", () => {
    expect(
      schoolDataToolPresentation(step({ detail: { tool: "get_domain" } })),
    ).toBeNull();
    expect(
      schoolDataToolPresentation(
        step({ detail: { tool: "get_domain", value_count: -1 } }),
      ),
    ).toBeNull();
    expect(schoolDataToolPresentation(step({ label: "   " }))).toBeNull();
  });

  test("returns a runtime-frozen immutable view model", () => {
    const input = step();
    const original = JSON.stringify(input);
    const presentation = schoolDataToolPresentation(input);

    expect(Object.isFrozen(presentation)).toBe(true);
    expect(JSON.stringify(input)).toBe(original);
  });
});

describe("tool identity compatibility", () => {
  test("prefers top-level identity over historical receipt identity", () => {
    expect(
      stepToolIdentity(
        step({ tool: "get_domain", detail: { tool: "search_web" } }),
      ),
    ).toBe("get_domain");
  });

  test("identifies only historical overflow plumbing", () => {
    expect(
      isHistoricalOverflowStep(
        step({
          tool: undefined,
          detail: { tool: "read_tool_result", value_count: 2 },
        }),
      ),
    ).toBe(true);
    expect(isHistoricalOverflowStep(step())).toBe(false);
  });
});
