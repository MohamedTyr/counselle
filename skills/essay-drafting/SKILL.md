---
name: essay-drafting
description: Craft procedure for getting a student from nothing to a real first draft — interview for the true material before writing a word, choose an angle small enough to fit the word count, open inside a moment rather than on a thesis, and reserve the direct full write for the genuinely empty essay. Use when a student has a prompt but no draft, or a draft that is really a pile of notes.
user_invokable: true
display_name: Essay drafting
user_description: Turn a prompt and your raw material into a real first draft.
---

# Essay Drafting

## The hidden decision

"Help me write my essay" is almost never a request for prose. It is "I don't
know what this essay is about yet." A student who knows their angle can usually
write the paragraph themselves; a student who doesn't will accept whatever you
produce and end up submitting an essay about nobody. So the first job is to find
the material and the angle. The writing is the easy part and it comes last.

If the essay isn't already loaded in front of you, read it first (`read_essay`)
and read the prompt and word limit before proposing anything — the form of a
150-word supplement and a 650-word personal statement have almost nothing in
common.

## What the essay is actually doing

An admissions reader gives an essay a few minutes, after a transcript and an
activity list that already say what the student did. The essay is the only place
they hear how the student thinks. Read for that and draft for that:

- **It is evidence of a mind, not a résumé in paragraphs.** Anything already on
  the activity list earns its place in the essay only if the essay says
  something about the person that the list can't.
- **Specific and true beats large and impressive.** A real argument with a
  sibling, told exactly, outperforms a borrowed story about a mission trip. The
  topic does not have to be a tragedy; there is no hardship requirement, and
  pushing a student toward one is both bad craft and a way to invite invention.
- **650 words is one thing.** It is a scene and what the student made of it, not
  a life history and not three anecdotes. Most weak drafts are three essays
  fighting for the same space.
- **The reader should be able to say who this person is** in one sentence after
  reading. If you can't, the draft has no angle yet.

## Interview before you write

Ask, don't assume — and ask one question at a time, small enough to answer in a
sentence. A list of eight questions gets zero answers.

- **For a personal statement:** the moment question. "When did you last change
  your mind about something?" "What do your friends come to you for?" "What's a
  small thing you're unreasonable about?" Then push for the scene: where were
  you, what did you actually say, what happened next.
- **For a why-school or community supplement:** the specificity question — what
  the student has actually done that connects to something real at this school.
  Load `essay-fit` for the school-side research; never name a program or club
  from memory.
- **For a short-answer supplement:** one question only. At 100–150 words there
  is no room for a scene, so what you need is the one concrete noun the answer
  turns on.
- **Read the workspace first.** Activities, honors, and uploaded documents are
  real material the student already gave us; a question you didn't need to ask
  is a small tax on their patience. But a line on an activity list is a fact, not
  a memory — you still have to ask how it felt and what happened.

## Shaping a first draft

Once the material is real, the shape usually falls out:

- **Open inside something happening** — a specific time, place, and action. Not
  a thesis, not a quotation, not a definition, not "Ever since I was young." The
  reader should be oriented by the second sentence and curious by the third.
- **Scene, then turn, then what it cost or changed.** The turn is the sentence
  where the student sees something they hadn't; everything before it exists to
  earn it.
- **Leave the ending open in a first draft.** Endings are discovered in
  revision, and an ending written early almost always becomes a moral. Stop on
  the last concrete thing rather than reaching for a summary.
- **For a supplement, the word count picks the form.** Under ~200 words: no
  scene, lead with the specific and spend every word on it. 250–400: one short
  scene or two concrete specifics plus the connection.

## The one case you write the whole thing

When the essay is genuinely empty, drafting a full first pass with `write_essay`
is the right move — a blank page is the one place a student can't react to
anything smaller. Even then, every paragraph is assembled from material the
student gave you in this conversation or in their workspace. If you find
yourself writing a paragraph that would work for any student, it isn't theirs:
delete it and ask.

Once the essay has text, stop writing documents. Work in small `edit_essay`
changes: they go straight into the draft, so keep each one small enough that the
student can see exactly what changed, and never overwrite a draft they have been
living in.

## Deductions and traps

- **No material, no draft.** Writing to fill the page teaches the student that
  filler is acceptable, and the invented detail is the part they'll never notice
  isn't theirs. Load `essay-honesty` and ask.
- **Don't hand over a topic list.** "You could write about resilience, a
  challenge, or a passion" is a way of not helping. Propose the one angle their
  actual material supports, and say why.
- **Beware the impressive topic.** A student steered toward the story they think
  admissions wants writes their least honest essay.
- **Don't draft past a gap.** If the scene needs a detail you don't have, stop
  there and ask rather than bridging it with something plausible.

## Final answer shape

1. The angle you'd take, in one sentence, and why their material supports it.
2. The one question you need answered before the draft is real.
3. The draft or the opening, once the material exists.
4. What you deliberately left open, including anything you couldn't fill.
5. The next concrete move.

## Exemplar shape

A student has "I want to write about my grandmother" and 650 words. The novice
move is to write a grandmother essay — hospital room, lesson about time. The
veteran move is one question: "What's the last completely ordinary thing you two
did together?" The answer is usually the essay, and it is one nobody else could
have written.
