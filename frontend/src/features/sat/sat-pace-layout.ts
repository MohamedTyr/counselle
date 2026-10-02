/** Marker placement for the pace matrix: the pure geometry, kept apart from
 * the component so it can be checked without a DOM. */

export interface PaceMarkerInput {
  /** Seconds per attempt, already clamped to the plotted range. */
  readonly x: number;
  /** First-try accuracy, 0-100. */
  readonly y: number;
}

export interface PlotSize {
  readonly width: number;
  readonly height: number;
}

export interface MarkerPosition {
  /** Pixels from the plot's left edge / top edge, nudge included. */
  readonly left: number;
  readonly top: number;
}

/** Markers are 24px; a 2px ring keeps neighbours separable, so two centres
 * closer than this read as overlapping. */
export const PACE_MARKER_GAP_PX = 26;

/** Half a marker: a point never sits closer to a side edge than this, so it
 * stays off the y-axis labels and the plot's right border. */
const MARKER_RADIUS_PX = 12;
const NUDGE_STEP_PX = 5;
const NUDGE_MAX_RINGS = 8;
const NUDGE_DIRECTIONS = 8;

function isClear(
  candidate: MarkerPosition,
  placed: readonly MarkerPosition[],
): boolean {
  return placed.every(
    (other) =>
      Math.hypot(other.left - candidate.left, other.top - candidate.top) >=
      PACE_MARKER_GAP_PX,
  );
}

/** Where each marker is drawn. A point whose true position is crowded by an
 * earlier one slides outward on a fixed spiral — staying inside the plot, so
 * a point on the 0% axis never drifts onto the tick labels — until it clears — the order
 * of `points` decides who keeps the true spot, so the result is
 * deterministic. The tooltip and key always report the true values. */
export function layoutPaceMarkers(
  points: readonly PaceMarkerInput[],
  size: PlotSize,
  xMax: number,
): MarkerPosition[] {
  const placed: MarkerPosition[] = [];
  for (const point of points) {
    const home: MarkerPosition = {
      left: Math.min(
        size.width - MARKER_RADIUS_PX,
        Math.max(MARKER_RADIUS_PX, (point.x / xMax) * size.width),
      ),
      top: (1 - point.y / 100) * size.height,
    };
    placed.push(findClearSpot(home, placed, size));
  }
  return placed;
}

function isInside(spot: MarkerPosition, size: PlotSize): boolean {
  return (
    spot.left >= MARKER_RADIUS_PX &&
    spot.left <= size.width - MARKER_RADIUS_PX &&
    spot.top >= 0 &&
    spot.top <= size.height
  );
}

function findClearSpot(
  home: MarkerPosition,
  placed: readonly MarkerPosition[],
  size: PlotSize,
): MarkerPosition {
  if (isClear(home, placed)) return home;
  for (let ring = 1; ring <= NUDGE_MAX_RINGS; ring += 1) {
    for (let step = 0; step < NUDGE_DIRECTIONS; step += 1) {
      const angle = (step / NUDGE_DIRECTIONS) * Math.PI * 2;
      const candidate = {
        left: home.left + Math.cos(angle) * ring * NUDGE_STEP_PX,
        top: home.top + Math.sin(angle) * ring * NUDGE_STEP_PX,
      };
      if (isInside(candidate, size) && isClear(candidate, placed)) return candidate;
    }
  }
  return home;
}

/** The x-axis maximum: far enough to hold every point and the target-pace
 * line, rounded up to a whole tick. */
export function paceAxisMax(
  largestX: number,
  targetX: number,
  tickSeconds: number,
): number {
  const needed = Math.max(largestX, targetX) + tickSeconds / 3;
  return Math.ceil(needed / tickSeconds) * tickSeconds;
}
