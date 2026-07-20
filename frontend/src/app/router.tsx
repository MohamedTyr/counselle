import { createBrowserRouter, Navigate } from "react-router";

import { GuestOnly } from "@/app/auth/GuestOnly";
import { RequireAuth } from "@/app/auth/RequireAuth";
import { WorkspaceShell } from "@/app/shell/WorkspaceShell";
import { RouteSurface } from "@/app/routes/RouteSurface";
import { LoginRoute } from "@/features/auth/LoginRoute";
import { RegisterRoute } from "@/features/auth/RegisterRoute";
import { AiPage } from "@/pages/ai-page";
import { AiChatRoute } from "@/features/ai-chat/AiChatRoute";
import { ActivitiesPage } from "@/pages/activities-page";
import { EssayEditorPage } from "@/pages/essay-editor-page";
import { EssaysPage } from "@/pages/essays-page";
import { ProfilePage } from "@/pages/profile-page";
import { SchoolsPage } from "@/pages/schools-page";
import { SchoolDetailPage } from "@/pages/school-detail-page";
import { TasksPage } from "@/pages/tasks-page";

export function createAppRouter() {
  const devRoutes = import.meta.env.DEV
    ? [
        {
          path: "/dev/tool-calls",
          lazy: async () => {
            const module =
              await import("@/features/dev-tool-call-gallery/ToolCallGalleryPage");
            return { Component: module.ToolCallGalleryPage };
          },
        },
      ]
    : [];

  return createBrowserRouter([
    ...devRoutes,
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
              element: <Navigate replace to="/app/ai" />,
            },
            {
              path: "ai",
              element: <AiPage />,
            },
            {
              path: "ai/:sessionId",
              element: <AiChatRoute />,
            },
            {
              path: "tasks",
              element: <TasksPage />,
            },
            {
              path: "profile",
              element: <ProfilePage />,
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
              path: "schools/:applicationId",
              element: <SchoolDetailPage />,
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
