import logoUmich from "../assets/essay-logo-umich.png";
import "./essay-card.css";

const NOTES = [
  {
    tone: "strength",
    top: 56,
    label: "Strength",
    body: "Real numbers make this believable.",
  },
  {
    tone: "suggestion",
    top: 114,
    label: "Suggestion",
    body: "Too general. Say what you’d study.",
  },
  {
    tone: "tighten",
    top: 172,
    label: "Tighten",
    body: 'Replace with "because".',
  },
];

export function EssaySheet() {
  return (
    <div className="lp-sheet lp-sheet-wide lp-essay-sheet" aria-hidden="true">
      <div className="lp-essay-header">
        <img src={logoUmich} width={18} height={18} alt="" />
        <span className="lp-essay-school">University of Michigan</span>
        <span className="lp-essay-prompt">Why us? | 250 words</span>
      </div>
      <div className="lp-essay">
        <div className="lp-essay-line">
          I spent the summer before junior year counting birds at 5 a.m. for
        </div>
        <div className="lp-essay-line">
          a county survey. <i className="lp-space" />
          <mark className="lp-hl lp-hl-g">
            <span className="lp-hl-background" />
            By August I had logged 1,140 sightings and
          </mark>
        </div>
        <div className="lp-essay-line">
          <mark className="lp-hl lp-hl-g">
            <span className="lp-hl-background" />
            built a spreadsheet that flagged a drop in barn swallows.
          </mark>{" "}
          That
        </div>
        <div className="lp-essay-line">
          work made me <i className="lp-space" />
          <s className="lp-essay-strike">definately</s>
          <i className="lp-space" />
          <b className="lp-essay-fix">definitely</b> sure of one thing.{" "}
          <i className="lp-space" />
          <mark className="lp-hl lp-hl-v">
            <span className="lp-hl-background" />I am passionate
          </mark>
        </div>
        <div className="lp-essay-line">
          <mark className="lp-hl lp-hl-v">
            <span className="lp-hl-background" />
            about science and want to make a difference in the world.
          </mark>
        </div>
        <div className="lp-essay-line">
          At Michigan I would pair ecology with statistics,{" "}
          <i className="lp-space" />
          <mark className="lp-hl lp-hl-a">
            <span className="lp-hl-background" />
            due to the fact that
          </mark>
        </div>
        <div className="lp-essay-line">
          the Program in the Environment lets me study both at once.
        </div>
        <div className="lp-essay-line">
          I want four years of turning early mornings into evidence.
        </div>
      </div>
      <span className="lp-essay-margin" />
      <div className="lp-notes-heading">
        <span>6 notes</span>
        <span className="lp-notes-counts">
          <span className="lp-count lp-count-strength">2</span>
          <span className="lp-count lp-count-suggestion">3</span>
          <span className="lp-count lp-count-tighten">1</span>
        </span>
      </div>
      {NOTES.map((note) => (
        <div
          key={note.label}
          className={`lp-note lp-note-${note.tone}`}
          style={{ top: note.top }}
        >
          <span className="lp-note-label">{note.label}</span>
          <span className="lp-note-body">{note.body}</span>
        </div>
      ))}
      <span className="lp-fade lp-essay-fade" />
    </div>
  );
}
