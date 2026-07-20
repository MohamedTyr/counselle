const OTHER_READ_TOOLS = new Set([
  "query_database",
  "load_skill",
  "render_viz",
]);

export function isOtherReadTool(tool: string | undefined): boolean {
  return tool !== undefined && OTHER_READ_TOOLS.has(tool);
}
