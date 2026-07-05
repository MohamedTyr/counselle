import { useMemo, useState, type PropsWithChildren } from "react"

import { WorkspaceTasksContext } from "@/app/workspace/workspace-context"
import { initialTasks } from "@/fixtures/tasks"

export function WorkspaceProvider({ children }: PropsWithChildren) {
  const [tasks, setTasks] = useState(initialTasks)
  const tasksState = useMemo(() => ({ tasks, setTasks }), [tasks])

  return (
    <WorkspaceTasksContext.Provider value={tasksState}>
      {children}
    </WorkspaceTasksContext.Provider>
  )
}
