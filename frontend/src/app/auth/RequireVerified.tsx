import { Navigate, Outlet, useLocation } from "react-router";
import { useMe } from "@/app/auth";
import { destinationFromLocation } from "./redirects";
export function RequireVerified() {
  const me = useMe();
  const location = useLocation();
  if (me.data && !me.data.is_verified)
    return (
      <Navigate
        replace
        to="/verify-email"
        state={{ from: destinationFromLocation(location) }}
      />
    );
  return <Outlet />;
}
