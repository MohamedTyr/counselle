import type { PropsWithChildren } from "react"

import { ThemeProvider } from "@/components/theme-provider"
import { TooltipProvider } from "@/components/ui/tooltip"
import { WorkspaceProvider } from "@/app/workspace/WorkspaceProvider"

export function AppProviders({ children }: PropsWithChildren) {
  return (
    <ThemeProvider>
      <TooltipProvider>
        <WorkspaceProvider>{children}</WorkspaceProvider>
      </TooltipProvider>
    </ThemeProvider>
  )
}
