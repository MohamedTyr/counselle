import { createBrowserRouter, Navigate } from "react-router"

import { Component as ActivitiesRoute } from "@/app/routes/activities-route"
import { Component as CalendarRoute } from "@/app/routes/calendar-route"
import { Component as EssayEditorRoute } from "@/app/routes/essay-editor-route"
import { Component as EssaysRoute } from "@/app/routes/essays-route"
import { Component as SchoolsRoute } from "@/app/routes/schools-route"
import { Component as TasksRoute } from "@/app/routes/tasks-route"
import { WorkspaceShell } from "@/app/shell/WorkspaceShell"

export function createAppRouter() {
  return createBrowserRouter([
    {
      path: "/",
      Component: WorkspaceShell,
      children: [
        {
          index: true,
          element: <Navigate replace to="/tasks" />,
        },
        {
          path: "tasks",
          Component: TasksRoute,
        },
        {
          path: "calendar",
          Component: CalendarRoute,
        },
        {
          path: "schools",
          Component: SchoolsRoute,
        },
        {
          path: "activities",
          Component: ActivitiesRoute,
        },
        {
          path: "essays",
          Component: EssaysRoute,
        },
        {
          path: "essays/:essayId",
          Component: EssayEditorRoute,
        },
        {
          path: "*",
          element: <Navigate replace to="/tasks" />,
        },
      ],
    },
  ])
}

export const router = createAppRouter()
