import { createContext } from "react"

export type GuestAuthCheckContextValue = {
  hasAuthCheckError: boolean
  retryAuthCheck: () => void
}

export const GuestAuthCheckContext =
  createContext<GuestAuthCheckContextValue>({
    hasAuthCheckError: false,
    retryAuthCheck: () => undefined,
  })
