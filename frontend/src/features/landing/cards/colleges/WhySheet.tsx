import { FEATURED, SCHOOLS, TIERS } from "./data";
import { Logo } from "./Logo";
import { FitCharts } from "./FitCharts";
import "./colleges.css";
import "./why.css";

/** Grouped list on the left; the chosen school opens beside it and shows its fit, drawn. */
export function WhySheet() {
  return (
    <div className="lp-sheet lp-sheet-wide lp-cx lp-cx-why" aria-hidden="true">
      <div className="lp-cx-why-list">
        {TIERS.map((tier) => (
          <div key={tier.id} className="lp-cx-why-group">
            <p className={`lp-cx-why-tier lp-cx-why-tier-${tier.id}`}>
              {tier.label}
            </p>
            {SCHOOLS.filter((school) => school.tier === tier.id).map(
              (school) => (
                <div
                  key={school.id}
                  className="lp-cx-why-row"
                  data-chosen={school === FEATURED ? "" : undefined}
                >
                  {school === FEATURED && <span className="lp-cx-why-cursor" />}
                  <img
                    className="lp-cx-why-logo"
                    src={school.logo}
                    width={26}
                    height={26}
                    alt=""
                  />
                  <b>{school.name}</b>
                </div>
              ),
            )}
          </div>
        ))}
      </div>
      <div className="lp-cx-why-panel">
        <div className="lp-cx-why-school">
          <Logo school={FEATURED} size={38} />
          <b>{FEATURED.name}</b>
        </div>
        <FitCharts />
      </div>
    </div>
  );
}
