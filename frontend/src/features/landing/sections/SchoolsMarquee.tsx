import markBerkeley from "../assets/mark-berkeley.png";
import markBrown from "../assets/mark-brown.png";
import markCaltech from "../assets/mark-caltech.png";
import markHarvard from "../assets/mark-harvard.png";
import markCornell from "../assets/mark-cornell.png";
import markDartmouth from "../assets/mark-dartmouth.png";
import markDuke from "../assets/mark-duke.png";
import markStanford from "../assets/mark-stanford.png";
import markJhu from "../assets/mark-jhu.png";
import markMit from "../assets/mark-mit.png";
import markNorthwestern from "../assets/mark-northwestern.png";
import markGeorgiaTech from "../assets/mark-georgia-tech.png";
import markPrinceton from "../assets/mark-princeton.png";
import markUmich from "../assets/mark-umich.png";
import markUpenn from "../assets/mark-upenn.png";
import markPurdue from "../assets/mark-purdue.png";
import markYale from "../assets/mark-yale.png";
import "./marquee.css";

type Tile = { name: string; src: string };

/** Marks without their tile backgrounds; the marquee mutes their colour. */
const TILES: Tile[] = [
  { name: "UC Berkeley", src: markBerkeley },
  { name: "Brown University", src: markBrown },
  { name: "Caltech", src: markCaltech },
  { name: "Harvard University", src: markHarvard },
  { name: "Cornell University", src: markCornell },
  { name: "Dartmouth College", src: markDartmouth },
  { name: "Duke University", src: markDuke },
  { name: "Stanford University", src: markStanford },
  { name: "Johns Hopkins University", src: markJhu },
  { name: "MIT", src: markMit },
  { name: "Northwestern University", src: markNorthwestern },
  { name: "Georgia Tech", src: markGeorgiaTech },
  { name: "Princeton University", src: markPrinceton },
  { name: "University of Michigan", src: markUmich },
  { name: "University of Pennsylvania", src: markUpenn },
  { name: "Purdue University", src: markPurdue },
  { name: "Yale University", src: markYale },
];

export function SchoolsMarquee() {
  return (
    <div className="lp-marquee-block">
      <p className="lp-marquee-label">
        Matched against 400+ schools, including
      </p>
      <div
        className="lp-marquee"
        role="img"
        aria-label="Logos of schools Acceptra matches against"
      >
        <div className="lp-marquee-track">
          {[0, 1, 2, 3].map((pass) =>
            TILES.map((tile) => (
              <span key={`${pass}-${tile.name}`} className="lp-tile">
                <img src={tile.src} alt="" loading="lazy" />
              </span>
            )),
          )}
        </div>
        <span className="lp-marquee-fade lp-marquee-fade-left" />
        <span className="lp-marquee-fade lp-marquee-fade-right" />
      </div>
    </div>
  );
}
