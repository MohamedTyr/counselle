import { RouterProvider } from "react-router/dom"

import { AppProviders } from "@/app/AppProviders"
import { createAppRouter, router } from "@/app/router"

type AppProps = {
  routerInstance?: ReturnType<typeof createAppRouter>
}

export function App({ routerInstance = router }: AppProps) {
  return (
    <AppProviders>
      <RouterProvider router={routerInstance} />
    </AppProviders>
  )
}

export default App
