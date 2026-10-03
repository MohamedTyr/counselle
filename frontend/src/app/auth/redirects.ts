import type { Location } from "react-router";
export type AuthDestination = {
  pathname: string;
  search: string;
  hash: string;
};
type LocationState = { from?: AuthDestination; notice?: string };

/** Restrict auth returns to actual private routes; reject encoded path separators
 * and dot segments before URL normalization can reinterpret them. */
export function safeAuthPath(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.includes("\\") ||
    [...value].some((character) => character.charCodeAt(0) <= 32)
  )
    return "/app/ai";
  const path = value.split(/[?#]/, 1)[0];
  if (
    !/^\/(?:app(?:\/|$)|account$|onboarding$)/.test(path) ||
    /%|(?:^|\/)\.{1,2}(?:\/|$)/.test(path)
  )
    return "/app/ai";
  return value;
}

export function destinationFromLocation(
  location: Pick<Location, "pathname" | "search" | "hash">,
): AuthDestination | undefined {
  if (safeAuthPath(location.pathname) !== location.pathname) return undefined;
  return {
    pathname: location.pathname,
    search: location.search,
    hash: location.hash,
  };
}

export function safeAuthDestination(state: unknown): AuthDestination {
  const candidate = (state as LocationState | null)?.from;
  if (
    candidate &&
    typeof candidate.pathname === "string" &&
    safeAuthPath(candidate.pathname) === candidate.pathname
  ) {
    return {
      pathname: candidate.pathname,
      search:
        typeof candidate.search === "string" && candidate.search.startsWith("?")
          ? candidate.search
          : "",
      hash:
        typeof candidate.hash === "string" && candidate.hash.startsWith("#")
          ? candidate.hash
          : "",
    };
  }
  return { pathname: "/app/ai", search: "", hash: "" };
}
export function authDestinationPath(state: unknown): string {
  const { pathname, search, hash } = safeAuthDestination(state);
  return `${pathname}${search}${hash}`;
}
export function noticeFromLocationState(state: unknown): string | undefined {
  const notice = (state as LocationState | null)?.notice;
  return typeof notice === "string" ? notice : undefined;
}
