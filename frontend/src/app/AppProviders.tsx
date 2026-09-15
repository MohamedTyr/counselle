import type { PropsWithChildren } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";

import { AuthSessionCacheBoundary } from "@/app/auth";
import { queryClient as defaultQueryClient } from "@/app/query-client";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

type AppProvidersProps = PropsWithChildren<{
  queryClient?: QueryClient;
}>;

export function AppProviders({
  children,
  queryClient = defaultQueryClient,
}: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthSessionCacheBoundary>
        <TooltipProvider>{children}</TooltipProvider>
        <Toaster />
      </AuthSessionCacheBoundary>
    </QueryClientProvider>
  );
}
