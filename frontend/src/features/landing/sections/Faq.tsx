import { useState } from "react";
import minus from "../assets/faq-minus.svg";
import plus from "../assets/faq-plus.svg";
import { FAQ_AUDIENCES, QUESTIONS, type Audience } from "./faqQuestions";
import "./faq.css";

export function Faq() {
  const [audience, setAudience] = useState<Audience>("students");
  const [open, setOpen] = useState(0);
  const [pointerMotion, setPointerMotion] = useState(false);
  return (
    <section className="lp-faq" id="faq" aria-labelledby="faq-heading">
      <div className="lp-faq-intro">
        <h2 className="lp-heading lp-faq-heading" id="faq-heading">
          Questions families <br />
          and schools ask.
        </h2>
        <div className="lp-faq-support">
          <p>
            Still have a question? Email us <br />
            and a person writes back.
          </p>
          <a className="lp-faq-contact" href="mailto:hello@acceptra.ai">
            Contact us
          </a>
        </div>
      </div>
      <div className="lp-faq-list" data-pointer-motion={pointerMotion}>
        <div className="lp-faq-filter" role="group" aria-label="Questions for">
          {FAQ_AUDIENCES.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              aria-pressed={audience === id}
              onClick={() => {
                setAudience(id);
                setOpen(QUESTIONS.findIndex((item) => item.audience === id));
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Both groups stay in the HTML, so crawlers read every answer. */}
        {QUESTIONS.map((item, index) => {
          const isOpen = index === open;
          return (
            <div
              key={item.q}
              className="lp-faq-item"
              hidden={item.audience !== audience}
            >
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
