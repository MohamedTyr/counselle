import umich from "../assets/row-logo-umich.png";
import georgiaTech from "../assets/row-logo-georgia-tech.webp";
import stanford from "../assets/row-logo-stanford.webp";
import mit from "../assets/tile-mit.png";
import rsi from "../assets/activity-logo-rsi.webp";
import regeneron from "../assets/activity-logo-regeneron.webp";
import mites from "../assets/activity-logo-mites.webp";
import usaco from "../assets/activity-logo-usaco.webp";
import ring91 from "../assets/ring-91.svg";
import ring88 from "../assets/ring-88.svg";
import ring64 from "../assets/ring-64.svg";
import ring58 from "../assets/ring-58.svg";
import tick from "../assets/tick.svg";
import "./hero-cards.css";

const TASKS = [
  { label: "Cut essay to 650 words", done: true },
  { label: "Finish Why Michigan", done: false },
  { label: "Trim activities list", done: false },
];

const MATCHES = [
  {
    name: "Georgia Tech",
    logo: georgiaTech,
    tier: "Target",
    ring: ring91,
    fit: "91%",
  },
  {
    name: "University of Michigan",
    logo: umich,
    tier: "Target",
    ring: ring88,
    fit: "88%",
  },
  {
    name: "Stanford University",
    logo: stanford,
    tier: "Reach",
    ring: ring64,
    fit: "64%",
  },
  {
    name: "MIT",
    logo: mit,
    tier: "Reach",
    ring: ring58,
    fit: "58%",
    cover: true,
  },
];

const SCHOLARSHIPS = [
  { name: "Coca-Cola Scholars", amount: "$20,000" },
  { name: "Elks Most Valuable Student" },
  { name: "Udall Scholarship", amount: "$7,000" },
  { name: "Horatio Alger National" },
  { name: "Brower Youth Award", amount: "$3,000" },
  { name: "Jack Kent Cooke College" },
  { name: "Burger King Scholars" },
];

const ACTIVITIES = [
  { name: "Research Science Institute", logo: rsi },
  { name: "Regeneron Science Talent Search", logo: regeneron, picked: true },
  { name: "MITES Summer", logo: mites },
  { name: "USA Computing Olympiad", logo: usaco },
];

function TasksCard() {
  return (
    <div className="lp-hc lp-hc-tasks">
      <div className="lp-hc-head lp-hc-tasks-head">
        <p className="lp-hc-title lp-hc-title-small">Tasks &amp; deadlines</p>
      </div>
      {TASKS.map(({ label, done }) => (
        <div key={label} className="lp-hc-task" data-done={done}>
          <span className="lp-hc-checkbox" />
          <p>{label}</p>
        </div>
      ))}
      <p className="lp-hc-chip">Nov 1 · Michigan EA</p>
    </div>
  );
}

function EssayCard() {
  return (
    <div className="lp-hc lp-hc-essay">
      <div className="lp-hc-head">
        <p className="lp-hc-title lp-hc-title-large">Essay feedback</p>
        <div className="lp-hc-notes">
          <p>6 notes</p>
          <div className="lp-hc-counts">
            <span className="lp-hc-count-strength">2</span>
            <span className="lp-hc-count-suggestion">3</span>
            <span className="lp-hc-count-tighten">1</span>
          </div>
        </div>
      </div>
      <div className="lp-hc-essay-meta">
        <img src={umich} width={16} height={16} alt="" />
        <p className="lp-hc-essay-school">University of Michigan</p>
        <p>Why us? · 250 words</p>
      </div>
      <div className="lp-hc-essay-body">
        <p>
          <span>I spent the summer counting birds at 5 a.m. for a county</span>
        </p>
        <p className="lp-hc-essay-fix">
          <span>survey. It made me</span>
          <s>definately</s>
          <ins>definitely</ins>
          <span>sure of one thing.</span>
        </p>
        <p>
          <mark className="lp-hc-strength">
            By August I had logged 1,140 sightings and tracked a drop
          </mark>
        </p>
        <p className="lp-hc-essay-spaced">
          <mark className="lp-hc-strength">in barn swallows.</mark>
          <span> </span>
          <mark className="lp-hc-suggestion">
            I am passionate about science and want
          </mark>
        </p>
        <p>
          <mark className="lp-hc-suggestion">to make a difference.</mark>
          <span>{" At Michigan I would pair ecology with"}</span>
        </p>
        <p>
          <span>{"statistics, "}</span>
          <mark className="lp-hc-tighten">due to the fact that</mark>
          <span>{" the Program in the Environment"}</span>
        </p>
        <p>
          <span>lets me study both at once.</span>
        </p>
      </div>
    </div>
  );
}

