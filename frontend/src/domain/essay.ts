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

const DAY_MS = 24 * 60 * 60 * 1000;
const DUE_SOON_DAYS = 14;

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
  const hasLinkedApplication = summary.application_id !== null;
  const isPersonalStatement =
    !hasLinkedApplication && summary.essay_type === "Personal statement";
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
    applicationId: summary.application_id,
    comments: summary.comment_count,
    deadline: summary.deadline,
    dueSoon: isEssayDueSoon(summary.deadline),
    id: summary.id,
    preview: summary.preview,
    prompt: summary.prompt,
    schoolLocation,
    schoolName,
    status: summary.status,
    suggestions: summary.suggestion_count,
    title: summary.title,
    type: summary.essay_type,
    updatedAt: summary.updated_at,
    wordCount: summary.word_count,
    wordLimit: summary.word_limit,
  };
}

export function essayFromApi(essay: ApiEssay): EssayDetail {
  return {
    ...essayFromSummary(essay),
    content: essay.content,
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
