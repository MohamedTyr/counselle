import { useEffect, useState } from "react";

/*
 * design doc §7.1 shell breakpoint. Distinct from `useIsMobile` (768px,
 * `hooks/use-mobile.ts`) — side panels switch at `lg` (1024px), not `md`.
 */
const DESKTOP_BREAKPOINT = 1024;

export function useIsDesktop(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => window.innerWidth >= DESKTOP_BREAKPOINT,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${DESKTOP_BREAKPOINT}px)`);
    const onChange = () =>
      setIsDesktop(window.innerWidth >= DESKTOP_BREAKPOINT);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}
