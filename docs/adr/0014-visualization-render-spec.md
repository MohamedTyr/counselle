# ADR 0014 — Visualizations: render-spec contract & data-provenance boundary

**Status:** Accepted (score_band removed — superseded on that point by ADR 0024; verified two-channel rendering amended by ADR 0032)

> **Amendment (ADR 0032):** the core data-provenance boundary below — numbers never
> round-trip through the LLM's tokens — still holds, but its mechanism is now verified
> two-channel rendering rather than citation-envelope field keys. A viz-v2 cell is
> either a verified metric ref (`<domain_id>.<metric_id>`) or profile ref, fetched by
> code through the packet/profile boundary; a registered external value carrying its
> own provenance; or explicit `unavailable`. There is no `search_fields` catalog, no
> "field ownership per viz" over legacy field keys, and no CDS-tier/score-band field
> menu — see `DATABASE_GUIDE.md` and ADR 0032 for the current contract. `RenderSpec`
> itself is further amended by ADR 0024 (closed set) and this note (open known/opaque
> seam).

## Context
The PRD requires the agent to show visualizations (tables, charts) — e.g. a 2-school comparison. Two questions were open: (1) the catalog of visualization types in scope, and (2) for each, **what data the AI provides vs. what the visualization gets automatically** — i.e. whether numbers flow through the LLM or come straight from the data layer. The data is the product and honesty is non-negotiable (principle 3), so where the numbers come from is a correctness decision, not a UI detail.

## Decision

**Three visualizations are in scope:**
1. **Dossier stat block** — a sectioned, cited fact card for one school (the wedge surface).
2. **Comparison table** — N schools × M fields, per-cell citation.
3. **Score-range band** — SAT/ACT middle-50% (25th–75th percentile) band(s).

Deferred: **net-price-by-income bars** (#4) and **admissions-factor weight grid** (#5).

**The data-provenance boundary (the core rule):** the **LLM decides the *shape*** (which schools, which fields, which chart type); a **tool fetches the *numbers*** straight from the citation envelopes (§5). **Numbers never round-trip through the LLM's tokens.** Two render paths, kept visibly distinct:
- **Official / DB-backed numeric** → tool-fetched, deterministic, precise. (All three in-scope viz.)
- **Community / qualitative** (Reddit, deep-research synthesis) → LLM-passed → rendered as an explicitly **community-tier qualitative card**, **never** a quantified chart. No fabricated "73% of redditors…" precision.

**Mechanism:** one tool — `render_viz(type, selection)`, `type ∈ {comparison_table, stat_block, score_band}`, `selection` = schools + field_keys (+ test for the band). It calls `counselle_db.service` **directly in-process** — never through the MCP child (eng-review D2; the MCP child is the seam for the LLM's tool loop only) — gets back **citation envelopes**, wraps them with `type`, and returns one **render spec (JSON)** whose cells *are* envelopes. The backend stages successful specs, dedupes equivalent ones, and emits the batch once when final-answer mode begins; the LLM receives only a small acknowledgment, not the numbers to repeat. The frontend has three **dumb components** that draw `display` + an official/community chip (from `tier`) and render `available:false` as "not available". Visualizations arrive in first-seen tool order within that final flush. No placeholder anchoring machinery was added.

**Field ownership per viz:**
- **#1 stat block & #2 comparison → the LLM picks the fields contextually** (what matters for *this* chat, not a fixed dump — otherwise it's a static page, not a thinking partner).
- **#3 score band → fields are fixed by the chart definition**; the LLM picks only the test (SAT/ACT/both) and the schools.

**Accuracy guarantee (KISS):** because values are *always* tool-fetched, the LLM cannot misstate a number. The only residual risk is picking the *wrong field for the concept*; that is bounded by — the LLM selects only **real catalog keys** (via `search_fields` / the static map); the tool **rejects unknown keys** (no phantom rows); the **R9 source-preference** already lives in the normalization layer; `available:false` degrades honestly; and the **eval set scores field-selection accuracy**. No separate concept→field resolver or flagging system is built — that would be low-value-and-hard.

## Rationale
- Tool-fetched numbers make "citations for everything" and "never misread a value" fall out for free — the envelope already carries `raw`, `display`, `tier`, `vintage`, `caveat`.
- Letting the LLM pick *fields* (but not *numbers*) is what makes the dossier a contextual answer instead of a static profile, while keeping values exact.
- One tool + one JSON contract + three dumb components is the smallest thing that works (principle 1).
- **No time-series / trend charts:** the DB holds a single vintage per source (no field has two years), so any trend line would be fabricated. Excluded.
- The score-band honesty trap is encoded in the tool: IPEDS SAT percentiles are **per section (EBRW, Math) and cannot be summed** into a 1600 composite — the band's field keys are **fixed in the tool definition** (sat → `admissions.sat_ebrw_25/75` + `admissions.sat_math_25/75` as two section rows; act → `admissions.act_composite_25/75`), never a fabricated composite, and the spec validator rejects one. The true composite exists only in CDS `c9_*` (~4 schools). ACT composite percentiles exist directly → a clean single band.

## Alternatives considered
- **LLM emits the numbers into a generic chart payload** — rejected: reintroduces the misread risk the normalization engine exists to kill.
- **Fixed-template dossier (code picks all ~90 fields)** — rejected: a complete dump is a static page; the chat's value is showing what matters for the current context.
- **Concept→field resolver + dangerous-sibling flagging to guarantee field choice** — rejected as enterprise over-engineering; the eval set catches wrong-field picks at far lower cost.
- **Quantified community sentiment chart** — rejected: false precision on a community source = lying to a student.
- **Per-viz anchoring / placeholder tokens for placement** — rejected: the final-answer flush preserves first-seen tool order without extra anchoring machinery (low-value-and-hard otherwise).

## Consequences
- A **minimal viz renderer** (three components) is in scope, because score bands need a drawing surface. Tables/stat-blocks also degrade to Markdown where no renderer exists.
- A new `render_viz` tool joins the agent's toolset; it is a thin wrapper over `counselle_db.service` (in-process, not through the MCP child).
- The eval set (ADR 0009 / ARCHITECTURE §19) gains a **field-selection-accuracy** dimension.
- Supersedes the visualization open questions in ARCHITECTURE §13 and §19 and the PRD "Visualizations" open question.
- Post-MVP2 correction: the earlier interleaved/tool-call-order placement is historical context; the live protocol batches viz specs at final-answer start.
- **R3 clarification (2026-09):** ADR 0032's amendment sanctioning model-typed `display`/`raw` for a registered external citation applies only to `web`/`edu` — it did not widen this ADR's community-quantification ban. `reddit` remains excluded from `SourcedCellInput`; a Reddit-sourced marker in a viz cell is rejected with a corrective reason steering the model to state it in prose instead.
