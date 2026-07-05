import { render } from "@testing-library/react"
import { vi } from "vitest"

import App from "@/App"
import { createAppRouter } from "@/app/router"
import { createQueryClient } from "@/app/query-client"
import type { MeData } from "@/api/http/auth"

export const authUserFixture: MeData = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "student@counselle.test",
  name: "Student User",
  has_password: true,
  google_connected: false,
  settings: {},
}

type FetchHandler = (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>

type RenderAppOptions = {
  fetchHandler?: FetchHandler
}

export function createTestQueryClient() {
  return createQueryClient()
}

export function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init?.headers,
    },
  })
}

export function emptyResponse(init?: ResponseInit) {
  return new Response(null, { status: 204, ...init })
}

export function defaultAuthenticatedFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
) {
  const url = String(input)
  if (url.endsWith("/v1/me")) {
    return jsonResponse(authUserFixture)
  }
  if (url.endsWith("/v1/auth/logout") && init?.method === "POST") {
    return emptyResponse()
  }
  return jsonResponse({})
}

function createDefaultAuthenticatedFetch() {
  let loggedOut = false
  return (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith("/v1/me")) {
      return loggedOut
        ? jsonResponse({ detail: "Unauthorized" }, { status: 401 })
        : jsonResponse(authUserFixture)
    }
    if (url.endsWith("/v1/auth/logout") && init?.method === "POST") {
      loggedOut = true
      return emptyResponse()
    }
    return jsonResponse({})
  }
}

export function anonymousFetch(input: RequestInfo | URL) {
  const url = String(input)
  if (url.endsWith("/v1/me")) {
    return jsonResponse({ detail: "Unauthorized" }, { status: 401 })
  }
  return jsonResponse({})
}

export function authErrorFetch(input: RequestInfo | URL) {
  const url = String(input)
  if (url.endsWith("/v1/me")) {
    return jsonResponse({ error: { message: "Server failed" } }, { status: 500 })
  }
  return jsonResponse({})
}

export function renderApp(path = "/", options: RenderAppOptions = {}) {
  window.history.replaceState(null, "", path)
  const queryClient = createTestQueryClient()
  vi.stubGlobal(
    "fetch",
    vi.fn(options.fetchHandler ?? createDefaultAuthenticatedFetch()),
  )
  return {
    queryClient,
    ...render(
      <App queryClient={queryClient} routerInstance={createAppRouter()} />,
    ),
  }
}
