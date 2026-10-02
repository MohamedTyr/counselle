# Third-party notices

This file records third-party code, assets, and embedded services this repository carries
or depends on beyond its ordinary package-manager dependencies (`uv.lock`, `frontend/package-lock.json`
are the source of record for those — this file is for anything that needed a human decision
about attribution, licensing, or use). It exists because SAT practice (ADR 0044) introduced
the first such case in this repo: a ported open-source project, a vendored asset set, and an
embedded third-party service, none of which are captured by a lockfile alone.

## liprep — ported, not vendored

**Source:** `github.com/liprep/liprep` @ commit `c84d3dc`. **Licence:** MIT.

SAT practice (`domain/sat/`, `app/sat/`, `frontend/src/features/sat/`) is a **port** of
liprep's product behaviour, not a copy of its code — see ADR 0044 ("Port, not fork") and
`plans/sat-practice/plan.md` §2 for the full rationale. Two things are carried from liprep
directly, both under the MIT licence above:

**1. Ported pure functions.** A small set of liprep's own logic is reproduced
function-for-function, each module's header naming the upstream function it ports and
checked against liprep's actual code by a differential test harness committed at
`tests/domain/sat/upstream/` (which vendors liprep's source temporarily, at test-fixture
time, under a small reviewable patch — see that directory's own `README.md` for exactly
what the patch changes):

| Ported to | Upstream source |
|---|---|
| `domain/sat/grading.py` | `Practice.tsx::checkIsCorrect`, `parseNumericValue` |
| `domain/sat/normalize.py` | `db.ts::normalizeQuestion`, `normalizeDisclosedQuestion` |
| `domain/sat/spr_answers.py` | `db.ts::extractSprAnswerFromRationale` |
| `domain/sat/stats.py` | `db.ts::getUserStatistics` and its heatmap/streak logic |
| `domain/sat/progress_file.py` | `db.ts::exportUserData` / `importUserData` |
| `frontend/src/features/sat/sat-html.ts` | `RichContent.tsx`'s HTML transforms + DOMPurify config |
| `config/assets/sat/taxonomy.yaml` | `TopicTree.ts` |

**2. Reference sheet artwork.** `frontend/public/sat/reference/{1..11}.svg` and
`special-triangles.png` are liprep's own reference-sheet figures (formula diagrams and the
special-right-triangles figure), copied into this repository and served as static assets,
under the same MIT licence. They are not modified beyond an SVGO optimisation pass (plan
§6.5).

Everything else in the feature — the page components, state management, styling, routing,
and the database/API layer — is written new against Counselle's own stack; none of it is
liprep's code.

## dompurify

**Package:** `dompurify` (`frontend/package.json`, `^3.4.15`). **Licence:** `(MPL-2.0 OR
Apache-2.0)`, per its own `package.json` — dual-licensed, not MIT. Used to sanitise the SAT
question bank's HTML before it is rendered (`frontend/src/features/sat/sat-html.ts`). This
is the one new runtime dependency SAT practice added; it is otherwise covered by the normal
`npm` dependency chain and `package-lock.json`, and is called out here only because its
licence differs from the MIT terms of the rest of this section.

## Desmos — embedded, not bundled

SAT practice's calculator tool is an `<iframe>` embed of the official calculator College
Board itself serves inside Bluebook
(`https://www.desmos.com/testing/collegeboard/graphing`, configured through the
`sat_desmos_embed_url` Settings value), not a bundled Desmos library. This repository does
not vendor, license, or ship any Desmos code — see ADR 0044 for why (liprep's own approach,
shipping Desmos's proprietary `calculator.js` bundle and a public demo API key, is not
something a production product is licensed to do; the official embed is not subject to that
problem because it is never downloaded or redistributed, only framed). Desmos's own terms
govern use of that embedded page; nothing here makes a claim about them.

## The question bank itself — not a code dependency, and not covered by this file

`deploy/seed/sat/bank.jsonl.gz` (built by `python -m app.sat fetch | build`) is College
Board's own SAT Suite Question Bank content, fetched from College Board's public,
unauthenticated JSON endpoints. It is **data, not third-party code**, and its licensing
question is a distinct, unresolved risk (ADR 0044's Risk R0, owner decision O5) — whether
this content may be stored and served inside a commercial product at all. That question is
not a notice-and-attribution matter this file can close; it is recorded in ADR 0044 and is
not repeated here.
