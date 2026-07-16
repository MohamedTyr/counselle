import type {
  Essay as ApiEssay,
  EssayPatch as ApiEssayPatch,
  EssaySummary,
  TiptapContent,
} from "@/api/workspace/types";

export type EssayStatus =
  "Not started" | "Drafting" | "Needs review" | "Ready" | "Submitted";

export type EssayType =
  "Personal statement" | "Supplement" | "Scholarship" | "Optional";

export type Essay = {
  applicationId: string | null;
  cycleYear: number | null;
  comments: number;
  deadline: string | null;
  dueSoon: boolean;
  id: string;
  preview: string;
  prompt: string | null;
  schoolLocation: string;
  schoolName: string;
  status: EssayStatus;
  suggestions: number;
  title: string;
  type: EssayType;
  updatedAt: string;
  wordCount: number;
  wordLimit: number | null;
};

export type EssayDetail = Essay & {
  content: TiptapContent;
};

const essayStatuses = new Set<EssayStatus>([
  "Not started",
  "Drafting",
  "Needs review",
  "Ready",
  "Submitted",
]);
const essayTypes = new Set<EssayType>([
  "Personal statement",
  "Supplement",
  "Scholarship",
  "Optional",
]);
const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 14;
const emptyTiptapContent: TiptapContent = {
  type: "doc",
  content: [{ type: "paragraph" }],
};

function textOrEmpty(value: unknown) {
  return typeof value === "string" ? value : "";
}

function textOrNull(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numberOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isEssayStatus(value: unknown): value is EssayStatus {
  return typeof value === "string" && essayStatuses.has(value as EssayStatus);
}

function isEssayType(value: unknown): value is EssayType {
  return typeof value === "string" && essayTypes.has(value as EssayType);
}

function contentOrEmpty(value: unknown): TiptapContent {
  return value && typeof value === "object"
    ? (value as TiptapContent)
    : emptyTiptapContent;
}

function dateOnlyUtcTime(value: Date) {
  return Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth(),
    value.getUTCDate(),
  );
}

export function isEssayDueSoon(
  deadline: string | null,
  referenceDate = new Date(),
) {
  if (!deadline) {
    return false;
  }

  const deadlineTime = Date.parse(`${deadline}T00:00:00Z`);
  if (!Number.isFinite(deadlineTime)) {
    return false;
  }

  const daysUntilDeadline = Math.ceil(
    (deadlineTime - dateOnlyUtcTime(referenceDate)) / DAY_MS,
  );
  return daysUntilDeadline >= 0 && daysUntilDeadline <= DUE_SOON_DAYS;
}

function formatSchoolLocation(city: string | null, state: string | null) {
  return [city, state].filter(Boolean).join(", ");
}

export function essayFromSummary(summary: EssaySummary): Essay {
  const applicationId = textOrNull(summary.application_id);
  const type = isEssayType(summary.essay_type) ? summary.essay_type : "Supplement";
  const status = isEssayStatus(summary.status)
    ? summary.status
    : "Not started";
  const deadline = textOrNull(summary.deadline);
  const title = textOrEmpty(summary.title) || "Untitled essay";
  const hasLinkedApplication = applicationId !== null;
  const isPersonalStatement =
    !hasLinkedApplication && type === "Personal statement";
  const schoolName =
    summary.school_name ??
    (isPersonalStatement
      ? "Personal statement"
      : hasLinkedApplication
        ? "School unavailable"
        : "Unlinked essay");
  const schoolLocation =
    formatSchoolLocation(summary.school_city, summary.school_state) ||
    (isPersonalStatement
      ? "All schools"
      : hasLinkedApplication
        ? "School-linked essay"
        : "No linked school");

  return {
    applicationId,
    cycleYear: numberOrNull(summary.cycle_year),
    comments: numberOrZero(summary.comment_count),
    deadline,
    dueSoon: isEssayDueSoon(deadline),
    id: textOrEmpty(summary.id),
    preview: textOrEmpty(summary.preview),
    prompt: textOrNull(summary.prompt),
    schoolLocation,
    schoolName,
    status,
    suggestions: numberOrZero(summary.suggestion_count),
    title,
    type,
    updatedAt: textOrEmpty(summary.updated_at),
    wordCount: numberOrZero(summary.word_count),
    wordLimit: numberOrNull(summary.word_limit),
  };
}

export function essayFromApi(essay: ApiEssay): EssayDetail {
  return {
    ...essayFromSummary(essay),
    content: contentOrEmpty(essay.content),
  };
}

export function essayPatchToApi(patch: Partial<Essay>): ApiEssayPatch {
  const apiPatch: ApiEssayPatch = {};

  if ("applicationId" in patch)
    apiPatch.application_id = patch.applicationId ?? null;
  if ("prompt" in patch) apiPatch.prompt = patch.prompt ?? null;
  if ("status" in patch && patch.status) apiPatch.status = patch.status;
  if ("title" in patch && patch.title) apiPatch.title = patch.title;
  if ("type" in patch && patch.type) apiPatch.essay_type = patch.type;
  if ("wordLimit" in patch) apiPatch.word_limit = patch.wordLimit ?? null;

  return apiPatch;
}
