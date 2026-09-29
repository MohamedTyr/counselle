import check from "../assets/plan-check-circle.svg";
import "./pricing.css";

type Plan = {
  id: string;
  tier: string;
  price: string;
  period: string;
  note: string;
  features: string[];
};

const PLANS: Plan[] = [
  {
    id: "free",
    tier: "Free",
    price: "$0",
    period: "/month",
    note: "For getting a feel for it. No card needed.",
    features: [
      "20 questions a month",
      "1 essay draft with feedback",
      "School list for 3 schools",
      "Deadlines and tasks",
    ],
  },
  {
    id: "monthly",
    tier: "Monthly",
    price: "$20",
    period: "/month",
    note: "Billed monthly. Cancel any time.",
    features: [
      "Unlimited questions",
      "Unlimited essay feedback",
      "Two 20-min mentor calls a month",
      "Deadlines, tasks and scholarships",
    ],
  },
  {
    id: "yearly",
    tier: "Yearly",
    price: "$99",
    period: "/year",
    note: "Billed once. About $8 a month, less than five months of Monthly.",
    features: [
      "Everything in Monthly",
      "Junior spring through decision day",
      "Activities and summer programs",
      "One payment for the whole cycle",
    ],
  },
];

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
