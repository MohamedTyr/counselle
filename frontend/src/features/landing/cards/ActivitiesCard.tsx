import logoRsi from "../assets/activity-logo-rsi.webp";
import logoRegeneron from "../assets/activity-logo-regeneron.webp";
import logoMites from "../assets/activity-logo-mites.webp";
import logoUsaco from "../assets/activity-logo-usaco.webp";
import logoSimons from "../assets/activity-logo-simons.webp";
import logoIsef from "../assets/activity-logo-isef.webp";
import logoYygs from "../assets/activity-logo-yygs.webp";
import logoScholastic from "../assets/activity-logo-scholastic.webp";
import logoCongressional from "../assets/activity-logo-congressional-award.webp";
import logoNhsmun from "../assets/activity-logo-nhsmun.webp";
import plus from "../assets/plus-small.svg";
import "./activities-card.css";

const FILTERS = [
  "For you",
  "Research",
  "Competitions",
  "Summer programs",
  "Volunteering",
];

const ACTIVITIES: {
  name: string;
  logo: string;
  tag?: string;
  add?: boolean;
}[] = [
  { name: "Research Science Institute", logo: logoRsi, tag: "Free" },
  { name: "Regeneron Science Talent Search", logo: logoRegeneron, add: true },
  { name: "MITES Summer", logo: logoMites, tag: "Free" },
  { name: "USA Computing Olympiad", logo: logoUsaco, tag: "Free" },
  { name: "Simons Summer Research", logo: logoSimons },
  { name: "Regeneron ISEF", logo: logoIsef },
  { name: "Yale Young Global Scholars", logo: logoYygs },
  {
    name: "Scholastic Art & Writing Awards",
    logo: logoScholastic,
    tag: "Free",
  },
  { name: "The Congressional Award", logo: logoCongressional, tag: "Free" },
  { name: "National High School Model UN", logo: logoNhsmun },
];

export function ActivitiesSheet() {
  return (
    <div className="lp-sheet lp-sheet-third" aria-hidden="true">
      <div className="lp-filters">
        {FILTERS.map((filter, index) => (
          <span
            key={filter}
            className={index === 0 ? "lp-filter lp-filter-active" : "lp-filter"}
          >
            {filter}
          </span>
        ))}
      </div>
      <span className="lp-fade lp-filters-fade" />
      <div className="lp-activity-viewport">
        <div className="lp-activity-list">
          {[0, 1].map((copy) => (
            <div
              key={copy}
              data-scroll-cycle
              aria-hidden={copy === 1 ? true : undefined}
              className="lp-activity-cycle"
              style={{ height: ACTIVITIES.length * 44 }}
            >
              {ACTIVITIES.map((activity, index) => (
                <div
                  key={activity.name}
                  className={
                    activity.add
                      ? "lp-activity lp-activity-highlight"
                      : "lp-activity"
                  }
                  style={{ top: index * 44 }}
                >
                  <img
                    className="lp-activity-logo"
                    src={activity.logo}
                    width={28}
                    height={28}
                    alt=""
                  />
                  <span className="lp-activity-name">{activity.name}</span>
                  {activity.tag ? (
                    <span className="lp-activity-tag">{activity.tag}</span>
                  ) : null}
                  {activity.add ? (
                    <span className="lp-activity-add">
                      <span className="lp-activity-add-label">
                        <img src={plus} width={12} height={12} alt="" />
                        Add
                      </span>
                      <span className="lp-activity-added">✓ Added</span>
                    </span>
                  ) : null}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
      <span className="lp-fade lp-activities-fade-top" />
      <span className="lp-fade lp-activities-fade" />
    </div>
  );
}
