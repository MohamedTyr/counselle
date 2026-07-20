import { useEffect, useState } from "react";
import type { RefObject } from "react";

import type { ScrollThumbState } from "@/features/schools/schools-types";

export function WorkspaceScrollIndicator({
  scrollAreaRef,
}: {
  scrollAreaRef: RefObject<HTMLDivElement | null>;
}) {
  const [thumb, setThumb] = useState<ScrollThumbState>({
    height: 0,
    top: 0,
    visible: false,
  });

  useEffect(() => {
    const scrollArea = scrollAreaRef.current;

    if (!scrollArea) {
      return;
    }

    const scrollAreaElement = scrollArea;
    let frame = 0;

    function updateThumb() {
      cancelAnimationFrame(frame);

      frame = requestAnimationFrame(() => {
        const { clientHeight, scrollHeight, scrollTop } = scrollAreaElement;

        if (scrollHeight <= clientHeight + 1) {
          setThumb({ height: 0, top: 0, visible: false });
          return;
        }

        const trackHeight = clientHeight - 32;
        const height = Math.max(
          44,
          Math.round((clientHeight / scrollHeight) * trackHeight),
        );
        const maxTop = trackHeight - height;
        const top = Math.round(
          (scrollTop / (scrollHeight - clientHeight)) * maxTop,
        );

        setThumb({ height, top, visible: true });
      });
    }

    updateThumb();
    scrollAreaElement.addEventListener("scroll", updateThumb, {
      passive: true,
    });
    window.addEventListener("resize", updateThumb);

    const observer = new ResizeObserver(updateThumb);
    observer.observe(scrollAreaElement);

    if (scrollAreaElement.firstElementChild) {
      observer.observe(scrollAreaElement.firstElementChild);
    }

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      scrollAreaElement.removeEventListener("scroll", updateThumb);
      window.removeEventListener("resize", updateThumb);
    };
  }, [scrollAreaRef]);

  if (!thumb.visible) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute top-4 right-1 bottom-4 hidden w-2 md:block"
    >
      <div
        className="absolute right-0.5 w-1.5 rounded-full bg-foreground/20"
        style={{
          height: thumb.height,
          transform: `translateY(${thumb.top}px)`,
        }}
      />
    </div>
  );
}
