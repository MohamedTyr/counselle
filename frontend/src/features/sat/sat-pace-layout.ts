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

/** A drawn marker and the point its data truly sits on. They differ only
 * when the marker was nudged off a crowded spot; the chart then draws a
 * leader between the two so position is never misleading. */
export interface PlacedMarker extends MarkerPosition {
  readonly homeLeft: number;
  readonly homeTop: number;
}

/** Marker diameters: the full size, and the one used when the plot is too
 * narrow for eight full-size markers to sit apart. */
export const PACE_MARKER_PX = 24;
export const PACE_MARKER_COMPACT_PX = 20;
const COMPACT_BELOW_PLOT_WIDTH_PX = 420;
/** A 2px surface ring keeps neighbours separable. */
const MARKER_RING_PX = 2;
/** Clear space kept between neighbouring markers so a leader line is
 * visible in the gap between them. */
const LEADER_ROOM_PX = 6;
const NUDGE_STEP_PX = 4;
const NUDGE_DIRECTIONS = 12;
/** A marker is never moved further than this many gaps from its true
 * point, so the leader stays short and the quadrant it reads in is still
 * the true one. */
const MAX_NUDGE_GAPS = 4;

export function paceMarkerSize(plotWidth: number): number {
  return plotWidth < COMPACT_BELOW_PLOT_WIDTH_PX ? PACE_MARKER_COMPACT_PX : PACE_MARKER_PX;
}

/** Two centres closer than this read as overlapping (or leave no room for
 * a leader line between them). */
export function paceMarkerGap(markerPx: number): number {
  return markerPx + MARKER_RING_PX + LEADER_ROOM_PX;
}

/** How far from its centre a marker's edge (ring included) reaches. */
export function paceMarkerReach(markerPx: number): number {
  return markerPx / 2 + MARKER_RING_PX;
}

export interface LeaderSegment {
  readonly x1: number;
  readonly y1: number;
  readonly x2: number;
  readonly y2: number;
  /** The true point, when no marker sits on it to show it. */
  readonly dot: { readonly x: number; readonly y: number } | null;
}

const LEADER_MIN_PX = 3;
const COVERED_WITHIN_PX = 2;

/** The leader for a nudged marker: from its edge back to its true point,
 * stopping at the edge of the marker that holds that point. `null` for a
 * marker that was not moved, or when no line fits between the two. */
export function leaderSegment(
  spot: PlacedMarker,
  all: readonly PlacedMarker[],
  markerPx: number,
): LeaderSegment | null {
  const dx = spot.homeLeft - spot.left;
  const dy = spot.homeTop - spot.top;
  const distance = Math.hypot(dx, dy);
  if (distance <= LEADER_MIN_PX) return null;
  const reach = paceMarkerReach(markerPx);
  const ux = dx / distance;
  const uy = dy / distance;
  const covered = all.some(
    (other) =>
      other !== spot &&
      Math.hypot(other.left - spot.homeLeft, other.top - spot.homeTop) <= COVERED_WITHIN_PX,
  );
  const end = covered ? distance - reach : distance;
  if (end - reach < LEADER_MIN_PX) return null;
  return {
    dot: covered ? null : { x: spot.homeLeft, y: spot.homeTop },
    x1: spot.left + ux * reach,
    x2: spot.left + ux * end,
    y1: spot.top + uy * reach,
    y2: spot.top + uy * end,
  };
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

/** Walks outward from `home` on a fixed spiral, no further than the nudge
 * cap, until a spot is both inside the plot and clear of every placed
 * marker. The order of rings and angles is fixed, so the result is
 * deterministic. */
function findClearSpot(
  home: MarkerPosition,
  placed: readonly MarkerPosition[],
  size: PlotSize,
  markerPx: number,
): MarkerPosition {
  const gap = paceMarkerGap(markerPx);
  if (isClear(home, placed, gap)) return home;
  const maxRing = Math.ceil((MAX_NUDGE_GAPS * gap) / NUDGE_STEP_PX);
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
 * earlier one slides outward (within the nudge cap) until it clears, so
 * every marker stays visible and hoverable. The order of `points` decides
 * who keeps the true spot. The tooltip and key always report the true
 * values. */
export function layoutPaceMarkers(
  points: readonly PaceMarkerInput[],
  size: PlotSize,
  xMax: number,
  markerPx: number = PACE_MARKER_PX,
): PlacedMarker[] {
  const radius = markerPx / 2;
  const placed: PlacedMarker[] = [];
  for (const point of points) {
    const home: MarkerPosition = {
      left: Math.min(size.width - radius, Math.max(radius, (point.x / xMax) * size.width)),
      top: paceYPx(point.y, size.height, markerPx),
    };
    const spot = findClearSpot(home, placed, size, markerPx);
    placed.push({ ...spot, homeLeft: home.left, homeTop: home.top });
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
