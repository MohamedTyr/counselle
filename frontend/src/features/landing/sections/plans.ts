import type { PlanId } from "../waitlist/contract";
import { MENTOR_CALLS } from "../brand";

/** The plans the pricing section shows, and the structured data offers. */
export type Plan = {
  id: PlanId;
  tier: string;
  /** US dollars per period. */
  amount: number;
  period: "month" | "year";
  note: string;
  features: string[];
};

export const PLANS: Plan[] = [
  {
    id: "free",
    tier: "Free",
    amount: 0,
    period: "month",
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
    amount: 20,
    period: "month",
    note: "Billed monthly. Cancel any time.",
    features: [
      "Unlimited questions",
      "Unlimited essay feedback",
      MENTOR_CALLS,
      "Deadlines, tasks and scholarships",
    ],
  },
  {
    id: "yearly",
    tier: "Yearly",
    amount: 99,
    period: "year",
    note: "Billed once. About $8 a month, less than five months of Monthly.",
    features: [
      "Everything in Monthly",
      "Junior spring through decision day",
      "Activities and summer programs",
      "One payment for the whole cycle",
    ],
  },
];
