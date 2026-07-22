import { Link, Navigate, Outlet, useLocation } from "react-router";

import { parseOnboardingProgressResult } from "@/api/http/onboarding";
import { useMe } from "@/app/auth";
import { destinationFromLocation, type AuthDestination } from "@/app/auth/redirects";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";

/** One-time React Router history state, never persisted to the URL or to
 * `settings` (plan §20.2). `returnTo` is the sanitized `/app/*` destination
 * a not-yet-onboarded visit was redirected away from, restored on deferral;
 * `onboardingCompletion` lets the completion view stay mounted for exactly
 * one render after the progress mutation flips status to `completed`. */
export type OnboardingLocationState = {
  onboardingCompletion?: true;
  returnTo?: AuthDestination;
};

const ONBOARDING_PATH = "/onboarding";
const REDIRECT_TO_ONBOARDING_STATUSES = new Set(["not_started", "in_progress"]);

/** The browser's native History API persists `history.state` (and so
 * `location.state`) across a hard page reload — it is not, as a client-side
 * router's own in-memory state would be, cleared just because the page
 * reloaded. A genuine refresh of the completion screen must still drop the
 * ephemeral `onboardingCompletion` flag (spec §17 "Completion reload"), so
 * this checks the Navigation Timing API for a reload independently of what
 * `location.state` still carries. Falls back to allowing the state through
 * (matching the pre-existing behavior) if the API isn't available, e.g. in
 * a test environment without it stubbed. */
function wasHardReload(): boolean {
  if (typeof performance === "undefined" || !performance.getEntriesByType) {
    return false;
  }
  const [entry] = performance.getEntriesByType("navigation");
  return (entry as PerformanceNavigationTiming | undefined)?.type === "reload";
}

/** Sits between `RequireAuth` and the workspace routes / `/onboarding`,
 * implementing the state matrix in plan §20.2. */
export function OnboardingGate() {
  const location = useLocation();
  const meQuery = useMe();

  // RequireAuth already resolved the session before this gate can render;
  // this guards only the brief window before that first `/me` payload lands.
  if (meQuery.isPending || !meQuery.data) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  const result = parseOnboardingProgressResult(meQuery.data.settings);
  const isOnboardingRoute = location.pathname === ONBOARDING_PATH;

  if (!isOnboardingRoute) {
    if (
      result.kind === "progress" &&
      REDIRECT_TO_ONBOARDING_STATUSES.has(result.progress.status)
    ) {
      const state: OnboardingLocationState = {
        returnTo: destinationFromLocation(location),
      };
      return <Navigate replace state={state} to={ONBOARDING_PATH} />;
    }
    return <Outlet />;
  }

  if (result.kind === "malformed") {
    return <OnboardingRecoverableError onRetry={() => void meQuery.refetch()} />;
  }

  if (result.kind === "progress" && result.progress.status === "completed") {
    const state = location.state as OnboardingLocationState | null;
    if (state?.onboardingCompletion === true && !wasHardReload()) {
      return <Outlet />;
    }
    return <Navigate replace to="/app/profile" />;
  }

  return <Outlet />;
}

function OnboardingRecoverableError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex min-h-svh items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle render={<h1 />}>
            We couldn’t read your setup progress
          </CardTitle>
          <CardDescription>
            Your saved profile is unaffected. Try again, or head into the
            workspace — you can resume guided setup from Profile at any time.
          </CardDescription>
        </CardHeader>
        <CardPanel className="flex gap-2">
          <Button onClick={onRetry} type="button">
            Retry
          </Button>
          <Button render={<Link to="/app/ai" />} type="button" variant="outline">
            Go to workspace
          </Button>
        </CardPanel>
      </Card>
    </div>
  );
}
