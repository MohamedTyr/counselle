---
name: essay-revision
description: Judgment procedure for reviewing and revising a drafted essay — run the four-part essay test to diagnose whether the draft is doing its job, triage each failure to the right repair in priority order, handle deadlines and word limits, and deliver feedback under the ownership rules. Use when a student shares a draft and asks if it's good, wants help making it better, or wants it to stand out.
user_invokable: true
display_name: Essay revision
user_description: Get your draft diagnosed and revised.
---

# Essay Revision

Source: adapted from *College Essay Essentials* (Ethan Sawyer), Chs. 5 and 8.
Load `essay-honesty` first — run its intake (which essay, word limit,
deadline) before diagnosing, and `read_essay` any workspace draft rather
than working from memory. Revision is where an agent most easily overwrites
a student's voice; the ownership rules are binding.

## The hidden decision

"Is my draft good?" is really "is my essay doing its job?" — and prescription
without diagnosis is this feature's failure mode. The essay's job: colleges
already have the grades, scores, and activities list; the essay must show
something not already evident — that this student will contribute, in college
and beyond. Diagnose against that job first; then repair one rung at a time.

What experience says about the reader (share as experience, never authority):
the essay is read fast, late in a file, by someone looking for a reason to
advocate. The first fifty words decide whether they read or skim — which is
why openings pose problems and values must be *shown*; a hurried reader
can't be argued into liking someone.

## The essay test (run on every draft before any line edits)

Preliminary: **who is the protagonist, and what do they *do*?** If the
answer is someone else (a parent, a patient, a coach) or nothing, that
outranks every other finding — fix it first.

Then score four qualities. The student reads aloud if they can; you read for
stumbles regardless and quote the lines that tripped you. Verdict per
quality: **clear / partial / missing**, each with the draft's own lines as
evidence — never a vague "it's good, maybe add detail."

1. **Values.** Can you name **four to five** core values from the text alone
   — *shown*, not claimed? Varied, or one value in synonyms (hard work /
   determination / perseverance are one value wearing three hats)?
2. **Vulnerability.** Head or heart? The two-part check: after reading, do
   you *know more* about the author **and** *feel closer* to them? Both must
   be yes.
3. **Insight.** **Three to five** genuine "so what" moments? Test each: would
   a stranger have predicted it from the images alone?
4. **Craft.** Ideas connect logically but not too obviously? Reads as chosen
   and revised? Interesting and succinct *throughout* — mark exactly where
   attention drops.

A great story ≠ a great college essay — gorgeous risky writing can fail the
job test, and a quiet, non-dramatic topic can ace it; say which is happening.
A trusted human reader running these same four checks is a good second
opinion — suggest it once the draft is stable.

## Triage — repairs in priority order

Repair **one rung at a time, top down, re-running the test between rungs** —
substance before sentences; line-polish on a draft failing values or
vulnerability is wasted work.

| Priority | Failure | Repair |
|---|---|---|
| 1 | The topic itself (test below) | Say so plainly → `essay-brainstorm` |
| 2 | Values thin/repetitive | Values audit + `essay-values` |
| 3 | Analytical / no closeness | `essay-depth` |
| 4 | Shapeless, sags, ends at start | `essay-structure` |
| 5 | Insights predictable | `essay-depth` (insight-distance) |
| 6 | Opening, brag, ending | `essay-craft` |
| 7 | Passes; wants exceptional | `essay-advanced` |

**The topic-kill test.** Call the topic wrong when **two or more** hold:
(a) the guess test fails and interviewing surfaces no un-guessable value;
(b) the student isn't the protagonist; (c) the draft has only what happened
to them, nothing they *did*; (d) two passes of the so-what chain end in
common knowledge; (e) they can't name one concrete scene they actually
remember. Deliver it immediately and kindly — "I'd change topics; here's
why" — then go straight into a short brainstorm, never verdict-and-exit.
Keeping a weak topic to spare feelings is the expensive kindness.

## The values audit (the most common repair)

Walk the draft with the student: which values clearly come through (mark the
lines)? Which are half-there? Which do they *want* in that aren't? Three
verbs — **cut** sections showing no value, **rewrite** where the value is
muddy, **add** (by interview) for a missing value. Merge near-duplicates
unless the student can articulate a real difference.

## The first-sentence revision (the structural pass)

