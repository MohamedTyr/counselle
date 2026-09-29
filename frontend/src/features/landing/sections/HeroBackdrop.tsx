import type { CSSProperties } from "react";

/** Column heights from the hero's edge to its centre; the right half mirrors. */
const COLUMN_HEIGHTS = [
  620, 582.085, 545.544, 510.48, 477.018, 445.316, 415.577, 388.078, 363.225,
  341.689, 324.922,
];
const COLUMN_TONES = ["a", "a", "a", "b", "c", "c", "c", "d", "d", "d", "d"];
const COLUMN_COUNT = COLUMN_HEIGHTS.length * 2;

const COLUMNS = Array.from({ length: COLUMN_COUNT }, (_, index) => {
  const mirrored = Math.min(index, COLUMN_COUNT - 1 - index);
  return {
    index,
    tone: COLUMN_TONES[mirrored],
    height: COLUMN_HEIGHTS[mirrored],
  };
});

export function HeroBackdrop() {
  return (
    <div className="lp-hero-backdrop" aria-hidden="true">
      {COLUMNS.map(({ index, tone, height }) => {
        const style = {
          "--lp-column": index,
          "--lp-column-height": `${height}px`,
        } as CSSProperties;
        return (
          <div key={index} className="lp-hero-column-slot" style={style}>
            <div className={`lp-hero-column lp-hero-column-${tone}`} />
            <div className="lp-hero-column-edge" />
          </div>
        );
      })}
      <div className="lp-hero-bloom" />
    </div>
  );
}
