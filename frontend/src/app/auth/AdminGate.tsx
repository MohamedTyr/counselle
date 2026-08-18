import type { ReactNode } from "react";
import { Navigate } from "react-router";

import { useMe } from "@/app/auth";
import { Spinner } from "@/components/ui/spinner";

/** Gates the three `/app/admin/cds/*` routes on `is_superuser` (plan §F1):
 *
 * ```tsx
 * { path: "admin/cds", element: <AdminGate><CdsCoveragePage /></AdminGate> },
 * ```
 *
 * A children-wrapping guard, not an `Outlet`-based layout route like
 * `RequireAuth`/`OnboardingGate` — each of the three admin routes renders a
 * different page, so wrapping the element in place (as PLAN §F1 specifies)
 * is simpler here than a shared nested layout. Sits inside `RequireAuth` →
 * `OnboardingGate`, so by the time this renders the session is already
 * known to exist — this only adds the superuser check on top. */
export function AdminGate({ children }: { children: ReactNode }) {
  const me = useMe();

  if (me.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  if (!me.data?.is_superuser) {
    return <Navigate replace to="/app/ai" />;
  }

  return children;
}
