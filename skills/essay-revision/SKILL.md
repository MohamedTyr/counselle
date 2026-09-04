---
name: essay-revision
description: Judgment procedure for reviewing and revising a drafted essay — run the four-part essay test to diagnose whether the draft is doing its job, triage each failure to the right repair, execute the first-sentence revision method, and deliver feedback under the ownership rules. Use when a student shares a draft and asks if it's good, or wants help making it better.
user_invokable: true
display_name: Essay revision
user_description: Get your draft diagnosed and revised.
---

# Essay Revision

Source: adapted from *College Essay Essentials* (Ethan Sawyer), Chs. 5 and 8.
Load `essay-honesty` first — revision is where an agent most easily overwrites
a student's voice, and the ownership rules below are binding.

## The hidden decision

"Is my draft good?" is really "is my essay doing its job?" — and prescription
without diagnosis is this feature's failure mode. The essay's job: colleges
already have the grades, scores, and activities list; the essay must show
something not already evident — that this student will contribute, in college
and beyond. Diagnose against that job first; only then repair, one thing at a
time.

## The essay test (run this on every draft before any line edits)

Have the student read the draft aloud if possible (what the mouth stumbles on,
the reader stumbles on). Then score four qualities honestly:

1. **Values.** Can you name **four to five** core values of the author from
   the text alone — *shown*, not claimed? Are they **varied**, or the same
   value repeated in synonyms (hard work / determination / perseverance are
   one value wearing three hats)?
2. **Vulnerability.** Does it read from the head (analytical, reporting) or
   from somewhere deeper? The two-part check: after reading, do you *know
   more* about the author **and** *feel closer* to them? Both must be yes.
3. **Insight.** Are there **three to five** genuine "so what" moments? Test
   each: is it illuminating, or would a stranger have predicted it from the
   images alone?
4. **Craft.** Do ideas connect logically but not too obviously? Does it read
   as carefully chosen and revised? Is it interesting and succinct
   *throughout* — and if not, mark exactly where attention drops.

Report the score plainly, per quality, quoting the draft's own lines as
evidence (the lines that show a value, the moment attention drops). Never a
vague "it's good, maybe add detail." A great story ≠ automatically a great
college essay — gorgeous risky writing can still fail the job test, and a
quiet, non-dramatic topic can ace it; say which is happening.

## Triage — route each failure to its repair

| Test failure | Repair |
|---|---|
| Fewer than 4 values, or repetitive ones | Values audit below + `essay-values` |
| Reads analytical / reader feels no closer | `essay-depth` (feelings-and-needs, want vs. need, the four vulnerability methods) |
| Insights thin or predictable | `essay-depth` (insight-distance test, the so-what chain) |
| Opening, brag, or ending not landing | `essay-craft` |
| Shapeless, saggy middle, ends where it began | `essay-structure` |
| Passes everything; student wants exceptional | `essay-advanced` |
| The topic itself is the problem | Say so honestly; back to `essay-brainstorm` |

Fix in that spirit: **substance before sentences.** Line-polish on a draft
failing the values or vulnerability check is wasted work.

## The values audit (the most common repair)

Walk the draft with the student: which values clearly come through (mark the
lines)? Which are half-there? Which do they *want* in that aren't? Then three
verbs — **cut** sections showing no value, **rewrite** sections where the
value is muddy, **add** (by interview) material for a missing value. Merge
near-duplicate values unless the student can articulate a real difference.

## The first-sentence revision (the structural pass)

In a strong essay, the first sentences of the paragraphs, read in sequence,
form a coherent miniature of the whole. The method:

1. Extract every paragraph's first sentence; read the sequence aloud. Does it
   tell a short version of the essay?
2. If not: outline anew until the first sentences *do* flow as a mini-essay.
3. Rebuild on a **fresh document** from those sentences — not by patching the
   old draft. (Writers fall in love with old phrasings; stitching new life
   from dead parts produces a monster. The old draft stays available; nothing
   is destroyed.)
4. Rewrite each paragraph to genuinely serve its topic sentence.
5. Step away — at least half an hour — then re-run step 1 aloud and check
   each paragraph supports its first sentence.

Foggy writing is foggy thinking: a paragraph that resists this usually
contains an unfinished thought, not a phrasing problem. If flow keeps failing
after two passes, the real problem is usually depth or topic — re-run the test
rather than polishing again.

## Suggestion mechanics (how edits are delivered)

- Small, targeted suggestions — never a wholesale rewrite of the student's
  text.
- **Each suggestion stands independently**: it must make sense whether or not
  the student accepts any other suggestion in the batch; never chain edits
  that only work together.
- Diagnose and show the pattern; let the student write the fix. Candidate
  phrasings are allowed only when built from the student's own words and
  labeled as candidates.
- Preserve voice: an unusual rhythm or informal register is content, not
  error (`essay-honesty`).

## Feedback conduct (binding)

- Frame judgments as experience, not authority: "what I've seen work," never
  "what colleges want" — no one objectively knows what every reader thinks.
- Be the *one* feedback source at a time; advise the student not to collect
  five simultaneous opinions (too many cooks), and to also get **one** human
  reader they trust — after they know what every paragraph is doing and why.
- Don't judge a fragile new idea as if it were a finished draft — calibrate
  to the draft's stage; a first draft gets a job-check, not a style audit.
- Ask what feedback they want, and honor it — but if the real problem is the
  topic, say so kindly and directly even when they asked about grammar.
- **"It's your essay. You get final say."** Say it, and mean it: a rejected
  suggestion is closed, not re-argued.

## When to scrap and start over

Any time the student wants — if it's before the deadline, there's time. The
work done is not wasted: it cleared the way for the better essay (the
brainstorm, the values, the interviews all carry forward). Say this when a
student is trapped by sunk cost in a draft that keeps failing the test — and
also when they *want* to start over but feel guilty. Eight to ten drafts is a
normal count for a great essay; at some point, though, the last revision is
done and the essay must be sent — work really hard, then let go.

## Final answer shape

1. The test verdict, quality by quality, with the draft's own lines as
   evidence.
2. The one or two highest-leverage repairs, named, in order — with the next
   skill loaded and the first concrete step taken.
3. Suggestions (if any) as small independent items the student can accept or
   reject one by one.
4. The ownership close: their essay, their call.

## Exemplar shape

A student pastes a polished-sounding draft about their team captaincy. The
test finds: two values (both flavors of hard work), head-voice throughout,
one predictable insight, clean craft. The verdict names that honestly —
strong sentences, essay not yet doing its job — routes to `essay-depth`,
runs the feelings-and-needs interview on the season that actually mattered,
and the rebuilt draft passes with five varied values and an insight the
stranger wouldn't guess. The agent never rewrote a paragraph; the student did.
