import type { PropsWithChildren } from "react"
import {
  QueryClientProvider,
  type QueryClient,
} from "@tanstack/react-query"

import { queryClient as defaultQueryClient } from "@/app/query-client"
import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"

type AppProvidersProps = PropsWithChildren<{
  queryClient?: QueryClient
}>

export function AppProviders({
  children,
  queryClient = defaultQueryClient,
}: AppProvidersProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
