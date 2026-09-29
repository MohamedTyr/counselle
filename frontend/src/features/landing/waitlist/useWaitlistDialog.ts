import { useCallback, useEffect, useRef, useState } from "react";
import { track } from "../analytics";
import type { Side } from "./waitlist";

/** Any link to these anchors opens the dialog, so the buttons stay links. */
export const WAITLIST_HREF = "#waitlist";
export const SCHOOLS_HREF = "#waitlist-schools";

export type WaitlistRequest = { side: Side; source: string; plan?: string };

function sideOf(hash: string): Side | null {
  if (hash === SCHOOLS_HREF) return "school";
  if (hash === WAITLIST_HREF) return "me";
  return null;
}

function writeHash(hash: string) {
  const { pathname, search } = window.location;
  window.history.replaceState(null, "", `${pathname}${search}${hash}`);
}

export function useWaitlistDialog() {
  const [request, setRequest] = useState<WaitlistRequest | null>(null);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open && request) track("waitlist_opened", request);
  }, [open, request]);

  useEffect(() => {
    const side = sideOf(window.location.hash);
    if (side) {
      // The hash exists only in the browser, so the prerendered page starts closed.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRequest({ side, source: "link" });
      setOpen(true);
    }
    function onClick(event: MouseEvent) {
      if (event.defaultPrevented || event.button !== 0) return;
      if (event.metaKey || event.ctrlKey || event.shiftKey) return;
      const link = (event.target as Element).closest?.("a");
      const clicked = link && sideOf(link.getAttribute("href") ?? "");
      if (!link || !clicked) return;
      event.preventDefault();
      trigger.current = link;
      setRequest({
        side: clicked,
        source: link.dataset.waitlistSource ?? "link",
        plan: link.dataset.waitlistPlan,
      });
      setOpen(true);
      writeHash(link.getAttribute("href") ?? "");
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    writeHash("");
  }, []);

  const showSide = useCallback((side: Side) => {
    writeHash(side === "school" ? SCHOOLS_HREF : WAITLIST_HREF);
  }, []);

  return { open, request, trigger, close, showSide };
}
