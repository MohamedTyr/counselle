import type { CSSProperties } from "react";
import { FEATURED, PROFILE, SCHOOLS, TIERS } from "./data";
import { Logo } from "./Logo";
import "./colleges.css";
import "./map.css";

/** Percent of the plot height the fit line sits at; the list is what clears it. */
const FIT_LINE = 42;
/** Each tier's band along the chances axis, in percent. */
const ZONES = [
  { tier: "reach", left: 0, width: 36 },
  { tier: "target", left: 36, width: 34 },
  { tier: "safety", left: 70, width: 30 },
];

/** A fixed scatter of the schools that were checked and fell below the line. */
const CHECKED = (() => {
  let seed = 7;
  const next = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  return Array.from({ length: 64 }, () => {
    const chances = 3 + next() * 94;
    const fit = 6 + next() ** 1.4 * (FIT_LINE - 12);
    return [chances, fit] as const;
  });
})();

const at = (chances: number, fit: number) =>
  ({ left: `${chances}%`, bottom: `${fit}%` }) as CSSProperties;

/** Every school checked, plotted by chances and fit; the list is what clears the line. */
export function MapSheet() {
  return (
    <div className="lp-sheet lp-sheet-wide lp-cx lp-cx-map" aria-hidden="true">
      <div className="lp-cx-map-profile">
        <p className="lp-cx-map-title">Your profile</p>
        {PROFILE.map((item) => (
          <p key={item.label} className="lp-cx-map-field">
            <span className="lp-cx-muted">{item.label}</span>
            <b>
              {item.value}
              {item.label === "Budget" ? ` ${item.unit}` : null}
            </b>
          </p>
        ))}
        <p className="lp-cx-map-count lp-cx-muted">
          <b>5</b> fit, out of 400+ checked
        </p>
      </div>
      <div className="lp-cx-map-plot">
        <div className="lp-cx-map-area">
          {ZONES.map((zone) => (
            <span
              key={zone.tier}
              className={`lp-cx-map-zone lp-cx-map-zone-${zone.tier}`}
              style={{ left: `${zone.left}%`, width: `${zone.width}%` }}
            />
          ))}
          {CHECKED.map(([chances, fit], index) => (
            <i key={index} className="lp-cx-map-dot" style={at(chances, fit)} />
          ))}
          <span className="lp-cx-map-line" style={{ bottom: `${FIT_LINE}%` }}>
            <b>Fits you</b>
          </span>
          {SCHOOLS.map((school) => (
            <span
              key={school.id}
              className={
                school === FEATURED
                  ? "lp-cx-map-pin lp-cx-map-pin-featured"
                  : "lp-cx-map-pin"
              }
              style={at(school.chances, school.fit)}
            >
              <Logo school={school} size={school === FEATURED ? 40 : 32} />
            </span>
          ))}
          <div
            className="lp-cx-map-label"
            style={at(FEATURED.chances, FEATURED.fit)}
          >
            <b>{FEATURED.name}</b>
            <span>{FEATURED.reason}</span>
          </div>
          <span className="lp-cx-map-axis-y">Fit</span>
        </div>
        <div className="lp-cx-map-scale">
          {TIERS.map((tier) => (
            <span
              key={tier.id}
              className={`lp-cx-map-step lp-cx-map-step-${tier.id}`}
            >
              {tier.label}
            </span>
          ))}
          <span className="lp-cx-map-axis-x">Your chances</span>
        </div>
      </div>
    </div>
  );
}
