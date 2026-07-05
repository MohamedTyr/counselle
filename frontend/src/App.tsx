import { RouterProvider } from "react-router/dom"
import type { QueryClient } from "@tanstack/react-query"

import { AppProviders } from "@/app/AppProviders"
import { createAppRouter, router } from "@/app/router"

type AppProps = {
  routerInstance?: ReturnType<typeof createAppRouter>
  queryClient?: QueryClient
}

export function App({ queryClient, routerInstance = router }: AppProps) {
  return (
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={routerInstance} />
    </AppProviders>
  )
}

export default App
