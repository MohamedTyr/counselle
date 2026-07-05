import { useContext } from "react"

import { WorkspaceTasksContext } from "@/app/workspace/workspace-context"

export function useWorkspaceTasks() {
  const context = useContext(WorkspaceTasksContext)

  if (!context) {
    throw new Error("useWorkspaceTasks must be used within WorkspaceProvider")
  }

  return context
}
