# ADR 0002 — The agent works on any school in the database; "tracked" = CDS-coverage tier

**Status:** Accepted (revised 2026-06-09 — supersedes the original "tracked-schools-only" decision)

> **History:** this ADR originally restricted the agent to `is_tracked = true` schools (8 today). That scope gate is **removed**. The agent now works on **any school in the `schools` table**, and `is_tracked` is repurposed as a **data-richness signal**, not a boundary.

## Context
The DB holds **2,746 schools** (curated, active, 4-year, Title-IV — *not* the full 6,072-institution IPEDS universe). Nearly all have **IPEDS + Scorecard** coverage (~98% Scorecard). A small subset additionally has **CDS** data — the deep admissions-process layer (factor weights, test policy, GPA distribution, ED/EA dates, waitlist). The pipeline marks schools `is_tracked = true` to select them for CDS collection.

Restricting the agent to the 8 tracked schools made the product artificially narrow: a student asking about almost any real US college got an out-of-scope refusal, even though we hold rich IPEDS/Scorecard data for it. The wedge ("deep school dossier on demand") works for *any* school — it's just *deepest* where CDS exists.

## Decision
1. **The agent works on any school in the `schools` table (2,746).** No `is_tracked` gate on the data tools. Comparisons, lists, research, and dossiers may include any in-database school.
2. **"Tracked" is redefined as a CDS-coverage tier**, surfaced to the agent so it knows how deep it can go and sets honest expectations:
   - **Base** — IPEDS + Scorecard only (≈ all schools).
   - **CDS-tracked** — a CDS PDF exists. Two sub-states: **extracted** (structured CDS fields — 8 schools, 218–249 fields each; the deepest tier) and **PDF-only** (a downloaded CDS PDF with no extracted values yet, e.g. Stanford — structured CDS not available, but we know a CDS exists).
3. **The real boundary is now "in our database or not."** A school absent from the `schools` table (e.g. a 2-year college, or one outside the curated set) gets a graceful **"not in our database"** response — we cover curated 4-year US institutions and never claim the full universe.

## Rationale
- The product position becomes "works everywhere, deepest where CDS exists" — far more useful to a student than an 8-school sandbox.
- IPEDS/Scorecard already answer most "what does it take to get in / what does it cost / what are outcomes" questions for ~all schools; CDS is a depth bonus, not a prerequisite.
- Honesty is preserved by **awareness, not exclusion**: the agent knows a school's tier (from *actual* CDS data presence, not just the flag — `extract_status='done'` ≠ values exist; the Stanford trap) and tells the student when deep CDS detail isn't available.

## Implementation
- **Tools no longer filter `is_tracked`.** `resolve_school` resolves any in-database school; if not found, return the "not in our database" signal. The SQL escape hatch drops the mandatory `is_tracked` predicate (read-only enforcement via `counselle_ro` remains — ADR 0012).
- **Coverage tier is computed from real data**, not the flag: presence of extracted CDS `field_values` → extracted tier; a `cds_files` PDF with no values → PDF-only; neither → base. (See `DATABASE_GUIDE` §14.6.) The agent surfaces this depth in the dossier / data calendar.
- **Read live**, never hardcoded — tiers update automatically as the pipeline ingests more CDS.

## Consequences
- **Deep-research cost is no longer bounded by school count** (was ~8, now up to 2,746). Cost control now rests entirely on the *other* levers (ADR 0009): **DB-first** (a dossier for a non-CDS school still comes mostly from IPEDS/Scorecard with no web spend — web only fills genuine gaps), depth/breadth caps, cheap-model routing, and caching. Watch this.
- The CDS-sparsity caveat in `DATABASE_GUIDE` now applies broadly: for most schools the agent leans on IPEDS/Scorecard and must say so when a student asks for CDS-only detail (e.g. factor weights) that isn't available.
- The factor-weight-grid visualization (deferred, ADR 0014) only renders for extracted-CDS schools; the score band and everything IPEDS/Scorecard-backed works for all schools.
