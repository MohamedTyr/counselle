import { createBrowserRouter, Navigate } from "react-router";

import { GuestOnly } from "@/app/auth/GuestOnly";
import { RequireAuth } from "@/app/auth/RequireAuth";
import { WorkspaceShell } from "@/app/shell/WorkspaceShell";
import { RouteSurface } from "@/app/routes/RouteSurface";
import { LoginRoute } from "@/features/auth/LoginRoute";
import { RegisterRoute } from "@/features/auth/RegisterRoute";
import { ActivitiesPage } from "@/pages/activities-page";
import { EssayEditorPage } from "@/pages/essay-editor-page";
import { EssaysPage } from "@/pages/essays-page";
import { SchoolsPage } from "@/pages/schools-page";
import { TasksPage } from "@/pages/tasks-page";

export function createAppRouter() {
  return createBrowserRouter([
    {
      path: "/",
      element: <GuestOnly />,
      children: [
        {
          index: true,
          element: <Navigate replace to="/login" />,
        },
        {
          path: "login",
          element: <LoginRoute />,
        },
        {
          path: "register",
          element: <RegisterRoute />,
        },
      ],
    },
    {
      element: <RequireAuth />,
      children: [
        {
          path: "/app",
          Component: WorkspaceShell,
          children: [
            {
              index: true,
              element: <Navigate replace to="/app/tasks" />,
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
              element: <ActivitiesPage />,
            },
            {
              path: "essays",
              element: <EssaysPage />,
            },
            {
              path: "essays/:essayId",
              element: <EssayEditorPage />,
            },
            {
              path: "*",
              element: <Navigate replace to="/app/tasks" />,
            },
          ],
        },
      ],
    },
    {
      path: "*",
      element: <Navigate replace to="/login" />,
    },
  ]);
}

export const router = createAppRouter();
