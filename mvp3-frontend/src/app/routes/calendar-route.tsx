import { useWorkspaceTasks } from "@/app/workspace/workspace-hooks"
import { lazy, Suspense } from "react"

import { RoutePageFallback } from "@/app/routes/RoutePageFallback"

const CalendarPage = lazy(() =>
  import("@/pages/calendar-page").then((module) => ({
    default: module.CalendarPage,
  }))
)

export function Component() {
  const { tasks, setTasks } = useWorkspaceTasks()

  return (
    <Suspense fallback={<RoutePageFallback />}>
      <CalendarPage onTasksChange={setTasks} tasks={tasks} />
    </Suspense>
  )
}
