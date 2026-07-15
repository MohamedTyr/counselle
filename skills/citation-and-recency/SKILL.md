---
name: citation-and-recency
description: How to phrase citations, vintage strings, and recency caveats so students always know how fresh a fact is. Covers IPEDS/Scorecard/CDS vintage phrasing, the earnings-lag wording, provisional wording, the data calendar, and when to say "as of". Use whenever presenting facts from the database.
---

# Citation and Recency

Source: DATABASE_GUIDE §9, §6 R10; ARCHITECTURE §9, §16.

## The core principle

Every value you state is stamped with a citation marker `[n]` assigned by the source registry. Write the marker immediately after the fact. The citation panel (shown to the student as expandable markers) carries the full vintage string. Your job in prose is to add honest framing when the vintage matters — especially for earnings and provisional data.

## Vintage phrasing by source

### IPEDS (cycle_year = 2024)
Standard phrase: **"IPEDS 2024-25 (provisional)"**

Add "provisional" every time. IPEDS publishes twice per cycle: Provisional first (full data, may be revised), then Final ~2 years later. Current data is Provisional. This means enrollment, test scores, and admit rates may still be revised.

In prose: "Duke enrolled X undergraduates [1] — IPEDS 2024-25 data, provisional."

### IPEDS (cycle_year = 2023)
This covers financial aid data (SFA and Finance tables). Phrase: **"IPEDS 2023-24 financial-aid data"**

### Scorecard (cycle_year = NULL — all Scorecard fields)
Standard phrase: **"College Scorecard, published March 2026"**

The publication date comes from the filename in the data calendar. Always include it.

### CDS (cycle_year = 2024)
Standard phrase: **"2024-25 Common Data Set filed by the school"**

CDS data is self-reported by the institution. It describes the fall-2024 entering class. Note: only 8 schools have extracted CDS data today. When citing CDS, note it's self-reported.

### Web / .edu sources
Phrase format: **"Retrieved [Month DD, YYYY] (school's official site)"** or **"Retrieved [Month DD, YYYY] (live web)"**

The citation envelope carries the retrieval date. Use it.

### Reddit / community sources
Never phrase as a fact. Always: "students on Reddit say…", "community sentiment on r/[sub] suggests…". Tier is `community`. Never convert to a statistic.

## The earnings-lag wording (always required)

Scorecard earnings figures reflect students who **entered years ago**, not current students. The lag by field window:

- `earnings.*_4yr_*` → ~2022 entrants (publication year 2026 minus ~4 years)
- `earnings.*_6yr_*` → ~2020 entrants
- `earnings.*_10yr_*` → ~2016 entrants
- `earnings.*_11yr_*` → ~2015 entrants

**Required phrasing every time you cite earnings:** "This reflects students who entered around [year], not current students."

Example: "Median earnings 4 years after completion were $68,000 [3] — College Scorecard, published March 2026. These figures reflect students who entered around 2022; outcomes for today's students may differ."

Never omit this caveat. The student needs it to read the number correctly.

## The provisional wording (required for IPEDS)

Any IPEDS value may be revised. When the precision of a number matters (exact admit rate, exact enrollment), add: "(provisional — may be revised)".

For casual references ("Duke is highly selective"), the qualifier is implied and you do not need to repeat it every sentence. Use judgment.

## The data calendar — what each source covers

The temporal context block in your system prompt contains the live data calendar from the database. Use it to decide when to go to the web:

- **Within the source's cutoff**: answer from the DB, cite the vintage.
- **Beyond the cutoff** (e.g., this year's specific deadlines, a policy that changed since publication): go to the web. Use `search_school_site` for official current information.
- **Earnings**: always past data. State the entry cohort; do not pretend earnings reflect current conditions.

## When to say "as of"

Use "as of" for point-in-time facts that change over time:
- "As of IPEDS 2024-25 (provisional), the acceptance rate was 3.6%."
- "As of the March 2026 College Scorecard, median 10-year earnings were $X."

Do not use "as of" for things that are not expected to change (Carnegie classification, HBCU status, whether a school offers CS bachelor's degrees).

## Do not present national benchmarks as school-specific values

Results from `query_database` are aggregate/candidate-analysis rows, not per-value citations. Never present an aggregate as a school's own value. State the computed-as-of date and covered-school denominator, and re-fetch named final values through a typed read.
