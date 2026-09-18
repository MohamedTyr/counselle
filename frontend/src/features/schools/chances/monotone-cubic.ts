/*
 * Monotone cubic interpolation (Fritsch–Carlson). Smooth through every knot
 * and never overshoots one — the property both of its callers depend on: a
 * class's cumulative share must never fall as the score rises, and a drawn
 * chance curve must never bulge above a sampled chance.
 */

export type Knot = { x: number; y: number };

/** A caller may hand knots built from a malformed report (duplicate or
 * out-of-order edges); collapsing to a non-decreasing run here is what keeps
 * every curve below finite instead of NaN. */
function dedupeKnots(knots: Knot[]): Knot[] {
  const deduped: Knot[] = [];
  for (const knot of knots) {
    const prev = deduped[deduped.length - 1];
    if (!prev || knot.x > prev.x) deduped.push(knot);
    else if (knot.x === prev.x) deduped[deduped.length - 1] = knot;
  }
  return deduped;
}

function monotoneTangents(knots: Knot[]): number[] {
  const n = knots.length;
  if (n < 2) return knots.map(() => 0);
  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i += 1)
    slopes.push((knots[i + 1]!.y - knots[i]!.y) / (knots[i + 1]!.x - knots[i]!.x));
  const tangents = [slopes[0]!];
  for (let i = 1; i < n - 1; i += 1) {
    const [a, b] = [slopes[i - 1]!, slopes[i]!];
    tangents.push(a * b <= 0 ? 0 : (2 * a * b) / (a + b));
  }
  tangents.push(slopes[n - 2]!);
  return tangents;
}

/** `knots` need not already be strictly increasing in x, or number at least
 * two — duplicate/out-of-order x is deduped above, and fewer than two knots
 * degrades to a constant function (the single y, or 0 for none) rather than
 * an undefined tangent. Clamps outside the range. */
export function monotoneInterpolator(knots: Knot[]): (x: number) => number {
  const deduped = dedupeKnots(knots);
  if (deduped.length === 0) return () => 0;
  if (deduped.length === 1) {
    const only = deduped[0]!.y;
    return () => only;
  }
  const tangents = monotoneTangents(deduped);
  return (x) => {
    if (x <= deduped[0]!.x) return deduped[0]!.y;
    const last = deduped[deduped.length - 1]!;
    if (x >= last.x) return last.y;
    let i = 0;
    while (deduped[i + 1]!.x < x) i += 1;
    const [p, q] = [deduped[i]!, deduped[i + 1]!];
    const h = q.x - p.x;
    const t = (x - p.x) / h;
    const [t2, t3] = [t * t, t * t * t];
    return (
      (2 * t3 - 3 * t2 + 1) * p.y +
      (t3 - 2 * t2 + t) * h * tangents[i]! +
      (-2 * t3 + 3 * t2) * q.y +
      (t3 - t2) * h * tangents[i + 1]!
    );
  };
}

/** The same curve as an SVG path through the knots. */
export function monotonePath(knots: Knot[]): string {
  const deduped = dedupeKnots(knots);
  if (deduped.length < 3)
    return deduped.map((knot, i) => `${i ? "L" : "M"}${knot.x},${knot.y}`).join("");
  const tangents = monotoneTangents(deduped);
  let d = `M${deduped[0]!.x},${deduped[0]!.y}`;
  for (let i = 0; i < deduped.length - 1; i += 1) {
    const [p, q] = [deduped[i]!, deduped[i + 1]!];
    const third = (q.x - p.x) / 3;
    d += `C${p.x + third},${p.y + tangents[i]! * third} ${q.x - third},${q.y - tangents[i + 1]! * third} ${q.x},${q.y}`;
  }
  return d;
}
