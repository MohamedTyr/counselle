const WORKSPACE_READ_TOOLS = new Set([
  "view_tasks",
  "search_tasks",
  "search_schools",
  "view_schools",
  "get_school",
  "view_essays",
  "read_essay",
  "view_activities",
  "view_documents",
  "read_document",
]);

export function isWorkspaceReadTool(tool: string | undefined): boolean {
  return tool !== undefined && WORKSPACE_READ_TOOLS.has(tool);
}
