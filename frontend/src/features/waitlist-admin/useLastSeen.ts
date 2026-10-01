import { useEffect, useState } from "react";

const KEY = "waitlist-admin:last-seen";

function read(): string | null {
  try {
    const value = localStorage.getItem(KEY);
    return value !== null && !Number.isNaN(Date.parse(value)) ? value : null;
  } catch {
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(KEY, new Date().toISOString());
  } catch {
    // Private mode or blocked storage: "new since" just stays off.
  }
}

/**
 * When the viewer last *left* this page, or null on a first visit. It is
 * read once per page load, so rows stay "new" for the whole visit, and
 * written on the way out.
 */
export function useLastSeen(): string | null {
  const [lastSeen] = useState(read);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") save();
    };
    window.addEventListener("pagehide", save);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", save);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return lastSeen;
}
