import type { Location } from "react-router"

export type AuthDestination = {
  pathname: string
  search: string
  hash: string
}

type LocationState = {
  from?: AuthDestination
  notice?: string
}

export function destinationFromLocation(
  location: Pick<Location, "pathname" | "search" | "hash">,
): AuthDestination | undefined {
  if (!location.pathname.startsWith("/app")) {
    return undefined
  }
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
  }
}

export function safeAuthDestination(state: unknown): AuthDestination {
  const candidate = (state as LocationState | null)?.from
  if (
    candidate &&
    typeof candidate.pathname === "string" &&
    candidate.pathname.startsWith("/app")
  ) {
    return {
      pathname: candidate.pathname,
      search: typeof candidate.search === "string" ? candidate.search : "",
      hash: typeof candidate.hash === "string" ? candidate.hash : "",
    }
  }
  return { pathname: "/app/tasks", search: "", hash: "" }
}

export function noticeFromLocationState(state: unknown): string | undefined {
  const notice = (state as LocationState | null)?.notice
  return typeof notice === "string" ? notice : undefined
}
