// How many chips fit in a month row, measured rather than assumed: the rendered
// height of one week row, one date band and the step between two probe chips.
// Read in a layout effect so the first paint already has the right count, and
// re-read whenever the grid resizes. Never computed from token strings —
// `getComputedStyle` hands custom properties back unresolved.
import { useLayoutEffect, useState, type RefObject } from "react";

/** jsdom renders nothing at a real size. */
const FALLBACK_VISIBLE = 3;
const CELL_BOTTOM_PAD_PX = 4;

export function useVisibleChipCount(
  gridRef: RefObject<HTMLElement | null>,
  probeRef: RefObject<HTMLElement | null>,
  rowCount: number,
): number {
  const [visible, setVisible] = useState(FALLBACK_VISIBLE);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    const probe = probeRef.current;
    if (!grid || !probe) {
      return;
    }

    function measure() {
      const row = grid?.querySelector<HTMLElement>(
        "[data-calendar-week] [role=gridcell]",
      );
      const band = probe?.querySelector<HTMLElement>("[data-probe-band]");
      const chips = probe?.querySelectorAll<HTMLElement>("[data-probe-chip]");
      if (!row || !band || !chips || chips.length < 2) {
        return;
      }
      const rowHeight = row.offsetHeight;
      const step = chips[1].offsetTop - chips[0].offsetTop;
      const gap = step - chips[0].offsetHeight;
      if (rowHeight === 0 || step <= 0) {
        setVisible(FALLBACK_VISIBLE);
        return;
      }
      const room = rowHeight - band.offsetHeight - CELL_BOTTOM_PAD_PX + gap;
      setVisible(Math.max(1, Math.floor(room / step)));
    }

    measure();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    return () => observer.disconnect();
  }, [gridRef, probeRef, rowCount]);

  return visible;
}
