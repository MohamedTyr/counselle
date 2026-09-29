import { useState } from "react";
import minus from "../assets/faq-minus.svg";
import plus from "../assets/faq-plus.svg";
import "./faq.css";

const QUESTIONS = [
  {
    q: "Does Acceptra write the essay for me?",
    a: "No. It reads what you wrote, marks it up line by line, and suggests changes you accept or reject. It never invents a detail about your life. When something is missing, it asks you, so every word stays yours.",
  },
  {
    q: "Where does the school data come from?",
    a: "From published admissions, cost and aid figures for each school, checked for changes every day. Nothing is estimated or made up, and a number we don’t have is shown as missing rather than guessed.",
  },
  {
    q: "Is there a real person, or only AI?",
    a: "Both. The workspace is AI, and paid plans include two 20-minute calls a month with a mentor who got in recently. When you email us, a person writes back.",
  },
  {
    q: "Is it allowed by schools and the Common App?",
    a: "It works alongside them. Acceptra never submits anything on your behalf, and every word of your essays stays yours to write, accept or reject.",
  },
  {
    q: "Does it replace our school counselors?",
    a: "No. It takes the repetitive work, like tracking dates and first-pass essay notes, so counselors spend their time on the students who need a person.",
  },
  {
    q: "What can a school counselor see?",
    a: "Progress, not private writing. Counselors see each student’s school list, deadlines and how far along their essays are. Essay text stays private until the student shares a draft.",
  },
  {
    q: "Can I cancel, and is there a free plan?",
    a: "Yes to both. The Free plan needs no card, Monthly can be cancelled any time, and Yearly is one payment that covers the whole admissions cycle.",
  },
];

export function Faq() {
  const [open, setOpen] = useState(0);
  const [pointerMotion, setPointerMotion] = useState(false);
  return (
    <section className="lp-faq" id="faq" aria-labelledby="faq-heading">
      <div className="lp-faq-intro">
        <h2 className="lp-heading lp-faq-heading" id="faq-heading">
          Questions families
          <br />
          and schools ask.
        </h2>
        <div className="lp-faq-support">
          <p>
            Still have a question? Email us
            <br />
            and a person writes back.
          </p>
          <a className="lp-faq-contact" href="mailto:hello@acceptra.ai">
            Contact us
          </a>
        </div>
      </div>
      <div className="lp-faq-list" data-pointer-motion={pointerMotion}>
        {QUESTIONS.map((item, index) => {
          const isOpen = index === open;
          return (
            <div key={item.q} className="lp-faq-item">
              <button
                type="button"
                className="lp-faq-toggle"
                aria-expanded={isOpen}
                aria-controls={`faq-answer-${index}`}
                onClick={(event) => {
                  setPointerMotion(event.detail > 0);
                  setOpen(isOpen ? -1 : index);
                }}
              >
                <span className="lp-faq-question">{item.q}</span>
                <img
                  className="lp-faq-plus"
                  src={plus}
                  width={24}
                  height={24}
                  alt=""
                />
                <img
                  className="lp-faq-minus"
                  src={minus}
                  width={24}
                  height={24}
                  alt=""
                />
              </button>
              <div className="lp-faq-answer-wrap" data-open={isOpen}>
                <p
                  className="lp-faq-answer"
                  id={`faq-answer-${index}`}
                  aria-hidden={!isOpen}
                  inert={!isOpen}
                >
                  {item.a}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
