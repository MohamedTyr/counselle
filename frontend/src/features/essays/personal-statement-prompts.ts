/**
 * The seven Common Application first-year personal statement prompts.
 *
 * Source: https://www.commonapp.org/apply/essay-prompts/
 * Cycle: "Here is the full set of essay prompts for 2026–2027" (see `CYCLE`).
 * Verified: 2026-09-01, by loading the live page in a browser and comparing
 * its rendered text against the strings below character-for-character —
 * including apostrophe style. The source renders straight apostrophes
 * (U+0027 / charCode 39), confirmed by measuring the apostrophe in prompt
 * 7's "you've" — do not "smarten" them to U+2019.
 *
 * Common App has revised these prompts before (most recently for the
 * 2025–2026 cycle) and will again. Re-verify against the source URL before
 * reusing this file for a new cycle.
 *
 * WORD LIMIT — deliberately not included. The prompts page itself states no
 * word count for the personal essay. A 2026-09-01 search of the Common App
 * help center (appsupport.commonapp.org) — the "Word Count", "Is there a
 * specific word count for the essay?", "What is the min/max word count for
 * the essays on the Questions page or Writing Supplement?", and "Is the
 * Personal Essay required?" articles — plus both the 2025–2026 and current
 * 2026–2027 official prompt-announcement blog posts, turned up no stated
 * limit for the personal essay itself. The commonly assumed "650 words"
 * could not be confirmed against a primary Common App source: the
 * 2025–2026 announcement post uses "650" only for a *different* field (the
 * "Additional information" question, since reduced to 300 words) — exactly
 * the kind of mix-up that makes guessing unsafe here. Per the house honesty
 * rule (AGENTS.md — never lie to a student about a number), essays created
 * from these prompts get `word_limit: null` and the dialog shows no word
 * count caption until this is confirmed from an official source and this
 * comment is updated with that source and date.
 */

export const CYCLE = "2026-2027";

export interface PersonalStatementPrompt {
  id: string;
  ordinal: number;
  text: string;
}

export const PERSONAL_STATEMENT_PROMPTS: PersonalStatementPrompt[] = [
  {
    id: "background-identity-interest-talent",
    ordinal: 1,
    text: "Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. If this sounds like you, then please share your story.",
  },
  {
    id: "obstacle-challenge-setback-failure",
    ordinal: 2,
    text: "The lessons we take from obstacles we encounter can be fundamental to later success. Recount a time when you faced a challenge, setback, or failure. How did it affect you, and what did you learn from the experience?",
  },
  {
    id: "questioned-challenged-belief-idea",
    ordinal: 3,
    text: "Reflect on a time when you questioned or challenged a belief or idea. What prompted your thinking? What was the outcome?",
  },
  {
    id: "gratitude-surprising-happy-thankful",
    ordinal: 4,
    text: "Reflect on something that someone has done for you that has made you happy or thankful in a surprising way. How has this gratitude affected or motivated you?",
  },
  {
    id: "accomplishment-event-personal-growth",
    ordinal: 5,
    text: "Discuss an accomplishment, event, or realization that sparked a period of personal growth and a new understanding of yourself or others.",
  },
  {
    id: "engaging-topic-idea-concept",
    ordinal: 6,
    text: "Describe a topic, idea, or concept you find so engaging that it makes you lose all track of time. Why does it captivate you? What or who do you turn to when you want to learn more?",
  },
  {
    id: "topic-of-your-choice",
    ordinal: 7,
    text: "Share an essay on any topic of your choice. It can be one you've already written, one that responds to a different prompt, or one of your own design.",
  },
];
