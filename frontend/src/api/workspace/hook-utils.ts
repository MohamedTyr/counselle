import { toast } from "sonner";

import { authQueryKey } from "@/app/auth";
import { isTransportError } from "@/api/http/errors";
import { nowIso } from "@/api/workspace/optimistic";
import type {
  Activity,
  ActivityCreate,
  ApplicationCreate,
  ApplicationView,
  EssayCreate,
  EssaySummary,
  Honor,
  HonorCreate,
  SchoolSearchResult,
  Task,
  TaskCreate,
} from "@/api/workspace/types";

function workspaceErrorMessage(error: unknown) {
  if (!isTransportError(error)) {
    return "The workspace update failed. Please try again.";
  }
  switch (error.kind) {
    case "unauthorized":
      return "Your session expired. Sign in again to keep editing.";
    case "conflict":
      return "That workspace item already exists.";
    case "invalid_edit":
      return "That edit is invalid.";
    case "rate_limited":
      return "Too many workspace updates. Wait a moment and try again.";
    case "network":
      return "Could not reach the server. Check your connection and try again.";
    default:
      return "The workspace update failed. Please try again.";
  }
}

export function handleMutationError(
  error: unknown,
  context: {
    client: {
      invalidateQueries: (filters: { queryKey: readonly unknown[] }) => unknown;
    };
  },
) {
  if (isTransportError(error) && error.kind === "unauthorized") {
    void context.client.invalidateQueries({ queryKey: authQueryKey });
  }
  toast.error(workspaceErrorMessage(error));
}

export function tempApplication(
  input: ApplicationCreate,
  school?: SchoolSearchResult,
): ApplicationView {
  const timestamp = nowIso();
  return {
    id: `temp-${crypto.randomUUID()}`,
    user_id: "optimistic",
    school_unitid: input.unitid,
    cycle_year: input.cycle_year,
    checklist: {},
    platform: null,
    platform_other: null,
    school_name: school?.name ?? `School ${input.unitid}`,
    school_city: school?.city ?? null,
    school_state: school?.state ?? null,
    website_url: school?.website_url ?? null,
    status: "Considering",
    list_type: input.list_type,
    round: input.round,
    deadline: input.deadline ?? null,
    aid_deadline: null,
    scholarship_deadline: null,
    notes: null,
    intended_major: null,
    test_plan: null,
    progress: { completed: 0, total: 0 },
    essays: { completed: 0, total: 0 },
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: null,
  };
}

export function tempTask(input: TaskCreate): Task {
  const timestamp = nowIso();
  return {
    id: `temp-${crypto.randomUUID()}`,
    user_id: "optimistic",
    application_id: input.application_id ?? null,
    essay_id: input.essay_id ?? null,
    requirement_kind: input.requirement_kind ?? null,
    title: input.title,
    notes: input.notes ?? null,
    status: input.status ?? "todo",
    category: input.category ?? "other",
    priority: input.priority ?? "med",
    assignee: input.assignee ?? "student",
    needs_input: input.needs_input ?? false,
    due_at: input.due_at ?? null,
    planned_for: input.planned_for ?? null,
    reminder_at: input.reminder_at ?? null,
    completed_at: null,
    archived_via_application: null,
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: null,
  };
}

export function tempEssay(input: EssayCreate): EssaySummary {
  const timestamp = nowIso();
  return {
    id: `temp-${crypto.randomUUID()}`,
    user_id: "optimistic",
    application_id: input.application_id ?? null,
    title: input.title,
    essay_type: input.essay_type ?? "Supplement",
    status: input.status ?? "Not started",
    prompt: input.prompt ?? null,
    preview: "",
    word_count: input.word_count ?? 0,
    word_limit: input.word_limit ?? null,
    comment_count: 0,
    suggestion_count: 0,
    archived_via_application: null,
    school_name: null,
    school_city: null,
    school_state: null,
    school_website_url: null,
    deadline: null,
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: null,
  };
}

export function tempActivity(
  input: ActivityCreate,
  sortOrder: number,
): Activity {
  const timestamp = nowIso();
  return {
    id: `temp-${crypto.randomUUID()}`,
    user_id: "optimistic",
    sort_order: sortOrder,
    activity_type: input.activity_type ?? "",
    position: input.position ?? "",
    organization: input.organization ?? "",
    description: input.description ?? "",
    grades: input.grades ?? [],
    timing: input.timing ?? [],
    hours_per_week: input.hours_per_week ?? null,
    weeks_per_year: input.weeks_per_year ?? null,
    continue_in_college: input.continue_in_college ?? null,
    story: input.story ?? null,
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: null,
  };
}

export function tempHonor(input: HonorCreate, sortOrder: number): Honor {
  const timestamp = nowIso();
  return {
    id: `temp-${crypto.randomUUID()}`,
    user_id: "optimistic",
    sort_order: sortOrder,
    title: input.title ?? "",
    grades: input.grades ?? [],
    levels: input.levels ?? [],
    created_at: timestamp,
    updated_at: timestamp,
    archived_at: null,
  };
}
