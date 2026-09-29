/** The plans the pricing section shows, and the structured data offers. */
export type Plan = {
  id: string;
  tier: string;
  price: string;
  period: string;
  note: string;
  features: string[];
};

export const PLANS: Plan[] = [
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
