export const workspaceKeys = {
  all: ["workspace"] as const,
  applications: {
    all: () => [...workspaceKeys.all, "applications"] as const,
    list: () => [...workspaceKeys.applications.all(), "list"] as const,
    detail: (id: string) => [...workspaceKeys.applications.all(), "detail", id] as const,
  },
  tasks: {
    all: () => [...workspaceKeys.all, "tasks"] as const,
    list: () => [...workspaceKeys.tasks.all(), "list"] as const,
  },
  essays: {
    all: () => [...workspaceKeys.all, "essays"] as const,
    list: () => [...workspaceKeys.essays.all(), "list"] as const,
    detail: (id: string) => [...workspaceKeys.essays.all(), "detail", id] as const,
  },
  activities: {
    all: () => [...workspaceKeys.all, "activities"] as const,
    list: () => [...workspaceKeys.activities.all(), "list"] as const,
  },
  honors: {
    all: () => [...workspaceKeys.all, "honors"] as const,
    list: () => [...workspaceKeys.honors.all(), "list"] as const,
  },
  schoolSearch: (q: string) =>
    [...workspaceKeys.all, "schools", "search", q.trim()] as const,
}
