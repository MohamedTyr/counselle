import { BRAND, CONTACT_EMAIL, DEFINITION, SITE_URL } from "./brand";
import { QUESTIONS } from "./sections/faqQuestions";
import { FEATURES } from "./sections/featureList";
import { PLANS } from "./sections/plans";

/** Who the page speaks to; only llms.txt lists them outright. */
const AUDIENCES = [
  "Students applying to US colleges",
  "Parents helping them",
  "School counselors, who see where each student stands",
  "School officials bringing AI college counseling to a high school",
];

const list = (items: string[]) => items.map((item) => `- ${item}`).join("\n");

/**
 * /llms.txt, written at build time from the same facts, features, plans and
 * FAQ the page renders, so an answer engine reads what a visitor reads.
 */
export function llmsText(): string {
  const plans = PLANS.map(
    ({ tier, amount, period, note, features }) =>
      `${tier}: $${amount} a ${period}. ${note} Includes: ${features.join("; ")}.`,
  );
  const faq = QUESTIONS.map(({ q, a }) => `### ${q}\n\n${a}`);
  return (
    [
      `# ${BRAND}`,
      `> ${DEFINITION}`,
      `${BRAND} opens soon. It is taking sign-ups on a waitlist: sign up at ${SITE_URL} (the Join waitlist button). Schools can book a walkthrough from the For schools section of the same page.`,
      "## Who it is for",
      list(AUDIENCES),
      "## What it does",
      list(FEATURES.map(({ title, blurb }) => `${title}: ${blurb}`)),
      "## Pricing",
      list(plans),
      "## FAQ",
      ...faq,
      "## Links",
      list([
        `[Home](${SITE_URL}/)`,
        `[Privacy Policy](${SITE_URL}/privacy)`,
        `[Terms of Service](${SITE_URL}/terms)`,
        `[Contact](mailto:${CONTACT_EMAIL})`,
      ]),
    ].join("\n\n") + "\n"
  );
}