function MatchesCard() {
  return (
    <div className="lp-hc lp-hc-matches">
      <div className="lp-hc-head">
        <p className="lp-hc-title">College matches</p>
        <p className="lp-hc-badge">12 schools</p>
      </div>
      <div className="lp-hc-match-list">
        {MATCHES.map(({ name, logo, tier, ring, fit, cover }) => (
          <div key={name} className="lp-hc-match">
            <span className="lp-hc-logo lp-hc-logo-school" data-cover={cover}>
              <img src={logo} width={32} height={32} alt="" />
            </span>
            <div className="lp-hc-match-name">
              <p>{name}</p>
              <p className="lp-hc-tier" data-tier={tier}>
                {tier}
              </p>
            </div>
            <div className="lp-hc-match-fit">
              <img src={ring} width={18} height={18} alt="" />
              <p>{fit}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SatCard() {
  return (
    <div className="lp-hc lp-hc-sat">
      <div className="lp-hc-head lp-hc-sat-head">
        <p className="lp-hc-title lp-hc-title-sat">SAT practice</p>
        <p className="lp-hc-chip">Math</p>
      </div>
      <p className="lp-hc-sat-question">If 3x + 7 = 25, find 6x − 5.</p>
      <div className="lp-hc-answer" data-correct="true">
        <p className="lp-hc-answer-letter">B</p>
        <p className="lp-hc-answer-value">31</p>
        <p className="lp-hc-answer-note">Correct</p>
      </div>
      <div className="lp-hc-answer" data-correct="false">
        <p className="lp-hc-answer-letter">C</p>
        <p className="lp-hc-answer-value">36</p>
        <p className="lp-hc-answer-note">Your answer</p>
      </div>
      <p className="lp-hc-sat-explain">
        You found 6x = 36. <br />
        Subtract 5 to get 31.
      </p>
      <p className="lp-hc-chip">Ask Acceptra</p>
    </div>
  );
}

function ScholarshipsCard() {
  return (
    <div className="lp-hc lp-hc-scholarships">
      <div className="lp-hc-head">
        <p className="lp-hc-title">Scholarship matches</p>
        <p className="lp-hc-badge lp-hc-badge-rose">$30,000</p>
      </div>
      <div className="lp-hc-stream">
        {SCHOLARSHIPS.map(({ name, amount }) => (
          <div
            key={name}
            className="lp-hc-award"
            data-matched={Boolean(amount)}
          >
            {amount ? (
              <img src={tick} width={10} height={10} alt="" />
            ) : (
              <span className="lp-hc-award-space" />
            )}
            <p className="lp-hc-award-name">{name}</p>
            {amount && <p>{amount}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

function ActivitiesCard() {
  return (
    <div className="lp-hc lp-hc-activities">
      <div className="lp-hc-head">
        <p className="lp-hc-title">Activities for you</p>
      </div>
      <div className="lp-hc-filters">
        <p data-active="true">For you</p>
        <p>Research</p>
        <p>Competitions</p>
      </div>
      <div className="lp-hc-stream">
        {ACTIVITIES.map(({ name, logo, picked }) => (
          <div key={name} className="lp-hc-activity" data-picked={picked}>
            <span className="lp-hc-logo lp-hc-logo-activity" data-cover="true">
              <img src={logo} width={26} height={26} alt="" />
            </span>
            <p className="lp-hc-activity-name">{name}</p>
            {picked ? (
              <p className="lp-hc-add">
                <span>+</span>
                <span>Add</span>
              </p>
            ) : (
              <p className="lp-hc-free">Free</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The workspace at a glance: static illustrations, stacked in paint order. */
export function HeroCards() {
  return (
    <div className="lp-hero-cards" aria-hidden="true" data-nosnippet>
      <div className="lp-hc-slot lp-hc-slot-tasks">
        <TasksCard />
      </div>
      <div className="lp-hc-slot lp-hc-slot-essay">
        <EssayCard />
      </div>
      <div className="lp-hc-slot lp-hc-slot-matches">
        <MatchesCard />
      </div>
      <div className="lp-hc-slot lp-hc-slot-sat">
        <SatCard />
      </div>
      <div className="lp-hc-slot lp-hc-slot-scholarships">
        <ScholarshipsCard />
      </div>
      <div className="lp-hc-slot lp-hc-slot-activities">
        <ActivitiesCard />
      </div>
    </div>
  );
}
