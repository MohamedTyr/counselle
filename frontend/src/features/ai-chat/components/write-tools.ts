import type { MutationFamily, UnresolvedMutationBody } from "@/api/chat/types";

export const WRITE_TOOLS = Object.freeze([
  "create_tasks",
  "update_task",
  "archive_tasks",
  "restore_task",
  "add_schools",
  "update_school",
  "archive_schools",
  "restore_school",
  "create_essays",
  "update_essay",
  "duplicate_essay",
  "archive_essays",
  "restore_essay",
  "edit_essay",
  "write_essay",
  "create_activities",
  "update_activity",
  "archive_activities",
  "restore_activity",
  "reorder_activities",
  "create_honors",
  "update_honor",
  "archive_honors",
  "restore_honor",
  "reorder_honors",
  "update_profile",
  "remember",
  "update_memory",
  "forget",
] as const);

const WRITE_TOOL_SET = new Set<string>(WRITE_TOOLS);

export function isWriteTool(tool: string | undefined): boolean {
  return tool !== undefined && WRITE_TOOL_SET.has(tool);
}

/** Mirrors `app.workspace_mutation_receipts.WRITE_TOOL_FAMILY_ACTION` — the
 * exact 29-tool presentation registry, used only to name the right family
 * when synthesizing a safe "unknown" row for a corrupted/missing receipt
 * (never derived from untrusted call arguments). */
export const WRITE_TOOL_FAMILY: Readonly<Record<string, MutationFamily>> = {
  create_tasks: "task",
  update_task: "task",
  archive_tasks: "task",
  restore_task: "task",
  add_schools: "school",
  update_school: "school",
  archive_schools: "school",
  restore_school: "school",
  create_essays: "essay",
  update_essay: "essay",
  duplicate_essay: "essay",
  archive_essays: "essay",
  restore_essay: "essay",
  edit_essay: "essay_content",
  write_essay: "essay_content",
  create_activities: "activity",
  update_activity: "activity",
  archive_activities: "activity",
  restore_activity: "activity",
  reorder_activities: "activity",
  create_honors: "honor",
  update_honor: "honor",
  archive_honors: "honor",
  restore_honor: "honor",
  reorder_honors: "honor",
  update_profile: "profile",
  remember: "memory",
  update_memory: "memory",
  forget: "memory",
};

type Verification = UnresolvedMutationBody["verification"];

const VERIFICATION_BY_FAMILY: Readonly<Record<MutationFamily, Verification>> = {
  task: "task_list",
  school: "school_list",
  essay: "essay_list",
  essay_content: "essay_list",
  activity: "activity_list",
  honor: "honor_list",
  profile: "profile",
  memory: "memory_list",
};

export function verificationForTool(tool: string | undefined): Verification {
  const family = tool !== undefined ? WRITE_TOOL_FAMILY[tool] : undefined;
  return family !== undefined ? VERIFICATION_BY_FAMILY[family] : "task_list";
}
