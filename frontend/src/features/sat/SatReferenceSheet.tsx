import type React from "react";
import { useState } from "react";

import { SatToolWindow } from "@/features/sat/SatToolWindow";
import { useToolWindow } from "@/features/sat/use-tool-window";

export interface SatReferenceSheetProps {
  onClose: () => void;
}

const DEFAULT_SIZE = { width: 880, height: 600 };
const MIN_SIZE = { width: 0, height: 380 };
const MAX_VIEWPORT_FRACTION = { width: 0.95, height: 0.9 };
const SPAWN_TOP = 72;
const MIN_Y = 64;

/** Centred under the top bar. */
function spawnPosition(): { x: number; y: number } {
  return {
    x: Math.max(16, (window.innerWidth - DEFAULT_SIZE.width) / 2),
    y: SPAWN_TOP,
  };
}

const ROW_ONE = [1, 2, 3, 4];
const ROW_TWO = [5, 6, 7, 8, 9, 10, 11];

const FACT_LINES = [
  "The number of degrees of arc in a circle is 360.",
  "The number of radians of arc in a circle is 2π.",
  "The sum of the measures in degrees of the angles of a triangle is 180.",
];

/**
 * The Math-only reference sheet (ui-spec §4.1, §6.5; Q37) — floating only,
 * unmounted on close so it reopens at its start position, unlike the
 * calculator.
 */
export function SatReferenceSheet({ onClose }: SatReferenceSheetProps): React.ReactElement {
  const [spawn] = useState(spawnPosition);
  const toolWindow = useToolWindow({
    defaultPosition: spawn,
    defaultSize: DEFAULT_SIZE,
    sizeBounds: { min: MIN_SIZE, maxViewportFraction: MAX_VIEWPORT_FRACTION },
    minY: MIN_Y,
  });

  return (
    <SatToolWindow onClose={onClose} title="Reference sheet" window={toolWindow}>
      <div className="h-full overflow-y-auto p-4">
        <div className="grid grid-cols-5 gap-3">
          {ROW_ONE.map((n) => (
            <img
              alt={`Reference figure ${n}`}
              className="col-span-1 size-full select-none object-contain"
              draggable={false}
              key={n}
              src={`/sat/reference/${n}.svg`}
            />
          ))}
          <img
            alt="Special right triangles"
            className="col-span-1 size-full select-none object-contain"
            draggable={false}
            src="/sat/reference/special-triangles.png"
          />
        </div>
        <div className="mt-3 grid grid-cols-7 gap-3">
          {ROW_TWO.map((n) => (
            <img
              alt={`Reference figure ${n}`}
              className="select-none object-contain"
              draggable={false}
              key={n}
              src={`/sat/reference/${n}.svg`}
            />
          ))}
        </div>
        <div className="mt-4 flex flex-col gap-1 text-sm">
          {FACT_LINES.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      </div>
    </SatToolWindow>
  );
}
