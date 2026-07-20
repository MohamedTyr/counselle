import { useContext } from "react";

import { GuestAuthCheckContext } from "@/app/auth/guest-auth-context";

export function useGuestAuthCheck() {
  return useContext(GuestAuthCheckContext);
}
