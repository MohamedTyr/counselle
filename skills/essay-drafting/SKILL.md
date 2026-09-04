---
name: essay-drafting
description: Judgment procedure for getting from material to a complete first draft — run the two-question type picker, pair the type with a structure, protect drafting momentum, and route the draft through the student's own words under the honesty rules. Use when a student has a topic or brainstorm output and wants to write the essay, or has a blank page and a deadline.
user_invokable: true
display_name: Essay drafting
user_description: Turn your material into a full essay draft.
---

# Essay Drafting

Source: adapted from *College Essay Essentials* (Ethan Sawyer), Chs. 3–4. Load
`essay-honesty` before anything else and run its intake — which essay, which
prompt, word limit, deadline — since everything below assumes a full-length
personal statement; a short supplement or UC PIQ wants directness, one
moment, and an explicit answer, not this machinery. Drafting is where
fabrication and voice damage happen; the propose/assert line governs every
sentence produced here.

## The hidden decision

"Help me write my essay" is not a request for you to produce prose. It is
"help me choose a path, shape my material, and get a complete draft down while
it's alive." The two failure modes are opposite: an agent that writes the essay
*for* the student (fabricated, voiceless, and useless to them), and an agent
that theorizes forever while the student never drafts. The deliverable is a
finished first draft, mostly in the student's words, produced fast.

## Step 1 — the type picker (two questions)

Ask, in the student's own terms:

1. **Have you faced significant challenges in your life?** (They decide what
   counts — never you.)
2. **Do you know what you want to be or study in the future?**

Yes/yes → Type A. No/yes → Type B. Yes/no → Type C. No/no → Type D. Then load
`essay-types` and run that type's interview. Two permissions to state whenever
relevant: having challenges doesn't oblige writing about them, and knowing a
career doesn't oblige featuring it (though challenges yield rich material and
a known career can shape a strong ending). The types are paths, not
personality categories — combining elements is legal, and if a heavy topic
comes up, the safety gate in `essay-types` runs before anything is committed.

If the student arrives with no material at all, detour to `essay-brainstorm`
first; the picker means little with an empty box.

## Step 2 — pair a structure

Tendency, not law: narrative for A/C, montage (with a focusing lens) for B/D.
Load `essay-structure` when outlining. A student mid-draft never needs the
taxonomy retrofitted — identify what shape the draft is already reaching for
and strengthen it.

## Step 3 — protect momentum

- **Draft within 24 hours of the brainstorm/interview.** The associations that
  make material feel alive fade like a dream; the worst plan is "great session,
  draft next week."
- **Just start.** A bad first draft is the goal; polish is `essay-revision`'s
  job. Never let outline perfectionism block the first sentence. Type D is the
  one exception where patience is the virtue — say so there (many drafts and
  restarts are normal), but even Type D starts by drafting *something*.
- **Word budgets are proportional guides, never rules.** For a 650-word
  statement: challenge material at most the first half; the response and the
  learning deserve the rest. Don't police exact counts on a first draft.

**Emergency path (one night, real steps).** Deadline truly tomorrow? Compress
to a values-first modified Type B: (1) a fast content sprint (essence objects
or the banks in `essay-exercises`); (2) the student names their 4–5 most
important values; (3) for each value, one concrete image from their life that
*shows* it — snapshots, movie scenes; (4) order the images (chronological
often works) and have them draft a brief paragraph per image **without naming
the values yet**; (5) transitions last — placeholder phrases are fine
tonight; (6) end by naming the values they'll carry into college regardless
of career; with any time left, add a so-what after each. Attach the honest
warning: a one-night essay is a starting point that still needs a real
revision pass — and a heavy challenge topic should not be attempted this way
at all (no time for the distance the safety gate requires).

## Step 4 — who writes the words (the mechanics)

- **The student's words are the default.** Your moves: interview, outline
  together, ask for a paragraph, react to it, propose *candidate* phrasings of
  things the student actually said, and mark gaps as placeholders
  (`[the detail about your brother here]`) rather than inventing content.
- **`write_essay` is for an empty essay only** (or a full redraft the student
  explicitly asked for), and what it writes is a *scaffold* under the bounds
  in `essay-honesty`: the student's own interview sentences arranged in
  order, plus labels and placeholders — no connective prose in your register,
  never submittable as-is, always ending with "now say each of these in your
  own words and rewrite from that."
- Once an essay has the student's words in it, changes go through
  `edit_essay` — small, targeted, independent, each announced
  (`essay-revision` carries the rules) — after a fresh `read_essay`.
- **Every fact in the draft traces to something the student told you.** No
  atmosphere, no invented sensory detail, no "improved" chronology. If a
  scene needs a detail you don't have, ask for it.

## Scope border

This skill covers the **personal statement** and standalone essays, including
creative or open-ended supplements (design-your-own-prompt, "what else should
we know?") — those draft here with `essay-craft`, and `essay-advanced`'s
make-it-new technique is available for them from the start. Hand off to
`essay-fit` only when the prompt asks about **the school itself** — why-us,
community, how-you'll-contribute — since that discipline is real named campus
specifics discovered by search; a quirky prompt that merely names a school
stays here. Activity descriptions and short answers can use the interviews
here, at supplement scale.

## Deductions and traps

- **Producing polished prose from thin interviews is the cardinal failure.**
  If the material is thin, the fix is more interview (or `essay-exercises`),
  never more eloquence.
- **Don't ghostwrite an ending insight.** The "so what" must come from the
  student; you may ask the so-what question repeatedly (`essay-types`, Type B)
  but not answer it for them.
- **Don't stall the draft to perfect the outline.** Structure diagnosis is a
  revision activity too; a flawed complete draft beats a perfect fragment.
- **Don't let the picker become a gate.** A student who resists both questions
  can still write — default them into Type D's open search rather than forcing
  a disclosure they don't want to make.

## Final answer shape

At the end of a drafting engagement the student has: (1) their type and
structure, named in one line each; (2) a complete draft — theirs, or a
scaffold from their own words if the page was empty — with placeholders where
material is missing; (3) the immediate next step ("fill these two
placeholders, then we run the essay test in `essay-revision`").

## Exemplar shape

A student with brainstorm output and "I want to do engineering, no big
challenges": picker → Type B; the write-backward interview produces five
values (two unusual: beauty, fun) each with a real moment; the student drafts
three paragraphs live in chat, the agent proposes a candidate transition built
from the student's own phrasing, marks one placeholder for a missing detail,
and books the 24-hour follow-up to run the essay test on the finished draft.
