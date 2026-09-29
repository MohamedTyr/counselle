import logoHarvard from "../assets/row-logo-harvard.png";
import logoGeorgiaTech from "../assets/row-logo-georgia-tech.png";
import logoUmich from "../assets/row-logo-umich.png";
import logoStanford from "../assets/row-logo-stanford.png";
import logoPurdue from "../assets/row-logo-purdue.png";
import factAcceptance from "../assets/fact-acceptance.svg";
import factGpa from "../assets/fact-gpa.svg";
import factCost from "../assets/fact-cost.svg";
import "./colleges-card.css";

const ROWS = [
  {
    school: "Harvard University",
    logo: logoHarvard,
    tier: "Reach",
    match: 58,
  },
  {
    school: "Georgia Tech",
    logo: logoGeorgiaTech,
    tier: "Target",
    match: 91,
    detail: true,
  },
  {
    school: "University of Michigan",
    logo: logoUmich,
    tier: "Target",
    match: 88,
  },
  {
    school: "Stanford University",
    logo: logoStanford,
    tier: "Reach",
    match: 64,
  },
  {
    school: "Purdue University",
    logo: logoPurdue,
    tier: "Safety",
    match: 95,
  },
];

const RING_RADIUS = 6.75;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

/** The match ring is drawn, so the showcase can draw it. */
function MatchRing({ percent }: { percent: number }) {
  return (
    <svg className="lp-ring" width={18} height={18} viewBox="0 0 18 18">
      <circle cx={9} cy={9} r={RING_RADIUS} className="lp-ring-track" />
      <circle
        cx={9}
        cy={9}
        r={RING_RADIUS}
        className="lp-ring-progress"
        strokeDasharray={RING_LENGTH}
        strokeDashoffset={RING_LENGTH * (1 - percent / 100)}
      />
    </svg>
  );
}

const FACTS = [
  { icon: factAcceptance, text: "16% acceptance rate" },
  { icon: factGpa, text: "Admits average 4.1 GPA" },
  { icon: factCost, text: "$18k a year after aid" },
];

export function CollegesSheet() {
  return (
    <div className="lp-figure lp-sheet-third" aria-hidden="true">
      <div className="lp-sheet lp-sheet-third">
        <div className="lp-match-rows">
          {ROWS.map((row) => (
            <div
              key={row.school}
              className={
                row.detail ? "lp-match-row lp-match-row-detail" : "lp-match-row"
              }
            >
              <img
                className="lp-match-logo"
                src={row.logo}
                width={36}
                height={36}
                alt=""
              />
              <div className="lp-match-name">
                <span>{row.school}</span>
                <span className={`lp-tier lp-tier-${row.tier.toLowerCase()}`}>
                  {row.tier}
                </span>
              </div>
              <div className="lp-match-score">
                <MatchRing percent={row.match} />
                <span>{row.match}%</span>
              </div>
            </div>
          ))}
        </div>
        <span className="lp-fade lp-match-fade-top" />
        <span className="lp-fade lp-match-fade-bottom" />
      </div>
      <div className="lp-popover">
        <div className="lp-popover-header">
          <span>Georgia Tech</span>
          <img src={logoGeorgiaTech} width={24} height={24} alt="" />
        </div>
        <div className="lp-popover-facts">
          {FACTS.map((fact) => (
            <div key={fact.text} className="lp-popover-fact">
              <img src={fact.icon} width={13} height={13} alt="" />
              <span>{fact.text}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function CollegesCard() {
  return (
    <article className="lp-card-third lp-card-colleges">
      <h3>Colleges that match you</h3>
      <CollegesSheet />
    </article>
  );
}
