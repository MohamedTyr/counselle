import type { PropsWithChildren } from "react";

import {
  GuestAuthCheckContext,
  type GuestAuthCheckContextValue,
} from "@/app/auth/guest-auth-context";

export function GuestAuthCheckProvider({
  children,
  value,
}: PropsWithChildren<{ value: GuestAuthCheckContextValue }>) {
  return (
    <GuestAuthCheckContext.Provider value={value}>
      {children}
    </GuestAuthCheckContext.Provider>
  );
}
