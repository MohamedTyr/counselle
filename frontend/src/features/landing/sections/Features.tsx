import "./features.css";
import { EssayCard } from "../cards/EssayCard";
import { CollegesCard } from "../cards/CollegesCard";
import { ScholarshipsCard } from "../cards/ScholarshipsCard";
import { ActivitiesCard } from "../cards/ActivitiesCard";
import { SatCard } from "../cards/SatCard";
import { DeadlinesCard } from "../cards/DeadlinesCard";
import { FeaturesBento } from "./FeaturesBento";
import { FeaturesCanvas } from "./FeaturesCanvas";
import { FeaturesStage } from "./FeaturesStage";

/** The Figma design: six saturated cards, text beside each illustration. */
function FeaturesCards() {
  return (
    <div className="lp-cards">
      <EssayCard />
      <div className="lp-card-row">
        <CollegesCard />
        <ScholarshipsCard />
        <ActivitiesCard />
      </div>
      <SatCard />
      <DeadlinesCard />
    </div>
  );
}

/**
 * Candidate layouts for the showcase, picked with `?features=<name>` while
 * comparing designs. The approved stage is the default; explicit preview
 * URLs keep the alternatives available without a picker over the live page.
 */
const VARIANTS = {
  cards: FeaturesCards,
  bento: FeaturesBento,
  canvas: FeaturesCanvas,
  stage: FeaturesStage,
} as const;
type Variant = keyof typeof VARIANTS;
const DEFAULT_VARIANT: Variant = "stage";

function readVariant(): Variant {
  const requested = new URLSearchParams(window.location.search).get("features");
  return requested && Object.hasOwn(VARIANTS, requested)
    ? (requested as Variant)
    : DEFAULT_VARIANT;
}

export function Features() {
  const variant = readVariant();
  const Body = VARIANTS[variant];
  return (
    <section
      className={`lp-features lp-features-${variant}`}
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
      <Body />
    </section>
  );
}
