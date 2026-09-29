import "./features-canvas.css";
import { FEATURES } from "./featureList";

/**
 * Variant "canvas": one dark-green field, the hero's own colour, holding all
 * six features as hairline-divided cells. No card pile; the illustrations
 * are the only light objects and the brand green carries the section.
 */
export function FeaturesCanvas() {
  return (
    <div className="lp-canvas-grid">
      {FEATURES.map(({ id, title, blurb, size, Sheet }) => (
        <article key={id} className={`lp-canvas-cell lp-canvas-cell-${size}`}>
          <div className="lp-canvas-text">
            <h3>{title}</h3>
            <p>{blurb}</p>
          </div>
          <Sheet />
        </article>
      ))}
    </div>
  );
}
