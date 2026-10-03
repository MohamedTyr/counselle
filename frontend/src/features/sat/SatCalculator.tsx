import type React from "react";
import { useLayoutEffect, useRef, useState } from "react";

import { SatToolWindow } from "@/features/sat/SatToolWindow";
import { computeSpawnPosition, useToolWindow } from "@/features/sat/use-tool-window";

export interface SatCalculatorProps {
  /** `Settings.sat_desmos_embed_url`, served through `/v1/config` (plan
   * §6.4, O3). `undefined` while `/config` hasn't resolved yet. */
  embedUrl: string | undefined;
  /** Mounted for the life of the practice page; hidden — not unmounted —
   * whenever the current question isn't Math (Q35b). */
  visible: boolean;
  docked: boolean;
  /** The left-column slot to dock into, measured live via `ResizeObserver`
   * (plan §6.4) — the iframe itself is never reparented into it. */
  dockSlotRef: React.RefObject<HTMLDivElement | null>;
  onDock: () => void;
  onFloat: () => void;
  onClose: () => void;
}

const DEFAULT_SIZE = { width: 440, height: 380 };
const MIN_SIZE = { width: 320, height: 280 };
const MAX_VIEWPORT_FRACTION = { width: 0.9, height: 0.85 };
const MIN_Y = 64;
const CALCULATOR_TITLE = "Calculator";

const SPAWN_FALLBACK = { x: 16, y: MIN_Y };

interface Rect {
  top: string;
  left: string;
  width: string;
  height: string;
}

/**
 * The one persistent Desmos calculator iframe (ui-spec §4.1, plan §6.4) —
 * never reparented (an iframe reparent reloads it): its geometry is CSS
 * transform/size only, and it is never unmounted for the life of the
 * practice page.
 */
export function SatCalculator({
  embedUrl,
  visible,
  docked,
  dockSlotRef,
  onDock,
  onFloat,
  onClose,
}: SatCalculatorProps): React.ReactElement | null {
  const toolWindow = useToolWindow({
    defaultPosition: SPAWN_FALLBACK,
    defaultSize: DEFAULT_SIZE,
    sizeBounds: { min: MIN_SIZE, maxViewportFraction: MAX_VIEWPORT_FRACTION },
    minY: MIN_Y,
  });
  const [dockedRect, setDockedRect] = useState<Rect | null>(null);
  const { placeAt } = toolWindow;

  // The window mounts with the page, before the question sheet it must avoid
  // exists, so it is placed the first time it floats into view and not again:
  // after that its position is the student's.
  const placedRef = useRef(false);
  useLayoutEffect(() => {
    if (docked) {
      placedRef.current = false;
      return;
    }
    if (!visible || placedRef.current) return;
    placedRef.current = true;
    placeAt(computeSpawnPosition(DEFAULT_SIZE, MIN_Y, CALCULATOR_TITLE));
  }, [visible, docked, placeAt]);

  // Layout effect: the first docked frame must already have the slot's
  // rectangle, not a zero-size placeholder.
  useLayoutEffect(() => {
    if (!docked) {
      setDockedRect(null);
      return;
    }
    const slot = dockSlotRef.current;
    if (!slot) return;
    function measure() {
      if (!slot) return;
      const rect = slot.getBoundingClientRect();
      setDockedRect({
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(slot);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [docked, dockSlotRef]);

  if (!embedUrl) {
    return null;
  }

  return (
    <SatToolWindow
      badge="SAT graphing"
      dockedRect={docked ? (dockedRect ?? { top: "0px", left: "0px", width: "0px", height: "0px" }) : undefined}
      hidden={!visible}
      onClose={onClose}
      onDock={onDock}
      onFloat={onFloat}
      title={CALCULATOR_TITLE}
      window={toolWindow}
    >
      <iframe
        className="size-full border-0"
        src={embedUrl}
        title="Desmos graphing calculator"
      />
    </SatToolWindow>
  );
}
