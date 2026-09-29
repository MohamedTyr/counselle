import { Check, Sparkles } from "lucide-react";
import { SCHOOLS, tierLabel } from "./data";
import "./colleges.css";
import "./ask.css";

/**
 * Why each school is on the list, for this student: a Georgia resident with a
 * $25k budget. Figures are the schools' own, for 2025-26.
 */
const WHY: Record<string, string> = {
  harvard: "Free tuition under $200k income",
  stanford: "No tuition under $150k income",
  "georgia-tech": "30% in-state, Zell Miller covers tuition",
  umich: "$84k out of state, only with aid",
  purdue: "EPICS for first-years, needs merit aid",
};

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
          <span>Read your activities, checked 2,700+ schools</span>
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
              <span>{WHY[school.id]}</span>
            </span>
            <span className={`lp-cx-ask-tier lp-cx-ask-tier-${school.tier}`}>
              {tierLabel(school.tier)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
