import { PROFILE, SCHOOLS, TIERS } from "./data";
import { Logo } from "./Logo";
import "./colleges.css";
import "./columns.css";

/** The profile on top; every school is dealt into its column below it. */
export function ColumnsSheet() {
  return (
    <div className="lp-sheet lp-sheet-wide lp-cx lp-cx-cols" aria-hidden="true">
      <div className="lp-cx-cols-strip">
        <span className="lp-cx-muted">Built from</span>
        {PROFILE.map((item) => (
          <span key={item.label} className="lp-cx-chip">
            <b>{item.value}</b> {item.unit}
          </span>
        ))}
        <span className="lp-cx-cols-total lp-cx-muted">5 of 400+ schools</span>
      </div>
      <div className="lp-cx-cols-board">
        {TIERS.map((tier) => {
          const schools = SCHOOLS.filter((school) => school.tier === tier.id);
          return (
            <div key={tier.id} className={`lp-cx-col lp-cx-col-${tier.id}`}>
              <p className="lp-cx-col-head">
                <i />
                {tier.label}
                <span className="lp-cx-col-count">{schools.length}</span>
              </p>
              {schools.map((school) => (
                <div
                  key={school.id}
                  className="lp-cx-card"
                  data-deal={SCHOOLS.indexOf(school)}
                >
                  <Logo school={school} size={36} />
                  <span className="lp-cx-card-text">
                    <b>{school.name}</b>
                    <span className="lp-cx-muted">{school.reason}</span>
                  </span>
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
