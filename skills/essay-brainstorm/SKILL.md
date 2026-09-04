---
name: essay-brainstorm
description: Judgment procedure for finding a personal-statement topic when the student has none — run the Essence Objects and Core Values exercises as turn-taking interviews to surface the objects, moments, and values that carry the student's deepest story, then gut-test the candidate topic before any drafting. Use when a student says they don't know what to write about, or their current topic feels generic.
user_invokable: true
display_name: Essay brainstorm
user_description: Find your essay topic through guided exercises.
---

# Essay Brainstorm

Source: adapted from *College Essay Essentials* (Ethan Sawyer), Ch. 1. Load
`essay-honesty` before starting — every exercise below is an interview, and the
propose/assert line governs all of it.

## The hidden decision

"I don't know what to write about" is not a request for topic suggestions. It is
"I haven't yet surfaced the material that carries my deepest story." Handing the
student a topic fails twice: it fabricates (you don't know their life) and it
skips the discovery that makes the essay theirs. The deliverable is *their*
material, drawn out through structured interviews — content first, structure
later.

## The two core exercises (run as interviews)

### 1. Essence objects (~15 min of conversation)

Ask the student to imagine a box holding objects that each stand for something
essential about who they are — an object that is more than an object. The theory
(Eliot's objective correlative): a concrete object is a handle for emotion,
memory, and meaning that abstractions can't grip. Each object is a hyperlink to
something that matters.

Procedure:
- Model the *shape* of an answer first with one generic example pattern — an
  object, plus the relationship or quality it stands for (e.g., "a worn
  basketball, because it's how my dad and I connected"). Never model with
  invented details about *this* student.
- Ask for objects in batches of ~5 per turn, reacting between batches. The
  target is ~20 — push past the first easy handful; the later objects are
  usually the deeper ones. Meaning-explanations are optional; a bare list is
  fine.
- After the list: ask "looking at these, which sides of you are *missing*?" and
  collect 2–3 more.
- If the student stalls at any point, load `essay-exercises` and draw from the
  brainstorm question bank there — never fill the silence with your own guesses.

### 2. Core values funnel (~5 min)

Load `essay-values` for the value bank and its rules. Offer the bank as a menu
(a menu is legal; an assertion is not) and run the funnel:
top ten → top five → top three → the one most important value *today* (framing
matters: they're not losing the others, just naming today's #1).

Then the payoff question: "why is that your number one?" The answer is almost
always essay material. If the student has a career in mind, also ask which ~5
values a great person in that career embodies — the overlap and the gaps are
both material.

## Connecting the two (the theory the student doesn't need to hear)

Essence objects are the student's *world* — the past, the first half of an
essay. Core values are their *dreams and aspirations* — the present-future,
the second half. A career is not the end goal; it's the means by which they'll
express their values. Their values *are* their dreams and aspirations. This
mapping is why the two exercises together can answer nearly any
personal-statement prompt.

## Follow-up probes (after both exercises, pick 2–3)

- What's the toughest lesson you've ever had to learn?
- What's the hardest thing you've ever had to overcome?
- What's your actual superpower — when did you learn you had it, and how did
  you develop it?
- Finish this: "I wouldn't be who I am today without ___."
- If they have a career/major in mind: "Why are you a [future doctor/writer/…]?"
- Do any of these answers connect to any of your essence objects?

## The gut test (before declaring a topic found)

Topic selection is an art, not a science — there is no certainty. The test for
a deepest story: the student should *feel it in their gut*, and it should feel a
little vulnerable to tell. Counter-test: if the candidate topic, said aloud,
sounds like it could have been written by any number of people, it's probably
not their deepest story — keep digging. Say both tests to the student in plain
words and let *them* judge; you cannot feel their gut for them.

## Deductions and traps

- **Never propose the student's material.** Menus and question banks are yours
  to offer; objects, memories, and meanings are theirs to supply. A brainstorm
  where the agent contributed the content has failed even if the essay is good.
- **The first safe answer is rarely the deepest.** "Soccer" and "my mission
  trip" on the first pass are prompts for a follow-up ("what does that stand
  for that nothing else on your list does?"), not endpoints.
- **A topic is not automatically deep.** A dramatic event chosen for drama, or
  a quirky object with no value underneath it, fails the gut test the same way
  a cliché does.
- **Don't run the whole protocol in one message.** These are conversations;
  batch, react, adapt. A wall of 60 questions is a worksheet, not an interview.
- **Significant-challenge material may surface here.** If it does and the
  student wants to write about it, the safety gate lives in `essay-types` —
  apply it before committing to the topic.

## Final answer shape

1. The candidate topic/material, stated back in the student's own words and
   details — never embellished.
2. The core values it carries (named from the funnel, not guessed).
3. The gut-test verdict *asked, not assumed*: "does this one feel vulnerable
   and unmistakably yours?"
4. The handoff: the two type-picker questions, then `essay-drafting`.

## Exemplar shape

A student with "I guess soccer?" ends the interview with: a warm-up ritual
object that stands for steadiness, a grandmother's recipe card that stands for
inheritance, and #1 value "loyalty" — and chooses the recipe card because
saying it aloud made their voice catch. That catch is the deliverable. The
agent supplied questions and a menu; every noun came from the student.
