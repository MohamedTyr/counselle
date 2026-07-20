import { Navigate, Outlet, useLocation } from "react-router";

import { useMe } from "@/app/auth";
import { GuestAuthCheckProvider } from "@/app/auth/GuestAuthCheckProvider";
import { safeAuthDestination } from "@/app/auth/redirects";
import { Spinner } from "@/components/ui/spinner";

export function GuestOnly() {
  const me = useMe();
  const location = useLocation();

  if (me.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  if (me.data) {
    return <Navigate replace to={safeAuthDestination(location.state)} />;
  }

  return (
    <GuestAuthCheckProvider
      value={{
        hasAuthCheckError: me.isError,
        retryAuthCheck: () => void me.refetch(),
      }}
    >
      <Outlet />
    </GuestAuthCheckProvider>
  );
}
