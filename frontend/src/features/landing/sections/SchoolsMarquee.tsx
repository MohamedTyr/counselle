import markBerkeley from "../assets/mark-berkeley.webp";
import markBrown from "../assets/mark-brown.webp";
import markCaltech from "../assets/mark-caltech.webp";
import markHarvard from "../assets/mark-harvard.webp";
import markCornell from "../assets/mark-cornell.webp";
import markDartmouth from "../assets/mark-dartmouth.webp";
import markDuke from "../assets/mark-duke.webp";
import markStanford from "../assets/mark-stanford.webp";
import markJhu from "../assets/mark-jhu.webp";
import markMit from "../assets/mark-mit.png";
import markNorthwestern from "../assets/mark-northwestern.webp";
import markGeorgiaTech from "../assets/mark-georgia-tech.webp";
import markPrinceton from "../assets/mark-princeton.webp";
import markUmich from "../assets/mark-umich.webp";
import markUpenn from "../assets/mark-upenn.webp";
import markPurdue from "../assets/mark-purdue.webp";
import markYale from "../assets/mark-yale.png";
import { SCHOOL_COUNT } from "../brand";
import "./marquee.css";

/** Every mark is exported 132px tall and drawn 36px tall. */
const SOURCE_HEIGHT = 132;
const MARK_HEIGHT = 36;

type Tile = { name: string; src: string; width: number };

/** Marks without their tile backgrounds; the marquee mutes their colour. */
const TILES: Tile[] = [
  { name: "UC Berkeley", src: markBerkeley, width: 111 },
  { name: "Brown University", src: markBrown, width: 132 },
  { name: "Caltech", src: markCaltech, width: 132 },
  { name: "Harvard University", src: markHarvard, width: 132 },
  { name: "Cornell University", src: markCornell, width: 132 },
  { name: "Dartmouth College", src: markDartmouth, width: 132 },
  { name: "Duke University", src: markDuke, width: 142 },
  { name: "Stanford University", src: markStanford, width: 132 },
  { name: "Johns Hopkins University", src: markJhu, width: 132 },
  { name: "MIT", src: markMit, width: 132 },
  { name: "Northwestern University", src: markNorthwestern, width: 138 },
  { name: "Georgia Tech", src: markGeorgiaTech, width: 132 },
  { name: "Princeton University", src: markPrinceton, width: 132 },
  { name: "University of Michigan", src: markUmich, width: 121 },
  { name: "University of Pennsylvania", src: markUpenn, width: 118 },
  { name: "Purdue University", src: markPurdue, width: 132 },
  { name: "Yale University", src: markYale, width: 131 },
];

const MARQUEE_LABEL = `Including ${new Intl.ListFormat("en", {
  type: "conjunction",
}).format(TILES.map((tile) => tile.name))}`;

export function SchoolsMarquee() {
  return (
    <div className="lp-marquee-block">
      <p className="lp-marquee-label">
        Matched against {SCHOOL_COUNT} schools, including
      </p>
      <div className="lp-marquee" role="img" aria-label={MARQUEE_LABEL}>
        <div className="lp-marquee-track">
          {[0, 1, 2, 3].map((pass) =>
            TILES.map((tile) => (
              <span key={`${pass}-${tile.name}`} className="lp-tile">
                <img
                  src={tile.src}
                  width={Math.round((tile.width * MARK_HEIGHT) / SOURCE_HEIGHT)}
                  height={MARK_HEIGHT}
                  alt=""
                  loading="lazy"
                />
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
