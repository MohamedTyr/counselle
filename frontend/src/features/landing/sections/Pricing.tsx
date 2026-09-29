import check from "../assets/plan-check-circle.svg";
import { PLANS, type Plan } from "./plans";
import "./pricing.css";

function PlanCard({ plan }: { plan: Plan }) {
  return (
    <div className={`lp-plan lp-plan-${plan.id}`}>
      <div className="lp-plan-top">
        <h3 className="lp-plan-tier">{plan.tier}</h3>
        <p className="lp-plan-price-row">
          <span className="lp-plan-price">{plan.price}</span>
          <span className="lp-plan-period">{plan.period}</span>
        </p>
        <p className="lp-plan-note">{plan.note}</p>
        <a
          className="lp-plan-button"
          href="#waitlist"
          data-waitlist-source="plan"
          data-waitlist-plan={plan.id}
        >
          Join waitlist
        </a>
      </div>
      <ul className="lp-plan-features">
        {plan.features.map((feature) => (
          <li key={feature}>
            <img src={check} width={18} height={18} alt="" />
            {feature}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Pricing() {
  return (
    <section
      className="lp-pricing"
      id="pricing"
      aria-labelledby="pricing-heading"
    >
      <h2 className="lp-heading" id="pricing-heading">
        Drop the consultants, keep the results
      </h2>
      <div className="lp-plans">
        {PLANS.map((plan) => (
          <PlanCard key={plan.id} plan={plan} />
        ))}
      </div>
    </section>
  );
}
