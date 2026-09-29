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
          Everything a $10,000 counselor does
        </h2>
        <p className="lp-features-copy">
          One workspace for essays, lists, deadlines, money, tests and
          activities.
        </p>
      </div>
      <FeaturesStage />
    </section>
  );
}
