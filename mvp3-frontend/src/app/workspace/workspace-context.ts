import { createContext } from "react"

import type { WorkspaceTasksState } from "@/app/workspace/workspace-store"

export const WorkspaceTasksContext = createContext<WorkspaceTasksState | null>(
  null
)
