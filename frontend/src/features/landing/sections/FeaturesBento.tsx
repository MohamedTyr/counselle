import type { CSSProperties } from "react";
import "./features-bento.css";
import { FEATURES } from "./featureList";

/**
 * Variant "bento": the six features on light, feature-tinted tiles in a
 * two-column grid that alternates which side the wide tile sits on. The
 * illustrations are the only bright objects; the tints carry identity
 * quietly instead of six saturated blocks.
 */
export function FeaturesBento() {
  return (
    <div className="lp-bento">
      {FEATURES.map(({ id, title, blurb, size, color, tint, Sheet }) => (
        <article
          key={id}
          className={`lp-bento-tile lp-bento-tile-${size}`}
          style={{ "--tile-tint": tint, "--tile-ink": color } as CSSProperties}
        >
          <div className="lp-bento-text">
            <h3>{title}</h3>
            <p>{blurb}</p>
          </div>
          <Sheet />
        </article>
      ))}
    </div>
  );
}
