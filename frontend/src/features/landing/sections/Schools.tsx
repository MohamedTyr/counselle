import { RosterSheet } from "../cards/RosterSheet";
import { CtaArrow } from "./Hero";
import { SCHOOLS_HREF } from "../waitlist/useWaitlistDialog";
import "./schools.css";

const POINTS = [
  {
    title: "See who needs you first",
    body: "Students falling behind rise to the top.",
  },
  {
    title: "Help for every student",
    body: "Not only the ones who can pay for it.",
  },
  {
    title: "Letters and transcripts, tracked",
    body: "See what’s owed before each deadline.",
  },
  {
    title: "Their essays stay theirs",
    body: "Students accept or reject every suggestion.",
  },
];

export function Schools() {
  return (
    <section
      className="lp-schools"
      id="schools"
      aria-labelledby="schools-heading"
    >
      <div className="lp-schools-header">
        <p className="lp-schools-label">For schools</p>
        <h2 className="lp-heading" id="schools-heading">
          Know which students need you <em>this week</em>
        </h2>
        <p className="lp-schools-lede">
          AI college counseling for high schools. Every student gets all of
          Acceptra, and school counselors see where each one stands.
        </p>
      </div>
      <div className="lp-schools-stage">
        <RosterSheet />
      </div>
      <ul className="lp-schools-points">
        {POINTS.map(({ title, body }) => (
          <li key={title}>
            <h3>{title}</h3>
            <p>{body}</p>
          </li>
        ))}
      </ul>
      <a
        className="lp-nav-cta lp-schools-cta"
        href={SCHOOLS_HREF}
        data-waitlist-source="schools"
      >
        Book a walkthrough
        <span className="lp-nav-cta-chip" aria-hidden="true">
          <CtaArrow />
        </span>
      </a>
    </section>
  );
}
