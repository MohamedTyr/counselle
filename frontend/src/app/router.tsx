import { createBrowserRouter, Navigate } from "react-router";

import { AdminGate } from "@/app/auth/AdminGate";
import { GuestOnly } from "@/app/auth/GuestOnly";
import { OnboardingGate } from "@/app/auth/OnboardingGate";
import { RequireAuth } from "@/app/auth/RequireAuth";
import { WorkspaceShell } from "@/app/shell/WorkspaceShell";
import { RouteSurface } from "@/app/routes/RouteSurface";
import { LoginRoute } from "@/features/auth/LoginRoute";
import { OnboardingRoute } from "@/features/onboarding/OnboardingRoute";
import { RegisterRoute } from "@/features/auth/RegisterRoute";
import { AdminFactsPage } from "@/features/admin-facts/AdminFactsPage";
import { AiPage } from "@/pages/ai-page";
import { AiChatRoute } from "@/features/ai-chat/AiChatRoute";
import { ActivitiesPage } from "@/pages/activities-page";
import { EssayEditorPage } from "@/pages/essay-editor-page";
import { EssaysPage } from "@/pages/essays-page";
import { ProfilePage } from "@/pages/profile-page";
import { SchoolsPage } from "@/pages/schools-page";
import { SchoolDetailPage } from "@/pages/school-detail-page";
import { TasksPage } from "@/pages/tasks-page";
import { AnytimeView } from "@/features/tasks/AnytimeView";
import { LogbookView } from "@/features/tasks/LogbookView";
import { TodayView } from "@/features/tasks/TodayView";
import { UpcomingView } from "@/features/tasks/UpcomingView";

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
        {
          path: "/dev/onboarding-shell",
          lazy: async () => {
            const module =
              await import("@/features/dev-onboarding-shell-gallery/OnboardingShellGalleryPage");
            return { Component: module.OnboardingShellGalleryPage };
          },
        },
        {
          path: "/dev/school-chances",
          lazy: async () => {
            const module =
              await import("@/features/dev-school-chances/SchoolChancesGalleryPage");
            return { Component: module.SchoolChancesGalleryPage };
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
          element: <OnboardingGate />,
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
                  children: [
                    { index: true, element: <Navigate replace to="today" /> },
                    { path: "today", element: <TodayView /> },
                    { path: "upcoming", element: <UpcomingView /> },
                    { path: "anytime", element: <AnytimeView /> },
                    { path: "logbook", element: <LogbookView /> },
                  ],
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
                  /*
                   * Keyed by unitid. An application id still resolves here
                   * and redirects to the canonical school URL, so every
                   * existing link in essays and tasks keeps working.
                   */
                  path: "schools/:schoolKey",
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
                  /*
                   * The school-data admin dashboard (plan §5.5, D12) that
                   * replaces the parked CDS admin screens (ADR 0038,
                   * PARKED.md) — superuser-gated the same way the CDS admin
                   * routes were.
                   */
                  path: "admin/facts",
                  element: (
                    <AdminGate>
                      <AdminFactsPage />
                    </AdminGate>
                  ),
                },
                {
                  /*
                   * The CDS admin screens are parked (not deleted, ADR
                   * 0038/PARKED.md) — this redirect exists only for a stale
                   * `/app/admin/cds/*` bookmark or link, now that
                   * `/app/admin/facts` (above) exists.
                   */
                  path: "admin/cds/*",
                  element: <Navigate replace to="/app/admin/facts" />,
                },
                {
                  path: "*",
                  element: <Navigate replace to="/app/tasks" />,
                },
              ],
            },
            {
              path: "/onboarding",
              element: <OnboardingRoute />,
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
