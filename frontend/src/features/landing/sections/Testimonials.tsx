import worldMap from "../assets/world-map.avif";
import worldMapSmall from "../assets/world-map-1040.avif";
import avatarYusuf from "../assets/avatar-yusuf.webp";
import avatarOmar from "../assets/avatar-omar.webp";
import avatarMohamed from "../assets/avatar-mohamed.webp";
import "./testimonials.css";

const TESTIMONIALS = [
  {
    tone: "yusuf",
    quote:
      "“An always-available counselor that can answer anything is the most useful part. My school’s counselor can’t even answer generally, let alone at any time! And essays get evaluated with real nuance, through an experienced lens.”",
    name: "Yusuf Nassar",
    role: "Freshman, Vanderbilt University",
    avatar: avatarYusuf,
  },
  {
    tone: "omar",
    quote:
      "“Acceptra is free and better than very expensive counseling services. I really enjoyed seeing it recommend which colleges fit my preferences based on my profile, and getting detailed feedback.”",
    name: "Omar Ibrahim",
    role: "Junior, New York University",
    avatar: avatarOmar,
  },
  {
    tone: "mohamed",
    quote:
      "“As an international applicant, nobody around me knew how US admissions actually worked. It explained aid, deadlines and fit for every school on my list, and always told me why, not just what.”",
    name: "Mohamed Abdelhamid",
    role: "Junior, Minerva University",
    avatar: avatarMohamed,
  },
];

export function Testimonials() {
  return (
    <section className="lp-testimonials" aria-labelledby="testimonials-heading">
      <div className="lp-world-map" aria-hidden="true">
        <img
          src={worldMap}
          srcSet={`${worldMapSmall} 1040w, ${worldMap} 2080w`}
          sizes="(max-width: 1039px) 100vw, 1040px"
          alt=""
          loading="lazy"
        />
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
