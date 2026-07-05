import { createBrowserRouter, Navigate } from "react-router"

import { WorkspaceShell } from "@/app/shell/WorkspaceShell"
import { RouteSurface } from "@/app/routes/RouteSurface"

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
          element: <RouteSurface title="Tasks" />,
        },
        {
          path: "calendar",
          element: <RouteSurface title="Calendar" />,
        },
        {
          path: "schools",
          element: <RouteSurface title="Schools" />,
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
