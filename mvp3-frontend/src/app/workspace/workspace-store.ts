import type { Dispatch, SetStateAction } from "react"

import type { Task } from "@/domain/task"

export type WorkspaceTasksState = {
  tasks: Task[]
  setTasks: Dispatch<SetStateAction<Task[]>>
}
