---
name: essay-revision
description: Craft procedure for improving a draft that already exists — diagnose the one thing wrong before touching a word, cut the warm-up opening and the lesson-learned ending, rebuild a middle that summarizes instead of shows, cut to a word limit by removing whole sentences rather than compressing, and make small independent edits anchored in the draft's current text. Use when a student has a draft and wants it tightened, shortened, restructured, or made better.
user_invokable: true
display_name: Essay revision
user_description: Tighten, cut, restructure, and strengthen a draft you already have.
---

# Essay Revision

## The hidden decision

"Can you make this better?" is always a more specific problem underneath. It is
usually one of: it's over the word limit; the opening takes too long; the middle
sags; the ending explains instead of lands; it doesn't sound like me; or I can't
tell whether it's any good. Work out which before you touch a word — a draft
edited on every axis at once comes back unrecognizable, and the student loses the
ability to judge their own essay.

Read the whole draft first, then name the single biggest problem in one sentence.
If it's the last one — they can't tell if it's good — the answer is not
reassurance; it's pointing at the one line that isn't doing what they want and
asking about it.

## Where drafts actually go wrong

These account for most of them, roughly in order of frequency:

- **The warm-up opening.** Writers clear their throat. The real first sentence is
  usually the first concrete one, often halfway down paragraph one or at the top
  of paragraph two. Cutting up to it costs nothing and buys 60 words.
- **The lesson-learned ending.** "Through this experience, I learned that
  perseverance…" restates what the essay already showed, and it takes the
  conclusion away from the reader, who was enjoying reaching it. Cut the moral.
  End on the last concrete image, or on an action that continues.
- **The sagging middle.** A middle sags when the writer stops showing and starts
  narrating time passing — "over the next few months, I worked hard and slowly
  improved." That's a summary standing where a scene belongs. The fix is one
  specific moment from those months, which usually means asking for it.
- **Abstractions doing a scene's job.** Passion, journey, growth, impact,
  resilience. Each one is a placeholder for something concrete the writer didn't
  put in. They are questions to the student, not words to swap for synonyms.
- **Intensifiers covering a weak detail.** "Incredibly meaningful," "truly
  life-changing." The adverb is where the writer stopped trusting the noun.
- **The "and then" chain.** Events in order, evenly weighted, no sentence more
  important than any other. Decide which moment matters and give it the room the
  others were wasting.
- **The essay that answers a different prompt.** Re-read the prompt against the
  draft; a beautiful essay that doesn't answer the question is a rejection.

## Cutting to a word limit

- **Cut whole sentences before you trim words.** Deleting articles and stacking
  nouns to save four words makes the prose worse and the count barely moves.
- **Over by ~10%:** one or two sentences — usually the throat-clearing opener and
  the summarizing last line. **Over by 30% or more:** a whole strand has to go.
  Say which one and why, rather than shaving everywhere evenly.
- **Never compress by raising the register.** Replacing plain words with formal
  ones to save space is how a student's essay turns into a stranger's. Load
  `essay-voice` if you feel that pull.
- **Cut explanation, keep evidence.** Sentences that tell the reader what to
  think about the scene go first; the scene itself stays.

## Restructuring

- **Move what exists; don't write connective tissue.** A transition that asserts
  a link the student never made ("that lesson followed me into the lab") is an
  invention with a preposition in front of it. If two moved paragraphs need a
  bridge, ask what actually connected them.
- **Try the order before you argue for it.** Propose the reordering as the edits
  themselves so the student can see it, and say in one line what it buys.
- **Reordering breaks tense and reference.** After a move, check pronouns,
  time markers, and anything that referred backward to text that is now after it.

## Edits must stand alone

Every `old_text` has to match the essay's *current* text exactly and once, and if
one edit in an `edit_essay` batch misses, the whole batch fails and nothing
lands. So anchor each edit in text you actually read, never in text a sibling
edit in the same call is about to create. If two changes genuinely depend on each
other, make them in separate turns. This matters most here, because restructuring
is exactly where chained edits are tempting.

Keep each edit to a few sentences at most. Several small changes beat one
paragraph-sized rewrite: your edits land directly in the draft the student is
living in, so the size of an edit is the size of the mistake when you get one
wrong — and a small one is something they can judge on its own and ask you to put
back.

## Deductions and traps

- **Never rewrite the whole draft.** A wholesale rewrite is not revision; it is a
  substitution, and it ends the student's authorship of their own essay.
- **Don't fix a sentence in isolation.** Read the two around it. The smoothest
  sentence on the page is usually the one you flattened.
- **Don't edit toward a generic "good essay."** If the change would make the
  draft interchangeable with any other applicant's, it's the wrong change.
- **Say what you changed and why.** A silent tool call leaves the student
  accepting edits they don't understand and can't learn from.
- **Grammar last.** Fixing commas in a draft whose middle is about to be rebuilt
  wastes both of your time.

## Final answer shape

1. The one thing most worth fixing, named in a sentence.
2. The edits themselves — small, independent, each with a short reason.
3. What you deliberately left alone, if the student might expect otherwise.
4. The question you need answered before the next pass.
5. The word count after, when a limit is in play.

## Exemplar shape

A 780-word draft with a 650 limit, opening on "For as long as I can remember,
I've been fascinated by medicine," and closing on "I learned that empathy is the
most important quality a doctor can have." The veteran move isn't trimming 130
words evenly. It's cutting the first paragraph and the last two sentences —
which is most of the overage — and then asking about the one patient the middle
summarizes in a clause, because that's the essay.
