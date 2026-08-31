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
import { AiPage } from "@/pages/ai-page";
import { AiChatRoute } from "@/features/ai-chat/AiChatRoute";
import { ActivitiesPage } from "@/pages/activities-page";
import { CdsCoveragePage } from "@/pages/cds-coverage-page";
import { CdsReviewPage } from "@/pages/cds-review-page";
import { CdsUploadPage } from "@/pages/cds-upload-page";
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
          path: "/dev/onboarding-shell",
          lazy: async () => {
            const module = await import(
              "@/features/dev-onboarding-shell-gallery/OnboardingShellGalleryPage"
            );
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
                  path: "admin/cds",
                  element: (
                    <AdminGate>
                      <CdsCoveragePage />
                    </AdminGate>
                  ),
                },
                {
                  path: "admin/cds/upload",
                  element: (
                    <AdminGate>
                      <CdsUploadPage />
                    </AdminGate>
                  ),
                },
                {
                  path: "admin/cds/documents/:documentId",
                  element: (
                    <AdminGate>
                      <CdsReviewPage />
                    </AdminGate>
                  ),
                },
                {
                  /*
                   * A mistyped or stale `/app/admin/cds/*` path (the review
                   * route carries a document id, so "review" instead of
                   * "documents/:id" is a plausible typo) used to fall
                   * through to the generic `*` below and land the operator
                   * on /app/tasks with no explanation. The app has no
                   * dedicated not-found surface anywhere, so — matching its
                   * existing redirect-to-nearest-known-place pattern — this
                   * scopes that fallback to the CDS admin index instead of
                   * an unrelated screen. More specific admin/cds routes
                   * above always win on match specificity.
                   */
                  path: "admin/cds/*",
                  element: <Navigate replace to="/app/admin/cds" />,
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