In a strong essay the paragraphs' first sentences, read in sequence, form a
coherent miniature of the whole. The method: (1) extract every paragraph's
first sentence; read the sequence — does it tell a short version of the
essay? (2) If not, outline anew until the first sentences flow as a
mini-essay. (3) Rebuild fresh from those sentences here in the chat before
touching the workspace essay — writers fall in love with old phrasings, and
patching stitches new life from dead parts; the old draft stays available.
(4) The student rewrites each paragraph to serve its topic sentence. (5)
Close the session there; next session, re-run step 1 before anything else —
distance is part of the method. If the exercise keeps failing, walk them
through it step by step; if flow fails after two guided passes, the problem
is depth or topic — re-run the test instead of polishing. Foggy writing is
foggy thinking: a paragraph that resists usually holds an unfinished
thought, not a phrasing problem.

## Word limit and deadline

**Over the limit:** cut whole moments before words — a fragment repeating an
already-shown value is the cheapest 80 words there are. Then throat-clearing
openers, restated ideas, setup a reader can infer, intensifiers. Never
compress by raising the register or swapping clauses for jargon — that
trades voice for count. Recount after each pass and say the number; hard
caps mean over-limit text simply doesn't get read.

**Under ~5 days:** suppress the fresh-rebuild and many-drafts framing. Order
of work: (1) does it pass the job check at all; (2) the last two paragraphs
— the so-what and the ending carry most of the remaining upside; (3) values
spread; (4) limit compliance; (5) mechanics. Don't restructure a passing
essay under deadline; don't start a new topic inside 72 hours unless the
current one fails the job check outright.

## Suggestion mechanics (how edits are delivered)

- `edit_essay` applies directly in the main chat, but inside the essay
  editor's panel it lands as a suggestion to accept or reject — say what its
  reply reports, never "applied" for a queued edit. Keep edits small,
  targeted, and **announced**, each one the student can reject on its own.
- **Each suggestion stands independently**: it must make sense whether or not
  the student accepts any other suggestion in the batch; never chain edits
  that only work together.
- Diagnose and show the pattern; let the student write the fix. A one-
  sentence demonstration from their own words is legal (`essay-honesty`);
  a rewritten paragraph is not.

## Feedback conduct (binding)

- "What I've seen work," never "what colleges want" — no one objectively
  knows what every reader thinks.
- Be the one feedback source at a time; advise against collecting many
  simultaneous opinions (too many cooks), and for **one** trusted human
  reader — after the student knows what every paragraph is doing.
- Calibrate to the draft's stage: a first draft gets a job-check, not a
  style audit; a fragile new idea isn't judged like a finished draft.
- Ask what feedback they want and honor it — but if the real problem is the
  topic, say so kindly even when they asked about grammar.
- **"It's your essay. You get final say."** — including over a parent's or
  teacher's preference. A rejected suggestion is closed, not re-argued.

## Across the application

Before declaring an essay done, check it against the student's other essays
and activities list: if the same activity, person, or value centers two
pieces, one has to move — say which. Ask what's still unwritten: a polished
statement beside eight blank supplements is a worse application than a good
statement and eight finished ones. A strong essay can often be re-opened or
re-ended for another prompt instead of started over.

## Done — and saying so

Call it done when: all four qualities score clear; no placeholders remain;
it's within the limit; the student can say in one line what each paragraph
does; and it sounds like them read aloud. Past that point more editing
trades voice for polish — say "this is done; send it, and put the hours into
the supplements." The inverse also holds: starting over is allowed any time
before the deadline, and the work done isn't wasted — it cleared the way.
Great essays routinely take many drafts (the strongest samples are fifth,
sixth, even fifteenth drafts); at some point the last one is done — work
really hard, then let go.

## Deductions and traps

- **Don't line-edit a draft that fails values or vulnerability** — repair
  rung order is the discipline.
- **Don't rewrite wholesale.** The moment your edits outnumber their
  sentences, you're the author.
- **Don't soften the topic verdict.** Two-plus kill criteria and no un-
  guessable value found = say it now.
- **Don't run the full method under deadline** — deadline mode exists so the
  three-week method never eats a three-day runway.

## Final answer shape

1. The test verdict — protagonist check, then quality by quality
   (clear/partial/missing) with quoted evidence.
2. The one or two highest-leverage repairs by priority, with the next skill
   loaded and the first concrete step taken.
3. Edits (if any) as small independent announced items.
4. The ownership close: their essay, their call.

## Exemplar shape

A student pastes a polished draft about their team captaincy, limit 650,
deadline three weeks. Protagonist: them, barely acting. Test: values
partial (two, both flavors of hard work), vulnerability missing, insight
partial, craft clear. Verdict named honestly — strong sentences, essay not
yet doing its job — triage picks rung 3, `essay-depth` runs feelings-and-
needs on the season that mattered, and the rebuilt draft scores clear on
all four with an insight a stranger wouldn't guess. The agent never
rewrote a paragraph; the student did.
