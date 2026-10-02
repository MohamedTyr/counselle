import { useEffect, useRef } from "react";

/** Within this distance of the top the nav rests in the hero, unframed. */
const REST_ZONE = 24;
/** Scrolling has to travel this far one way before the nav answers it. */
const HIDE_AFTER = 8;
const SHOW_AFTER = 4;

export type NavState = "rest" | "floating" | "hidden";

/**
 * The nav rests in the hero, leaves as the page is read and comes back,
 * framed, the moment the visitor scrolls up. The state is written straight
 * to the element, so scrolling never renders the page.
 */
export function useNavScroll() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const nav = ref.current;
    if (!nav) return;
    let last = Math.max(0, window.scrollY);
    let turned = last;
    let shown = last <= REST_ZONE;
    let frame = 0;

    const write = () => {
      const held = nav.contains(document.activeElement);
      const state: NavState =
        last <= REST_ZONE ? "rest" : shown || held ? "floating" : "hidden";
      if (nav.dataset.state !== state) nav.dataset.state = state;
    };
    const read = () => {
      frame = 0;
      const y = Math.max(0, window.scrollY);
      if (y === last) return;
      const wasResting = last <= REST_ZONE;
      // A change of direction starts a new measure.
      if (y > last !== last > turned) turned = last;
      if (wasResting && y > REST_ZONE) shown = false;
      else if (y - turned > HIDE_AFTER) shown = false;
      else if (turned - y > SHOW_AFTER) shown = true;
      if (y <= REST_ZONE) shown = true;
      last = y;
      write();
    };
    const onScroll = () => {
      frame ||= requestAnimationFrame(read);
    };

    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    nav.addEventListener("focusin", write);
    nav.addEventListener("focusout", write);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      nav.removeEventListener("focusin", write);
      nav.removeEventListener("focusout", write);
    };
  }, []);

  return ref;
}
