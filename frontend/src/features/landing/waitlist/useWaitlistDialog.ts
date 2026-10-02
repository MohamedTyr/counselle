import { useCallback, useEffect, useRef, useState } from "react";
import { afterLoadAndIdle, track } from "../analytics";
import { isSource, type PlanId, type Side, type Source } from "./contract";

/** Any link to these anchors opens the dialog, so the buttons stay links. */
export const WAITLIST_HREF = "#waitlist";
export const SCHOOLS_HREF = "#waitlist-schools";

export type WaitlistRequest = { side: Side; source: Source; plan?: PlanId };

function sideOf(hash: string): Side | null {
  if (hash === SCHOOLS_HREF) return "school";
  if (hash === WAITLIST_HREF) return "me";
  return null;
}

const WARM_EVENTS = ["pointerenter", "touchstart", "focusin"];

/**
 * Loads a module (the dialog) on the first sign of intent toward any waitlist
 * link, on idle after load, or once it is needed, and returns it when ready.
 * Rendering the loaded module directly, rather than through React.lazy, means
 * an open after the warm-up never waits on a Suspense reveal.
 */
export function useWarmWaitlist<T>(
  load: () => Promise<T>,
  needed: boolean,
): T | null {
  const [loaded, setLoaded] = useState<T | null>(null);
  const started = useRef(false);
  const warm = useCallback(() => {
    if (started.current) return;
    started.current = true;
    // A failed chunk lets the next intent try again.
    load().then(setLoaded, () => {
      started.current = false;
    });
  }, [load]);

  useEffect(() => {
    let live = true;
    function onIntent(event: Event) {
      if ((event.target as Element).closest?.('a[href^="#waitlist"]')) warm();
    }
    for (const type of WARM_EVENTS)
      document.addEventListener(type, onIntent, {
        capture: true,
        passive: true,
      });
    void afterLoadAndIdle().then(() => {
      if (live) warm();
    });
    return () => {
      live = false;
      for (const type of WARM_EVENTS)
        document.removeEventListener(type, onIntent, true);
    };
  }, [warm]);

  useEffect(() => {
    if (needed) warm();
  }, [needed, warm]);

  return loaded;
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
      // A no-JS #waitlist link scrolls to the footer form; the dialog opens on top.
      window.scrollTo(0, 0);
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
        // An unknown source is recorded as a link, never a rejected signup.
        source: isSource(link.dataset.waitlistSource)
          ? link.dataset.waitlistSource
          : "link",
        plan: link.dataset.waitlistPlan as PlanId | undefined,
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
