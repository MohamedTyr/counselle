import { useEffect, useState } from "react";

/** True while the viewport is at most `maxWidth` px wide. */
export function useIsViewportAtMost(maxWidth: number): boolean {
  const [matches, setMatches] = useState(() => window.innerWidth <= maxWidth);
  useEffect(() => {
    function onResize() {
      setMatches(window.innerWidth <= maxWidth);
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [maxWidth]);
  return matches;
}
