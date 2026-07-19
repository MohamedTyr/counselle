import type { StepData } from "@/api/chat/types";

const SCHOOL_DATA_TOOLS = new Set([
  "resolve_school",
  "get_school_profile",
  "get_domain",
] as const);

type SchoolDataTool = "resolve_school" | "get_school_profile" | "get_domain";

export type SchoolDataToolVisualState =
  "running" | "complete" | "unavailable" | "error";

export type SchoolDataToolIconIntent = "loading" | "check" | "minus" | "alert";

export type SchoolDataToolPresentation = Readonly<{
  tool: SchoolDataTool;
  state: SchoolDataToolVisualState;
  icon: SchoolDataToolIconIntent;
  label: string;
  metadata?: string;
}>;

export function stepToolIdentity(step: StepData): string | null {
  return step.tool ?? step.detail?.tool ?? null;
}

export function isHistoricalOverflowStep(step: StepData): boolean {
  return stepToolIdentity(step) === "read_tool_result";
}

function isSchoolDataTool(tool: string): tool is SchoolDataTool {
  return SCHOOL_DATA_TOOLS.has(tool as SchoolDataTool);
}

function honestCount(value: number | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

function countMetadata(
  count: number,
  noun: "match" | "value",
  locale?: string,
): string {
  const formatted = count.toLocaleString(locale);
  const plural = noun === "match" ? "matches" : "values";
  return `${formatted} ${count === 1 ? noun : plural}`;
}

function freezePresentation(
  presentation: SchoolDataToolPresentation,
): SchoolDataToolPresentation {
  return Object.freeze(presentation);
}

export function schoolDataToolPresentation(
  step: StepData,
  locale?: string,
): SchoolDataToolPresentation | null {
  const tool = stepToolIdentity(step);
  const label = step.label.trim();
  if (tool === null || !isSchoolDataTool(tool) || label.length === 0) {
    return null;
  }

  if (step.status === "start") {
    return freezePresentation({
      tool,
      state: "running",
      icon: "loading",
      label,
    });
  }

  if (step.status === "error") {
    return freezePresentation({ tool, state: "error", icon: "alert", label });
  }

  const count = honestCount(
    tool === "resolve_school"
      ? step.detail?.result_count
      : step.detail?.value_count,
  );
  if (count === null) {
    return null;
  }

  if (count === 0) {
    return freezePresentation({
      tool,
      state: "unavailable",
      icon: "minus",
      label,
    });
  }

  const metadata =
    tool === "resolve_school" && count === 1
      ? undefined
      : countMetadata(
          count,
          tool === "resolve_school" ? "match" : "value",
          locale,
        );

  return freezePresentation({
    tool,
    state: "complete",
    icon: "check",
    label,
    ...(metadata === undefined ? {} : { metadata }),
  });
}
