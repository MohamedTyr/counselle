# ADR 0006 — Value-reading rules and provenance live in code (the citation envelope)

**Status:** Accepted

> **Old-data note (ADR 0032):** the core decision — never let the model parse a raw
> value, encode reading/honesty rules in code — still holds, but the specific R1–R12
> rules, the `{field,label,display,raw,available,unit,citation}` envelope shape, and
> the IPEDS/Scorecard/CDS trap catalog below describe the retired field store. The
> current honesty core is the packet anti-corruption boundary (typed values,
> availability states, compiled context/vintage, evidence, and a code-owned caveat
> catalog) — see `DATABASE_GUIDE.md` §5–§7.

## Context
The database is full of traps (`DATABASE_GUIDE.md` §6): `percent` is a 0–1 fraction; `control: 2` is a code; NULL ≠ missing; `*_all_institutions` is a national benchmark; earnings lag ~4–11 years (field-dependent); CDS is sparse. If the agent parses raw values and must remember the rules every turn, it will lie to a student. The PRD also requires citations for everything (official vs community) and data-recency awareness.

## Decision
Encode the value-reading rules and provenance **in code**, not in the model. Every value returned by any data tool is a **citation envelope**:

```jsonc
{ "field","label","display","raw","available","unit",
  "citation": { "source","tier","vintage","caveat","raw_table" } }
```

- A **normalization engine** implements the reading rules **R1–R12** (`DATABASE_GUIDE.md` §6): decode coded ints, ×100 percents, dollars (incl. valid negatives), strip int trailing zeros, native bools, title-case CDS enums, fix URLs, source-preference, NULL/missing → "not available", BBRR range-token detection, FTE≠headcount.
- A **vintage resolver** (`DATABASE_GUIDE.md` §9) attaches `{source, vintage, caveat}`.

## Rationale
- `display` is already correct, so the agent can't misread it; `raw` feeds visualizations; `citation` carries official/community tier + recency. Citations and recency thus fall out of the architecture.
- One structure serves citations, source-tiering, recency, and the visualization data feed.

## Consequences
- The normalization engine is the honesty-critical core — build once, TDD hard, with `DATABASE_GUIDE.md` §6 as its spec.
- DB and school-official-site results are `tier: official`; Reddit results are `tier: community`; generic web results are `tier: official` only for `.gov`/`.edu` domains, otherwise `tier: community` with a caveat to verify on the school's official site (ADR 0015).
