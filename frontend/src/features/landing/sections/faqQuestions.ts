import { DEFINITION, FOUNDERS, MENTOR_CALLS } from "../brand";

const founderNames = new Intl.ListFormat("en", { type: "conjunction" }).format(
  FOUNDERS.map((founder) => founder.name),
);

/** The questions the FAQ shows, and the FAQPage structured data repeats. */
export const QUESTIONS = [
  {
    q: "What is Acceptra?",
    a: `${DEFINITION} It opens soon. Join the waitlist to get in first.`,
  },
  {
    q: "Does Acceptra write the essay for me?",
    a: "No. It reads what you wrote, marks it up line by line, and suggests changes you accept or reject. It never invents a detail about your life. When something is missing, it asks you, so every word stays yours.",
  },
  {
    q: "Where does the school data come from?",
    a: "From published admissions, cost and aid figures for each school, checked for changes every day. Nothing is estimated or made up, and a number we don’t have is shown as missing rather than guessed.",
  },
  {
    q: "Is there a real person, or only AI?",
    a: `Both. The workspace is AI, and paid plans include ${MENTOR_CALLS.toLowerCase()} with someone who got in recently. When you email us, a person writes back.`,
  },
  {
    q: "Is it allowed by schools and the Common App?",
    a: "Applications must be the student’s own work, and Acceptra is built around that rule: it suggests but never writes. Every change to your essay is a suggestion you accept or reject, and it never submits anything on your behalf.",
  },
  {
    q: "Does it replace our school counselors?",
    a: "No. It takes the repetitive work, like tracking dates and first-pass essay notes, so counselors spend their time on the students who need a person.",
  },
  {
    q: "What can a school counselor see?",
    a: "Progress, not private writing. Counselors see each student’s school list, deadlines and how far along their essays are. Essay text stays private until the student shares a draft.",
  },
  {
    q: "Is my data sold or used for advertising?",
    a: "No. We do not sell your personal information, and we do not share it for advertising. Acceptra isn’t open yet; before it opens we will publish an updated privacy policy that covers accounts and essays, and email everyone on the waitlist.",
  },
  {
    q: "Can I cancel, and is there a free plan?",
    a: "Yes to both. The Free plan needs no card, Monthly can be cancelled any time, and Yearly is one payment that covers the whole admissions cycle.",
  },
  ...(FOUNDERS.length > 0
    ? [
        {
          q: "Who is behind Acceptra?",
          a: `Acceptra is built by ${founderNames}.`,
        },
      ]
    : []),
];
