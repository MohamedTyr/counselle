import worldMap from "../assets/world-map.avif";
import avatarMaya from "../assets/avatar-maya.webp";
import avatarDaniel from "../assets/avatar-daniel.webp";
import avatarPriya from "../assets/avatar-priya.webp";
import "./testimonials.css";

const TESTIMONIALS = [
  {
    tone: "maya",
    quote:
      "“I paid a private counselor $8,000 for less than what the essay feedback alone gave me in ten minutes. I’d have killed for this junior year.”",
    name: "Maya Rodriguez",
    role: "Sophomore, University of Michigan",
    avatar: avatarMaya,
  },
  {
    tone: "daniel",
    quote:
      "“My school had one counselor for 500 kids. I typed /goal, said get me into Georgia Tech, and it built the list and deadlines I pieced together by hand for months.”",
    name: "Daniel Kim",
    role: "Junior, Georgia Tech",
    avatar: avatarDaniel,
  },
  {
    tone: "priya",
    quote:
      "“The line-by-line notes flagged every ‘due to the fact that’ in my old Common App essay, and never once tried to write my story for me. Wish I’d had it at 17.”",
    name: "Priya Shah",
    role: "Sophomore, Yale University",
    avatar: avatarPriya,
  },
];

export function Testimonials() {
  return (
    <section className="lp-testimonials" aria-labelledby="testimonials-heading">
      <div className="lp-world-map" aria-hidden="true">
        <img src={worldMap} alt="" loading="lazy" />
      </div>
      <h2
        className="lp-heading lp-testimonials-heading"
        id="testimonials-heading"
      >
        Students who tested it <br />
        wish they’d had it
      </h2>
      <ul className="lp-testimonial-cards">
        {TESTIMONIALS.map((t) => (
          <li
            key={t.name}
            className={`lp-testimonial-wrap lp-testimonial-wrap-${t.tone}`}
          >
            <figure className={`lp-testimonial lp-testimonial-${t.tone}`}>
              <blockquote>{t.quote}</blockquote>
              <figcaption className="lp-person">
                <img src={t.avatar} width={40} height={40} alt="" />
                <span className="lp-person-text">
                  <span className="lp-person-name">{t.name}</span>
                  <span className="lp-person-role">{t.role}</span>
                </span>
              </figcaption>
            </figure>
          </li>
        ))}
      </ul>
    </section>
  );
}
