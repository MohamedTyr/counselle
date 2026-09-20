# SAT question bank audit

Generated 2026-09-20T02:36:42.152818+00:00.

## Counts

- total: 3756
- qbank: 3308
- disclosed: 448
- mcq: 3292
- spr: 464
- reading: 1845
- math: 1911
- in_bluebook: 2019
- aliases: 3
- bank sha256: 71114db00cf1f752bd7a8ba038c38c06c8f1788bb8210409b2b63450e6e377b6
- raw archive sha256: ee583218706649523a3c819d99e64e602f45c3294d835628d03a138efb6e40d0

## Robots outcomes

- qbank-api.collegeboard.org: status=403 decision=allowed_unavailable
- saic.collegeboard.org: status=403 decision=allowed_unavailable

## Gates

### G1 coverage: FAIL

- 11 build failure(s), see the Failures section below

### G2 superset: PASS


### G3 identity: PASS

- 3 duplicate content-id group(s), each resolved to one canonical id
-   canonical=99c5e794 aliases=['c048055c']
-   canonical=d3f7c429 aliases=['dd3a910a']
-   canonical=d8539e09 aliases=['f8ff3249']
- unique = stubs (3770) - sum(group-1) = 3767; unique content ids observed = 3767

### G4 keys: PASS

- 3292 mcq, 464 spr

### G6 taxonomy: PASS

- bank triples=29 taxonomy triples=29

### G7 bluebook: PASS

- E4-live external_ids with no matching stub: 18 ['093a41fa-36ba-4d68-a521-381fa328114e', '20c3df3f-382e-4c94-a9fe-cb25acbae6b1', '33508a17-8255-4313-80e7-c1bf9cd505b3', '34aff872-b9cb-4ea2-bfc3-bffd45b4eefb', '38f9b682-b22b-4740-ad52-2d8ba39ce79f', '476f7e8b-5191-4fec-b811-5afc910ecdb4', '4e4b82e7-8b5f-48a9-a90b-9ad75b202160', '8b422b91-e8e0-4fa8-9042-bde638fd7c71', '90748ee0-e643-48d5-b69f-c05398fbe6c2', 'a49cde05-7596-471d-a5db-7a7c882a7fd3']
- liprep bluebook questionIds whose stub is not E4-live: 0 []
- E4-live, stub-matched external_ids absent from liprep's list: 4 ['40946085-fbf1-4c4a-977f-931fd79ef80c', '7a8d2bc5-8edd-45eb-a918-924e8cba8608', 'b43f007e-8a7c-48b8-8a0a-eeb0f65e3faf', 'ff0ab105-aa85-4cb3-a07f-f00a7c55c4e3']

### G8 drift: PASS

- previous question_count=3756, current=3756

### G9 normaliser parity: PASS

- suite=normalize upstream_commit=c84d3dc099653cc82fa2d380a7bbd299ae52201e patch_sha256=98a2bc4914fd1bb18db9445366d374813cc489be27539e7daac9657ffa73dfb3 generated_at=2026-09-19T16:35:56.502Z count=39
- asserted by tests/domain/sat/test_normalize.py -- see DIFFERENCES.md for scope

### G10 spr: PASS

