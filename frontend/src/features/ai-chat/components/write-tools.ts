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
