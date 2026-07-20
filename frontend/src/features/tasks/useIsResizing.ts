import { useEffect, useRef, useState } from "react";

export function useIsResizing() {
  const [isResizing, setIsResizing] = useState(false);
  const resizeTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    function handleResize() {
      setIsResizing(true);

      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }

      resizeTimeoutRef.current = window.setTimeout(() => {
        setIsResizing(false);
      }, 180);
    }

    window.addEventListener("resize", handleResize);

    return () => {
      window.removeEventListener("resize", handleResize);

      if (resizeTimeoutRef.current !== null) {
        window.clearTimeout(resizeTimeoutRef.current);
      }
    };
  }, []);

  return isResizing;
}