- 70 legacy disclosed spr item(s), all confirmed
- 56 G10 cross-check finding(s) (qbank spr rationale vs. official key)
-   083ef63a: official=['-13/2', '-6.5'] residue=['13/2']
-   0a74365c: official=['15000'] residue=['15', '000']
-   0b0fa68b: official=['.0465', '2/43'] residue=['8']
-   0f9f8ea7: official=['3600'] residue=['3', '600']
-   1087f6c4: official=['0.25', '1/4'] residue=['25']
-   1178f2df: official=['-2112'] residue=['-2', '112']
-   165c30c4: official=['2048'] residue=['2', '048']
-   167aff9e: official=['1260'] residue=['1', '260']
-   20845d36: official=['.48', '12/25'] residue=['48']
-   25faa756: official=['.88', '22/25'] residue=['88']
-   2be01bd9: official=['.14', '7/50'] residue=['50/7']
-   2d0e13a6: official=['.25', '1/4'] residue=['1']
-   2df8f293: official=['.0714', '1/14'] residue=['14']
-   2f0a43b2: official=['.2', '1/5'] residue=['5']
-   3310c2ab: official=['2432'] residue=['2', '432']
-   358f18bc: official=['1728'] residue=['1', '728']
-   3a84f885: official=['1677'] residue=['1', '677']
-   3c8fdc40: official=['2520'] residue=['2', '520']
-   429fb7c0: official=['-.3266', '-.3267', '-49/150'] residue=['3267']
-   4757123b: official=['1681'] residue=['1', '681']
-   4b7bb316: official=['4205'] residue=['4', '205']
-   5355c0ef: official=['.09', '9/100'] residue=['09']
-   56e1b09e: official=['0.2', '1/5'] residue=['2']
-   571174f3: official=['.2857', '2/7'] residue=['35/4']
-   5edc8c98: official=['.0625', '1/16'] residue=['64']
-   61f61789: official=['0.32', '8/25'] residue=['32']
-   63d03c0b: official=['3331'] residue=['3', '331']
-   67c0200a: official=['.54', '27/50'] residue=['54']
-   699af7b3: official=['60000'] residue=['60', '000']
-   73ddfdac: official=['73920'] residue=['73', '920']
-   7b52985c: official=['4.5', '9/2'] residue=['11']
-   7d5d1b32: official=['-.9333', '-14/15'] residue=['14/15']
-   8213b1b3: official=['.0014'] residue=['0014']
-   8637294f: official=['.0625', '1/16'] residue=['0625']
-   89c39d77: official=['35728'] residue=['35', '728']
-   94ff3e2d: official=['.5', '1/2'] residue=['2']
-   96c3e32d: official=['16606'] residue=['16', '606']
-   9f934297: official=['2216'] residue=['2', '216']
-   a29e89fc: official=['3630'] residue=['3', '630']
-   ba8ca563: official=['36504'] residue=['36', '504']
-   c0b53183: official=['39312'] residue=['39', '312']
-   c2e7fa6d: official=['4176'] residue=['4', '176']
-   c6e85cd7: official=['.2916', '.2917', '7/24'] residue=['0.219', '1']
-   c81499e1: official=['39000'] residue=['39', '000']
-   c81f1c2f: official=['2850'] residue=['2', '850']
-   cb4894f9: official=['34672'] residue=['34', '672']
-   e21d10a7: official=['1015'] residue=['1', '015']
-   e5c57163: official=['27556'] residue=['27', '556']
-   e9ed719f: official=['0.3', '3/10'] residue=['100']
-   ec787383: official=['40260'] residue=['40', '260']
-   ed6b7e5f: official=['0.4', '2/5'] residue=['20']
-   f1c81b3b: official=['11875'] residue=['11', '875']
-   f39f88b7: official=['1800'] residue=['1', '800']
-   f67255ea: official=['1660'] residue=['1', '660']
-   f6ca90cc: official=['5800'] residue=['5', '800']
-   f718c9cf: official=['1.8', '9/5'] residue=['2']

## Failures

11 build failure(s) (G1 coverage):

- 000259aa: mcq has 0 correct answers, expected 1
- 1dcea480: mcq has 0 correct answers, expected 1
- 3563d76d: mcq has 0 correct answers, expected 1
- 36ab4122: mcq has 0 correct answers, expected 1
- 3f5398a6: mcq has 0 correct answers, expected 1
- 46f68129: mcq has 0 correct answers, expected 1
- 566759ef: mcq has 0 correct answers, expected 1
- 7ac5d686: mcq has 0 correct answers, expected 1
- 90eed2e5: mcq has 0 correct answers, expected 1
- e1391dd6: mcq has 0 correct answers, expected 1
- f7e626b2: mcq has 0 correct answers, expected 1

11 of the above are legacy disclosed items whose `answer` object carries none of `correct_choice` / `correct_answer` / `correctChoice` -- verified against the raw E3 response, not a build bug: the correct option is stated only in the rationale's prose (e.g. "Choice C is correct."). This is a genuine upstream data gap in the structured field. There is currently no reviewed-override path for a disclosed mcq answer (unlike `reviewed_spr_keys` for legacy disclosed spr, plan §3.5); closing this gate requires a `domain/sat/normalize.py` change, which is outside this module's scope and is not made here.

### G5 render: PASS

- fields checked: 22525
- failures: 0
- measured wall-clock: 137.2s (2026-09-20 security re-audit re-run; budget: 2-5 min, plan §8.3)
- reviewed exceptions: 215 distinct `(questionId, field)` pairs, 5,809 individual
  removed-detail instances counted against `REMOVAL_IGNORE_LIST` (see the
  granularity note below for why the instance count is now reported, not just
  the field count)

The initial run of this gate (2026-09-20) found 218 failing fields, none of which
was a case of a student losing meaningful question content. Full adjudication,
by category, against §6.2:

- **212 fields (5,805 instances): an HTML comment** (e.g. `<!-- $\mathit{w}$° -->`
  labelling an SVG figure's variables for a human editor, or
  `<!-- Note: Figure not drawn to scale. -->`). Comments are never rendered by
  any browser, sanitised or not -- removing one changes nothing a student sees,
  because it was already invisible before DOMPurify touched it. Added to
  `REMOVAL_IGNORE_LIST` (212 `questionId:field` entries, one comment blanket
  reason).
