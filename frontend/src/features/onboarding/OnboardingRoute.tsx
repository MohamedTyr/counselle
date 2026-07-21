import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { parseOnboardingProgressResult } from "@/api/http/onboarding";
import { useMe, useUpdateOnboardingProgress } from "@/app/auth";
import type { OnboardingLocationState } from "@/app/auth/OnboardingGate";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

const STEP_TITLES: Record<string, string> = {
  basics: "Basics",
  academics: "Academic snapshot",
  direction: "Academic direction",
  context: "Context",
  fit: "Fit",
};

/**
 * Orchestration-only placeholder (plan §20.3/§21 Phase 2). The five question
 * screens and the completion receipt are built in Phase 4/5; this route
 * proves the data/routing contract: it starts or resumes progress against
 * the persisted server state and offers the one voluntary "Do this later"
 * exit (README §7.4). It never invents step content beyond a title.
 */
export function OnboardingRoute() {
  const meQuery = useMe();
  const updateProgress = useUpdateOnboardingProgress();
  const navigate = useNavigate();
  const location = useLocation();
  const hasRequestedStart = useRef(false);

  const result = meQuery.data
    ? parseOnboardingProgressResult(meQuery.data.settings)
    : null;
  const progress = result?.kind === "progress" ? result.progress : null;
  // Grandfathered/malformed both parse to `progress === null` here; a
  // malformed state never reaches this component (OnboardingGate shows its
  // own recoverable error first), so in practice this only fires start/resume
  // for grandfathered, not_started, and deferred visitors.
  const needsStart =
    result !== null &&
    (!progress || progress.status === "deferred" || progress.status === "not_started");

  useEffect(() => {
    if (needsStart && !hasRequestedStart.current) {
      hasRequestedStart.current = true;
      updateProgress.mutate({ action: "start" });
    }
  }, [needsStart, updateProgress]);

  function handleDefer() {
    const state = location.state as OnboardingLocationState | null;
    updateProgress.mutate(
      { action: "defer" },
      {
        onSuccess: () => {
          const returnTo = state?.returnTo;
          navigate(
            returnTo
              ? { pathname: returnTo.pathname, search: returnTo.search, hash: returnTo.hash }
              : "/app/ai",
            { replace: true },
          );
        },
      },
    );
  }

  if (meQuery.isPending || !progress) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  const isCompleted = progress.status === "completed";

  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle render={<h1 />}>Guided setup</CardTitle>
          <CardDescription>
            {isCompleted
              ? "You're all set. This completion view is still being built."
              : `${STEP_TITLES[progress.current_step] ?? progress.current_step} — this flow is still being built. Your progress is saved as you go.`}
          </CardDescription>
        </CardHeader>
        {isCompleted ? null : (
          <CardPanel className="flex gap-2">
            <Button
              disabled={updateProgress.isPending}
              onClick={handleDefer}
              type="button"
              variant="outline"
            >
              Do this later
            </Button>
          </CardPanel>
        )}
      </Card>
    </div>
  );
}
