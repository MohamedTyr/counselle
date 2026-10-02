import { Check, Sparkles } from "lucide-react";
import logoHarvard from "../assets/row-logo-harvard.png";
import logoGeorgiaTech from "../assets/row-logo-georgia-tech.webp";
import logoUmich from "../assets/row-logo-umich.png";
import logoStanford from "../assets/row-logo-stanford.webp";
import logoPurdue from "../assets/row-logo-purdue.png";
import { SCHOOL_COUNT } from "../brand";
import "./ask-sheet.css";

type Tier = "reach" | "target" | "safety";

type School = {
  id: string;
  name: string;
  logo: string;
  tier: Tier;
  /** Why it is on the list, for this student. */
  why: string;
};

const TIER_LABELS: Record<Tier, string> = {
  reach: "Reach",
  target: "Target",
  safety: "Safety",
};

/**
 * The list for a Georgia resident with a $25k budget, in reading order: reach,
 * then target, then safety. Figures are the schools' own, for 2025-26.
 */
const SCHOOLS: School[] = [
  {
    id: "harvard",
    name: "Harvard",
    logo: logoHarvard,
    tier: "reach",
    why: "Free tuition under $200k income",
  },
  {
    id: "stanford",
    name: "Stanford",
    logo: logoStanford,
    tier: "reach",
    why: "No tuition under $150k income",
  },
  {
    id: "georgia-tech",
    name: "Georgia Tech",
    logo: logoGeorgiaTech,
    tier: "target",
    why: "30% in-state, Zell Miller covers tuition",
  },
  {
    id: "umich",
    name: "Michigan",
    logo: logoUmich,
    tier: "target",
    why: "$84k out of state, only with aid",
  },
  {
    id: "purdue",
    name: "Purdue",
    logo: logoPurdue,
    tier: "safety",
    why: "EPICS for first-years, needs merit aid",
  },
];

/** The student asks with their story; the agent answers with it and saves the list. */
export function AskSheet() {
  return (
    <div className="lp-sheet lp-sheet-wide lp-cx lp-cx-ask" aria-hidden="true">
      <div className="lp-cx-ask-chat">
        <p className="lp-cx-ask-user">
          <span>
            Georgia resident, 3.9, 1480, CS. We can do $25k a year. I built a
            sorting robot for our food bank.
          </span>
        </p>
        <p className="lp-cx-ask-step">
          <Sparkles size={13} />
          <span>Read your activities, checked {SCHOOL_COUNT} schools</span>
          <Check className="lp-cx-ask-step-done" size={13} strokeWidth={2.5} />
        </p>
        <p className="lp-cx-ask-text">
          Georgia Tech is your anchor: 30% in-state admit, not 9%, and Zell
          Miller covers tuition, leaving about $19k a year. Lead with the robot;
          it&rsquo;s exactly what Purdue&rsquo;s EPICS builds. Michigan is $84k
          out of state, so only with aid.
        </p>
      </div>
      <div className="lp-cx-ask-list">
        <p className="lp-cx-ask-saved">
          <Check size={13} strokeWidth={2.5} />
          <span>Added to your list</span>
        </p>
        {SCHOOLS.map((school) => (
          <div key={school.id} className="lp-cx-ask-row">
            <img src={school.logo} width={26} height={26} alt="" />
            <span className="lp-cx-ask-school">
              <b>{school.name}</b>
              <span>{school.why}</span>
            </span>
            <span className={`lp-cx-ask-tier lp-cx-ask-tier-${school.tier}`}>
              {TIER_LABELS[school.tier]}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