- **2 fields: the MathML `form` attribute** on a stretchy fence `<mo>`
  (`042aa429`, `de39858a`) -- a real content difference (controls open/close
  stretch direction), outside the plan's 204-sample measurement. Fixed by
  widening `ADD_ATTR` in `sat-html.ts` to include `form`; guarded by a new
  test in `sat-html.test.ts`.
- **1 field: the SVG `isolation` attribute** on a `<g>` (`25fc031a`) -- a
  standard, non-executable compositing hint, the same category as the
  already-allowed `fill`/`stroke`/`clip-path` presentation attributes. Fixed
  by widening `ADD_ATTR`; guarded by a new test in `sat-html.test.ts`.
- **1 field: a stray `s` attribute** on a `<p>` (`3566120b`, `stimulus`) --
  a source-data typo (`<p style="...">` literally has an extra `s` before the
  closing `>`), not a real attribute. Verified against the raw bank content.
  Ignored.
- **1 field: an `<itembody>` wrapper** (`6670e407`, `stem`) -- an inert QTI
  wrapper tag with no attributes; DOMPurify unwraps it and keeps every child
  node (verified: `<itembody><div>x</div></itembody>` sanitises to
  `<div>x</div>`). Ignored.
- **1 field: an empty, orphaned `<mo></mo>`** (`deee9063`, `rationale`) sitting
  between two sibling `<math>` elements, not inside a `<math>` ancestor itself
  -- has no text node, so it renders nothing whether kept or removed. Ignored.

Verified: none of the 22,378 fields that already passed before this change
were affected -- the raw bank contains exactly 3 fields with a literal
`form=` or `isolation=` attribute anywhere (`042aa429`, `de39858a`,
`25fc031a`), matching the 3 fields the `ADD_ATTR` widening was intended to
change, so no other field's sanitised output could possibly differ.

### G5 follow-up: `form`/form-control security hardening (2026-09-20)

A security review of the `ADD_ATTR: ["form", ...]` widening above found two
issues. First, DOMPurify's `ADD_ATTR` is a flat, non-element-scoped
allow-list, so `form` was in fact permitted on *every* element, not just the
`<mo>` it was added for -- letting an `<input>`/`<button>`/`<textarea>`/
`<select>` in question content bind to a real `<form>` elsewhere on the page
(orphan form-control association). Second, and independent of the widening:
DOMPurify's default HTML profile already allows `<form>`, `<input>`,
`<button>`, `<select>`, `<textarea>`, `<option>` and the attributes `action`
/ `method` / `name` / `value` / `type` -- so a complete
`<form action="https://evil.example/collect">` in question content would
render and submit on click, a native, no-JavaScript phishing vector. Form
controls have no legitimate use in SAT question content (passages, stems,
options, rationales, MathML, figures).

Fixed in `sat-html.ts`: `form` is now scoped to `MATHML_TAG_SET` by the
existing `uponSanitizeAttribute` hook (the same mechanism already used to
restrict `href`/`xlink:href`), and `<form>`, `<input>`, `<button>`,
`<select>`, `<textarea>`, `<option>` plus `action`/`method` are now
`FORBID_TAGS`/`FORBID_ATTR`. `isolation` was reviewed and left unscoped --
it is a CSS/SVG compositing hint with no executable meaning on any element,
so scoping it would add complexity for no security benefit.

**Re-running G5 over the whole corpus after this fix found zero new
failures** (`failureCount: 0`, `categorySummary: []`) -- no real bank field
anywhere uses a form-control tag or `action`/`method`, so forbidding them
changed nothing a student sees. Regression tests pinning both closed vectors
(`form` dropped off non-MathML elements; `<input>`/`<button>`/`<textarea>`/
`<select>`/`<option>`/`<form>` and `action`/`method`/`formaction` all
stripped) are in `sat-html.test.ts`.

### `REMOVAL_IGNORE_LIST` granularity (2026-09-20)

The ignore list used to key exemptions on `questionId:field` alone, so any
field with a reviewed removal (almost always an HTML comment) was exempted
from *any* removal whatsoever -- a future bank refresh or config change that
started stripping something new from one of those 215 fields would have
passed silently. The key is now `questionId:field:kind:name` (the exact
`RemovedDetail.kind`/`RemovedDetail.name` pair), so a field is exempted only
for the specific, reviewed kind of removal; a different removal on the same
field still fails the gate. This is why `reviewedIgnoredCount` in
`g5-report.json` now reports 5,809 (per-removal-instance) rather than 215
(per-field) -- the same 215 fields, counted at the new granularity. A
regression test in `sat-html.corpus.test.ts` (`REMOVAL_IGNORE_LIST
granularity`) pins that an exempted field still fails when it produces a
different kind of removal.

## SPR key adjudication

Keys adjudicated by an AI agent on 2026-09-19; owner spot-check pending (R11).
