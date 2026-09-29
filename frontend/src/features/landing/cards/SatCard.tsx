import bookmark from "../assets/bookmark.svg";
import check from "../assets/sat-check.svg";
import cross from "../assets/sat-x.svg";
import sparkle from "../assets/sparkle.svg";
import send from "../assets/sat-send.svg";
import "./sat-card.css";

export function SatSheet() {
  return (
    <div className="lp-sheet lp-sheet-wide lp-sat-sheet" aria-hidden="true">
      <div className="lp-question">
        <div className="lp-question-strap">
          <span className="lp-question-number">12</span>
          <img src={bookmark} width={14} height={14} alt="" />
          <span className="lp-question-review">Mark for review</span>
          <span className="lp-question-eliminate">ABC</span>
        </div>
        <p className="lp-question-text">
          If 3x + 7 = 25, what is the value of 6x − 5?
        </p>
        <div className="lp-choices">
          <div className="lp-choice lp-choice-dim">
            <span className="lp-choice-letter">A</span>
            <s>13</s>
          </div>
          <div className="lp-choice lp-choice-correct">
            <span className="lp-choice-letter">B</span>
            <span>31</span>
            <span className="lp-choice-verdict">
              <img src={check} width={14} height={14} alt="" />
              Correct
            </span>
          </div>
          <div className="lp-choice lp-choice-wrong">
            <span className="lp-choice-letter">C</span>
            <span>36</span>
            <span className="lp-choice-verdict">
              <img src={cross} width={14} height={14} alt="" />
              Your answer
            </span>
          </div>
          <div className="lp-choice">
            <span className="lp-choice-letter">D</span>
            <span>41</span>
          </div>
        </div>
      </div>
      <span className="lp-sat-divider" />
      <div className="lp-ask">
        <div className="lp-ask-header">
          <img src={sparkle} width={14} height={14} alt="" />
          <span>Ask Acceptra</span>
        </div>
        <div className="lp-ask-conversation">
          <div className="lp-ask-user-row">
            <span className="lp-ask-bubble">Why is 36 wrong?</span>
          </div>
          <div className="lp-ask-answer-slot">
            <span className="lp-ask-typing">
              <i />
              <i />
              <i />
            </span>
            <p className="lp-ask-answer">
              You solved for x = 6 and found 6x = 36, then stopped. The question
              asks for 6x − 5, so subtract 5 to get 31.
            </p>
          </div>
        </div>
        <div className="lp-ask-composer">
          <span>Ask a follow-up</span>
          <span className="lp-ask-send">
            <img src={send} width={13} height={13} alt="" />
          </span>
        </div>
      </div>
      <span className="lp-fade lp-sat-fade" />
    </div>
  );
}
