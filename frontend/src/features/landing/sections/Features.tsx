import "./features.css";
import { FeaturesStage } from "./FeaturesStage";

export function Features() {
  return (
    <section
      className="lp-features lp-features-stage"
      id="features"
      aria-labelledby="features-heading"
    >
      <div className="lp-features-header">
        <h2 className="lp-heading" id="features-heading">
          We do what a $10,000 counselor does, <br />
          and a few things they can’t.
        </h2>
        <p className="lp-features-copy">
          One workspace for essays, lists, deadlines, money, tests and
          activities. <br />
          The help families have paid thousands for, open to every student.
        </p>
      </div>
      <FeaturesStage />
    </section>
  );
}
