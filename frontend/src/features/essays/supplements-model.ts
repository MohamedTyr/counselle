import type {
  ApplicationSupplements,
  SupplementPrompt,
} from "@/api/workspace/types";

/* Prompts the student picks from: one group per `group_label`, in catalog order. */
export type SupplementChoice = {
  label: string;
  /* How many the student answers; null when the school allows any number. */
  count: number | null;
  optional: boolean;
  options: SupplementPrompt[];
  picked: number;
  wordLimit: number | null;
};

export type SchoolSupplementPlan = {
  /* Every applicant answers these; adding the school created them as essays. */
  required: SupplementPrompt[];
  choices: SupplementChoice[];
  optional: SupplementPrompt[];
  /* For some applicants only: a program, an honors college, a situation. */
  conditional: SupplementPrompt[];
};

export function planSupplements(
  supplements: ApplicationSupplements,
): SchoolSupplementPlan {
  const plan: SchoolSupplementPlan = {
    required: [],
    choices: [],
    optional: [],
    conditional: [],
  };
  const choices = new Map<string, SupplementChoice>();
  for (const prompt of supplements.prompts) {
    if (prompt.group_label) {
      let choice = choices.get(prompt.group_label);
      if (!choice) {
        choice = {
          label: prompt.group_label,
          count: prompt.choose_count,
          optional: prompt.requirement === "optional",
          options: [],
          picked: 0,
          wordLimit: prompt.word_limit,
        };
        choices.set(prompt.group_label, choice);
        plan.choices.push(choice);
      }
      choice.options.push(prompt);
      if (prompt.essay_id) choice.picked += 1;
      if (choice.wordLimit !== prompt.word_limit) choice.wordLimit = null;
    } else if (prompt.applies_to) {
      plan.conditional.push(prompt);
    } else if (prompt.requirement === "optional") {
      plan.optional.push(prompt);
    } else {
      plan.required.push(prompt);
    }
  }
  return plan;
}

/* "Pick 1 of 3" · "Pick up to 2 of 4" · "Pick any of 3", with the shared limit. */
export function choiceSummary(choice: SupplementChoice) {
  const total = choice.options.length;
  const pick =
    choice.count === null
      ? `Pick any of ${total}`
      : `Pick ${choice.count} of ${total}`;
  const parts = [choice.optional ? `Optional · ${pick.toLowerCase()}` : pick];
  if (choice.wordLimit) parts.push(`${choice.wordLimit} words each`);
  return parts.join(" · ");
}

export function choiceIsSettled(choice: SupplementChoice) {
  return choice.count !== null && choice.picked >= choice.count;
}

/* The one line that says where the prompts came from and how far to trust them. */
export function supplementSourceLine(supplements: ApplicationSupplements) {
  if (supplements.status === "unlisted") return null;
  if (supplements.checked === "common_app") return "Prompts checked against the Common App";
  if (supplements.checked === "official_site") return "Prompts checked against the school's site";
  return "Prompts from a public list · confirm them in your application";
}

export function wordLimitLabel(limit: number | null) {
  return limit ? `${limit} words` : "No word limit stated";
}
