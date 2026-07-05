import { useWorkspaceTasks } from "@/app/workspace/workspace-hooks"
import { lazy, Suspense } from "react"

import { RoutePageFallback } from "@/app/routes/RoutePageFallback"

const TasksPage = lazy(() =>
  import("@/pages/tasks-page").then((module) => ({
    default: module.TasksPage,
  }))
)

export function Component() {
  const { tasks, setTasks } = useWorkspaceTasks()

  return (
    <Suspense fallback={<RoutePageFallback />}>
      <TasksPage onTasksChange={setTasks} tasks={tasks} />
    </Suspense>
  )
}
