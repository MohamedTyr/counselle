/** Marker placement and axis scaling for the pace matrix: the pure
 * geometry, kept apart from the component so it can be checked without a
 * DOM. */

export interface PaceMarkerInput {
  /** Seconds per attempt. */
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

/** Marker diameters: the full size, and the one used when the plot is too
 * narrow for eight full-size markers to sit apart. */
export const PACE_MARKER_PX = 24;
export const PACE_MARKER_COMPACT_PX = 20;
const COMPACT_BELOW_PLOT_WIDTH_PX = 420;
/** A 2px surface ring keeps neighbours separable. */
const MARKER_RING_PX = 2;
const NUDGE_STEP_PX = 4;
const NUDGE_DIRECTIONS = 12;

export function paceMarkerSize(plotWidth: number): number {
  return plotWidth < COMPACT_BELOW_PLOT_WIDTH_PX ? PACE_MARKER_COMPACT_PX : PACE_MARKER_PX;
}

/** Two centres closer than this read as overlapping. */
export function paceMarkerGap(markerPx: number): number {
  return markerPx + MARKER_RING_PX;
}

/** Space kept between the 0% / 100% lines and the plot edge so a marker
 * sitting on either is never cut by it. */
export function paceVerticalPad(markerPx: number): number {
  return markerPx / 2 + MARKER_RING_PX;
}

/** The y pixel of an accuracy value inside the padded plot. */
export function paceYPx(pct: number, height: number, markerPx: number): number {
  const pad = paceVerticalPad(markerPx);
  return pad + (1 - pct / 100) * (height - 2 * pad);
}

function isClear(
  candidate: MarkerPosition,
  placed: readonly MarkerPosition[],
  gap: number,
): boolean {
  return placed.every(
    (other) => Math.hypot(other.left - candidate.left, other.top - candidate.top) >= gap,
  );
}

function isInside(spot: MarkerPosition, size: PlotSize, markerPx: number): boolean {
  const radius = markerPx / 2;
  const pad = paceVerticalPad(markerPx);
  return (
    spot.left >= radius &&
    spot.left <= size.width - radius &&
    spot.top >= pad &&
    spot.top <= size.height - pad
  );
}

/** Walks outward from `home` on a fixed spiral until a spot is both inside
 * the plot and clear of every placed marker. The search covers the whole
 * plot, so a spot is found whenever one exists; the order of rings and
 * angles is fixed, so the result is deterministic. */
function findClearSpot(
  home: MarkerPosition,
  placed: readonly MarkerPosition[],
  size: PlotSize,
  markerPx: number,
): MarkerPosition {
  const gap = paceMarkerGap(markerPx);
  if (isClear(home, placed, gap)) return home;
  const maxRing = Math.ceil(Math.hypot(size.width, size.height) / NUDGE_STEP_PX);
  for (let ring = 1; ring <= maxRing; ring += 1) {
    for (let step = 0; step < NUDGE_DIRECTIONS; step += 1) {
      const angle = (step / NUDGE_DIRECTIONS) * Math.PI * 2;
      const candidate = {
        left: home.left + Math.cos(angle) * ring * NUDGE_STEP_PX,
        top: home.top + Math.sin(angle) * ring * NUDGE_STEP_PX,
      };
      if (isInside(candidate, size, markerPx) && isClear(candidate, placed, gap)) {
        return candidate;
      }
    }
  }
  return home;
}

/** Where each marker is drawn. A point whose true position is crowded by an
 * earlier one slides outward until it clears, so every marker stays visible
 * and hoverable. The order of `points` decides who keeps the true spot. The
 * tooltip and key always report the true values. */
export function layoutPaceMarkers(
  points: readonly PaceMarkerInput[],
  size: PlotSize,
  xMax: number,
  markerPx: number = PACE_MARKER_PX,
): MarkerPosition[] {
  const radius = markerPx / 2;
  const placed: MarkerPosition[] = [];
  for (const point of points) {
    const home: MarkerPosition = {
      left: Math.min(size.width - radius, Math.max(radius, (point.x / xMax) * size.width)),
      top: paceYPx(point.y, size.height, markerPx),
    };
    placed.push(findClearSpot(home, placed, size, markerPx));
  }
  return placed;
}

const MIN_AXIS_SECONDS = 30;
const AXIS_HEADROOM = 1.6;
const MAX_X_TICKS = 6;
const NICE_STEPS_SECONDS = [5, 10, 15, 20, 30, 60, 120, 300, 600] as const;

export interface PaceAxis {
  readonly max: number;
  readonly step: number;
}

/** The x axis fits the data: 60% headroom past the slowest skill, at least
 * 30 seconds, ending on a whole tick of a round step. */
export function paceAxis(largestSeconds: number): PaceAxis {
  const wanted = Math.max(largestSeconds * AXIS_HEADROOM, MIN_AXIS_SECONDS);
  const step =
    NICE_STEPS_SECONDS.find((candidate) => wanted / candidate <= MAX_X_TICKS) ??
    NICE_STEPS_SECONDS[NICE_STEPS_SECONDS.length - 1];
  return { max: Math.ceil(wanted / step) * step, step };
}

export interface CaptionBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

/** True when a marker (with a little air) touches the caption's box, so the
 * caption is dropped rather than drawn under it. */
export function markerCoversCaption(
  box: CaptionBox,
  spots: readonly MarkerPosition[],
  markerPx: number,
): boolean {
  const reach = markerPx / 2 + MARKER_RING_PX + 2;
  return spots.some(
    (spot) =>
      spot.left + reach > box.left &&
      spot.left - reach < box.left + box.width &&
      spot.top + reach > box.top &&
      spot.top - reach < box.top + box.height,
  );
}
