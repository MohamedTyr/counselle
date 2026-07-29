---
name: application-rounds
description: Judgment procedure for ED/EA/REA/RD strategy and deadline questions — get this school's current-cycle plan definitions and restrictions from its official site, decide the round by whether the file is stronger now or by regular decision, and name the opportunity cost. Use when a student asks when or in which round to apply, or about deadlines.
user_invokable: true
display_name: Application rounds
user_description: Choose ED/EA/REA/RD timing and deadline strategy.
---

# Application Rounds

Source: `plans/research-counselor-judgment.md` (rounds/deadlines playbook).

## The hidden decision

"When should I apply?" means "where do I spend my early card, and what does
it cost me?" An early round is a scarce resource: binding (ED), restricting
(REA/SCEA), or at minimum an earlier version of the file. The answer is a
round recommendation with its opportunity cost named — never a definitions
lecture.

## Evidence plan

Use `counselor-research` for source routing. In the same round as `resolve_school`,
gather each distinct source that changes the decision:

- CDS for historical context and profile constraints.
- Official school sites for current-cycle deadlines, restriction language, and policy terms.
- Broad web for recent changes and admissions-communications context.
- Reddit for hidden friction and implementation patterns that can change what is
  operationally wise.

## Fingerprint this school first (unknown until searched)

The round math is school-specific, perishable, and decision-flipping. You do **not**
know from memory whether this school is yield-protective or how large its early
advantage is — fetch it for whatever school is asked, every time, before the
deductions apply:

- **The early-vs-regular gap.** Search the ED/EA admit rate against the RD admit
  rate, and the share of the class filled in binding early rounds (broad web +
  `.edu`): `"[school] early decision vs regular decision acceptance rate [cycle]"`,
  `"[school] percent of class admitted early decision"`. Some schools protect their
  yield by taking most of the class ED1/ED2, which makes RD a near-lottery — when
  the data shows that pattern, say so plainly; when it doesn't, don't imply it.
- **Round reputation, especially for internationals needing aid.** Reddit sweep
  (`{school}` sub + ApplyingToCollege + IntltoUSA): `"[school] RD chances"`,
  `"rejected [school] regular decision"`, `"[school] international regular decision
  financial aid"`. A binding-early advantage compounds for need-aware-international
  applicants — surface that if it applies.
- **Restriction fine print for this cycle** (`.edu`): the school's actual ED/REA/SCEA
  language and its exceptions (public universities, scholarship programs), not the
  category name.

If a current-cycle page returns only undated or historical results, retry with a
year-specific query before concluding.

## Deductions

- **Stronger now or stronger by RD?** Rising senior-fall grades, a pending
  retest, or a major late-fall project can make RD the stronger play; a
  finished file with a clear first choice argues early. This single question
  decides most round choices.
- **Never delay for a future accomplishment.** An upcoming award or event is
  not a reason to skip an early round — apply with the strongest current
  file and put what's coming in Additional Information.
- **Binding ED costs aid leverage**: no competing offers to compare or
  negotiate with. When the family needs to compare aid, say so before the
  student commits (load `costs-and-aid` when money is live).
- **Restriction fine print is school-specific.** REA/SCEA rules differ by
  college and often carry exceptions (public universities, scholarship
  programs). Read this school's actual language; never answer from the
  category name.

## Traps

- "Non-binding" never means unrestricted — single-choice EA plans restrict
  where else the student can apply early.
- Subdeadlines land before the headline deadline: arts portfolios,
  scholarship priority dates, honors colleges, interviews. Surface every
  one that applies to this student, not just the application date.
- Last cycle's dates are not this cycle's dates. Cite only dated,
  current-cycle results; if the site returns only undated or historical
  pages, retry with a year-specific query before saying so.
- Latest-accepted test dates are earlier for early rounds and vary by
  school — a student planning a retest needs that date, not just the
  application deadline.

## Final answer shape

1. State the recommended round and sequencing first.
2. Give 2–4 reasons that materially drive the pick.
3. Name the exact opportunity cost of that choice.
4. Separate official-policy facts from community signals.
5. End with one next step tied to the student's next action.

If the decision is contingent, name one short trigger that flips it.

## Exemplar shape

"Should I hold my ED application because something big happens for me in
November?" The veteran answer is one word plus a mechanism: no — apply now
with your strongest current file, and when the November result lands, send
it through Additional Information or the school's update process. Crisp,
operational, and it protects the early-round advantage the student almost
gave away.
