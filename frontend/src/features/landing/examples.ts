export const landingExamples = [
  {
    id: "schools",
    label: "Find schools",
    question:
      "I want to study engineering, but cost is a big concern. Where should I start?",
    response:
      "Let’s build a shortlist around your budget, interests, and where you want to study.",
    title: "Your first three moves.",
    tasks: [
      "Set your yearly college budget",
      "Choose where you’d like to study",
      "Build your engineering shortlist",
    ],
    outcome: "Your first step is in the plan.",
  },
  {
    id: "essays",
    label: "Improve an essay",
    question:
      "My essay sounds like a list of achievements. How do I make it sound like me?",
    response:
      "Start with one moment that changed how you think. We’ll build your essay around it.",
    title: "Your story. In your voice.",
    tasks: [
      "Choose a moment that matters",
      "Write the scene in your own words",
      "Reflect on what changed for you",
    ],
    outcome: "Your writing plan is ready.",
  },
  {
    id: "week",
    label: "Plan my week",
    question:
      "I have school, essays, and applications. What should I actually work on this week?",
    response:
      "Let’s work back from your deadlines and make room for school, one step at a time.",
    title: "A little clearer. A lot closer.",
    tasks: [
      "Review upcoming application deadlines",
      "Make time for your essay draft",
      "Prepare questions for your recommender",
    ],
    outcome: "Your week has a starting point.",
  },
] as const;

export type LandingExample = (typeof landingExamples)[number];
