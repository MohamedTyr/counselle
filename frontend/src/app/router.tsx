import { createBrowserRouter, Navigate } from "react-router"

import { WorkspaceShell } from "@/app/shell/WorkspaceShell"
import { RouteSurface } from "@/app/routes/RouteSurface"
import { SchoolsPage } from "@/pages/schools-page"
import { TasksPage } from "@/pages/tasks-page"

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
          element: <TasksPage />,
        },
        {
          path: "calendar",
          element: <RouteSurface title="Calendar" />,
        },
        {
          path: "schools",
          element: <SchoolsPage />,
        },
        {
          path: "activities",
          element: <RouteSurface title="Activities" />,
        },
        {
          path: "essays",
          element: <RouteSurface title="Essays" />,
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
