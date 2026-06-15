# ADR 0024 — Remove the `score_band` visualization

**Status:** Accepted

**Supersedes:** ADR 0014 on the viz catalog (the score-band member and its honesty validator only; the render-spec contract and provenance boundary stand).

## Context

ADR 0014 put three visualization types in scope: the dossier stat block, the comparison table, and the SAT/ACT middle-50% **score band**. The score band shipped (MVP1 story 33) and was iterated on visually.

In practice it earned its complexity nowhere: every fact it shows — the 25th/75th section percentiles, the test policy, the average — is a small set of numbers that a **stat block** already presents honestly, or that prose already narrates with the required "middle 50%, not a cutoff" teaching line. The bespoke band renderer, its fixed-field tool path, the `ScoreBand` model, and the §17 row-mixing validator were carrying a chart that added no expressive power over the two general-purpose viz types. Per the value × ease rule, a low-value surface with real maintenance weight is a cut.

## Decision

**Remove `score_band` entirely.**

- `RenderSpec.type` narrows to `stat_block | comparison_table`. The `ScoreBand` model and the `band` field are deleted; `render_viz` drops the `test` parameter and the fixed band-row tables.
- The frontend `ScoreBandCard` (and its sole-consumer helper `SchoolChip`) are deleted; the `viz`-type dispatch and metadata drop the case.
- Test scores (SAT/ACT middle-50% ranges, test policy, average) are presented **in prose or folded into a stat block**.
- The **SAT-composite honesty rule** — never sum EBRW + Math into a 1600 — was enforced twice: by the `score_band` tool's validator and by prose discipline. With the validator gone, the rule survives as explicit guidance in the counselor prompt and the dossier-assembly skill ("keep EBRW and Math separate — never a composite"). The honesty guarantee is unchanged for the student; only its enforcement point moved from a tool the LLM rarely needed to the prompt it always reads.

## Consequences

- One fewer card to render, test, and keep on-brand. The `render_viz` tool surface and the `RenderSpec` wire contract shrink by one member; clients that ever receive an unknown type still degrade to the markdown fallback (PRD story 35), so older clients are unaffected.
- ADR 0014's body is left intact as the historical record of the original three-viz decision; only its Status notes this supersession. `docs/ARCHITECTURE.md` §17 is updated to describe two viz types.
- If a dedicated score-range visual is ever wanted again, it returns as a new, additively-typed card — not by reviving this one.
