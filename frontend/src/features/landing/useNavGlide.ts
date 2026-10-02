import { useEffect, useRef } from "react";

/**
 * One highlight travels between the nav links under a fine pointer. It is
 * clipped to the hovered link, so moving along the row glides it rather than
 * fading one pill out and the next in. Arriving from outside the row it
 * appears in place. Written straight to the element, so hovering never
 * renders the page.
 */
export function useNavGlide() {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const links = ref.current;
    const glide = links?.querySelector<HTMLElement>(".lp-nav-glide");
    if (!links || !glide) return;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)");

    const onOver = (event: PointerEvent) => {
      const link = (event.target as Element).closest("a");
      if (!fine.matches || !link || !links.contains(link)) return;
      const left = link.offsetLeft;
      const right = links.clientWidth - left - link.offsetWidth;
      const arriving = glide.dataset.on !== "true";
      if (arriving) glide.dataset.snap = "true";
      glide.style.clipPath = `inset(0 ${right}px 0 ${left}px round 999px)`;
      glide.dataset.on = "true";
      if (arriving) {
        void glide.offsetWidth;
        delete glide.dataset.snap;
      }
    };
    const onLeave = () => {
      glide.dataset.on = "false";
    };

    links.addEventListener("pointerover", onOver);
    links.addEventListener("pointerleave", onLeave);
    return () => {
      links.removeEventListener("pointerover", onOver);
      links.removeEventListener("pointerleave", onLeave);
    };
  }, []);

  return ref;
}
