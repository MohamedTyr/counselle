import { createBrowserRouter, Navigate } from "react-router";

import { GuestOnly } from "@/app/auth/GuestOnly";
import { OnboardingGate } from "@/app/auth/OnboardingGate";
import { RequireAuth } from "@/app/auth/RequireAuth";
import { WorkspaceShell } from "@/app/shell/WorkspaceShell";
import { RouteSurface } from "@/app/routes/RouteSurface";
import { LoginRoute } from "@/features/auth/LoginRoute";
import { OnboardingRoute } from "@/features/onboarding/OnboardingRoute";
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
        {
          path: "/dev/school-facts",
          lazy: async () => {
            const module =
              await import("@/features/dev-school-facts-gallery/SchoolFactsGalleryPage");
            return { Component: module.SchoolFactsGalleryPage };
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
                   * The CDS admin screens are parked (not deleted) as of
                   * school-data-v3 Phase 0 — the admin dashboard moves to
                   * `/app/admin/facts` (added in Phase 1). The superuser nav
                   * entry that used to link here is hidden for this same
                   * Phase 0 → Phase 1 window (`navigation.tsx`), so this
                   * redirect exists only for a stale `/app/admin/cds/*`
                   * bookmark or link: `/app/admin/facts` does not exist yet,
                   * so until Phase 1 ships it, a hit here still falls
                   * through to the generic `*` below and lands on
                   * /app/tasks unexplained — same as if this redirect were
                   * deleted outright. Keeping it re-pointed now means it
                   * starts working the moment Phase 1 adds the route,
                   * with no further edit here.
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
