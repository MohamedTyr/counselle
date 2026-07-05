import { Navigate, Outlet, useLocation } from "react-router"

import { useMe } from "@/app/auth"
import { destinationFromLocation } from "@/app/auth/redirects"
import { Button } from "@/components/ui/button"
import {
  Card,
  CardDescription,
  CardHeader,
  CardPanel,
  CardTitle,
} from "@/components/ui/card"
import { Spinner } from "@/components/ui/spinner"

export function RequireAuth() {
  const location = useLocation()
  const me = useMe()

  if (me.isPending) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background">
        <Spinner />
      </div>
    )
  }

  if (me.isError) {
    return (
      <div className="flex min-h-svh items-center justify-center bg-background p-6">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle render={<h1 />}>Could not check your session</CardTitle>
            <CardDescription>
              The server could not be reached. Try again before continuing.
            </CardDescription>
          </CardHeader>
          <CardPanel>
            <Button onClick={() => void me.refetch()} type="button">
              Retry
            </Button>
          </CardPanel>
        </Card>
      </div>
    )
  }

  if (me.data === null) {
    return (
      <Navigate
        replace
        state={{ from: destinationFromLocation(location) }}
        to="/login"
      />
    )
  }

  return <Outlet />
}
