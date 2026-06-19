# Deep Research Feature PRD

## Summary

Add a deep research mode to Counselle for complex college-admissions questions
that need planned multi-source work, explicit verification, and a longer
report-style answer.

The current normal path remains intact:

```text
prepare -> agent -> END
```

The feature adds a conservative route to a research subgraph:

```text
prepare -> route
           |-> agent -> END
           `-> deep_research_subgraph -> END
```

The research subgraph is DB-first and bounded:

```text
plan -> gather_db -> gather_external -> verify -> synthesize
```

Deep research is not a replacement for normal chat. Normal chat keeps handling
simple facts, ordinary comparisons, visualizations, clarifying questions, and
fast Tavily lookups. Deep research is for questions where one normal agent turn
is likely to be shallow, stale, or under-verified.

## Context

Counselle is an AI college-admissions counselor for student applicants. The
pipeline database is the product's factual backbone, and the agent is a
read-only consumer of that database.

Current shipped foundation:

- FastAPI backend with versioned SSE events.
- React/Vite frontend with activity timeline, citations, source panel, and
  source controls.
- LangGraph turn graph currently shaped as `prepare -> agent -> END`.
- PydanticAI counselor agent with DB MCP tools always available.
- Request-scoped `SourceConfig` controls external sources: `web`, `edu`,
  `reddit`, and `reddit_subreddits`.
- Tavily search tools are already source-gated in code. Disabled tools are not
  constructed.
- Source registry owns final citation metadata. The model repeats markers; it
  does not construct source metadata.
- `step`, `thinking`, `sources`, `usage`, and `done` events already provide the
  UI surface needed for longer work.

Design inputs:

- `docs/ARCHITECTURE.md` section 13.
- `specs/deep-research/plan.md`.
- `docs/adr/0009-deep-research-gpt-researcher.md`.
- `docs/research/deep-research-bakeoff.md`.
- Current LangGraph subgraph/streaming docs.
- Current GPT-Researcher MCP docs.
- Current PydanticAI usage-limit docs.
- Current Tavily Search and Extract docs.

## Problem

Normal chat is good for direct questions such as:

- "What is Duke's acceptance rate?"
- "Compare tuition at NYU and USC."
- "Search Vanderbilt's site for the current deadline."

It is weaker for questions like:

- "Compare Duke, Rice, and Vanderbilt for an international CS applicant who
  needs aid."
- "Research whether Northeastern's co-op program is actually valued by
  employers."
- "Build an application strategy for schools with strong merit aid in the
  Midwest."
- "Are these schools still test optional for the upcoming cycle?"

Those questions need decomposition, DB-first retrieval, targeted external
search, source-tier separation, explicit verification, and an answer that says
what is known, what is current, what is sentiment, and what could not be
verified.

Without a dedicated research path, the normal agent may either spend too much
inside one tool loop or answer with insufficient source grounding.

## Goals

- Produce trustworthy research reports for complex admissions questions.
- Keep Counselle DB as the primary source of truth.
- Use official school websites and external web sources only for current facts,
  policy freshness, program details, and DB gaps.
- Use Reddit only for student/community sentiment.
- Verify important claims before final synthesis.
- Enforce source controls in code.
- Bound cost and latency from the first implementation.
- Reuse the existing protocol, source registry, citation grammar, and UI.
- Integrate GPT-Researcher as a bounded helper, not as a hosted black box and
  not as the full experimental multi-agent app.

## Non-Goals

MVP deep research does not include:

- 20-school reports.
- Essay writing or editing.
- Hard-probability chancing.
- Browser automation.
- Unrestricted crawling.
- Autonomous background research jobs.
- Long-term memory or personalization dependency.
- Persistent storage of extracted web pages, chunks, or embeddings.
- A new frontend route or a new SSE protocol version.

## User Stories

1. As a student applicant with an open-ended question no single lookup answers,
   I want Counselle to run deeper research across the database, official sites,
   web, and optional Reddit so I get a synthesized multi-source answer.

2. As a student applicant, I want deep-research claims cross-checked before they
   are stated so that one stale or weak source does not become a fact.

3. As a student applicant, I want every research answer cited with the same
   source grammar as normal answers so I can see what came from Counselle data,
   official school sites, the web, or student sentiment.

4. As the operator, I want research bounded by source gates, time limits, model
   tiers, search/extract caps, and usage accounting so that one broad question
   cannot blow up cost.

## Trigger Rules

Use conservative routing.

Deep research should trigger when either:

- The user explicitly asks for "deep research", a "sourced report", a
  "comprehensive comparison", or an "application strategy report".
- The question is clearly complex enough to need planned multi-source work.

Auto-trigger examples:

- Multi-school, multi-factor comparisons.
- Current deadlines or policy status across one or more schools.
- Financial-aid, merit-scholarship, or international-aid research.
- International applicant policy comparisons.
- Strategic application planning across a short school list.
- Program-fit research that needs DB facts plus official pages.
- Student-sentiment synthesis when Reddit is enabled.

Do not trigger deep research for:

- Simple single-school facts.
- One-field DB lookups.
- Ordinary normal-chat follow-ups.
- Questions already answerable by the DB in one turn.

If the question is too broad or missing important scope, clarify before
research. Ask only for missing inputs that materially change the research:
schools, major, cycle/year, applicant type, aid/budget constraint, region, or
allowed sources.

## User Experience

Deep research runs in the same chat surface.

Progress appears through the existing timeline:

- Planning research.
- Checking Counselle data.
- Searching official sources.
- Searching the web, if enabled and needed.
- Checking student sentiment, if Reddit is enabled and needed.
- Extracting relevant pages, if needed.
- Verifying evidence.
- Writing the final answer.

Do not stream hidden chain of thought. Use short, user-facing work summaries.

The final answer should use this shape when applicable:

1. Short answer or recommendation.
2. DB-backed facts.
3. Current official findings.
4. Student sentiment, if used.
5. Unknowns, conflicts, or not-verified items.
6. Recommended next steps.

If research times out or hits caps, return a partial report that clearly says
what was verified and what was not completed.

## Source Policy

Source priority:

1. Counselle normalized database: IPEDS, Scorecard, CDS.
2. Official university websites and official school pages.
3. Government or official datasets surfaced through web search.
4. Reputable third-party web sources.
5. Reddit and forums for sentiment only.

Rules:

- DB is always available.
- `SourceConfig` remains the source-control contract.
- Disabled external sources must not be mounted or called.
- Disabled sources must never appear in final citations.
- Reddit cannot support quantitative claims, deadline claims, testing-policy
  claims, tuition/aid numbers, or official program facts.
- General web cannot override a DB or official source without explicit conflict
  language.
- If DB and official web conflict, surface the conflict and prefer the source
  that is more appropriate for the fact:
  - Use DB for normalized historical facts.
  - Use official school pages for current-cycle policy and deadlines.
  - State the date/source of each value clearly.

Do not add new citation source enum values in MVP. Existing source values are
enough:

- `ipeds`
- `scorecard`
- `cds`
- `web`
- `edu`
- `reddit`

Government and reputable web pages can use `web` with labels and caveats.

## Verification Policy

Verification is required before synthesis.

The verifier must inspect:

- Numbers.
- Dates.
- Deadlines.
- Admissions policy statements.
- Financial-aid and scholarship policy statements.
- Comparative claims.
- Strong recommendation claims.

Verification outcomes:

- `verified`: claim is supported by DB, official source, or acceptable web
  source.
- `conflict`: sources disagree; final answer must state the conflict.
- `unsupported`: omit or explicitly mark as not found.
- `sentiment_only`: may appear only in the sentiment section.

The final synthesis may use only verified claims, conflict statements, and
explicit unknowns. It must not turn unsupported draft text into final prose.

## Architecture

### Parent Graph

Add one routing node after `prepare`.

```text
START -> prepare -> route
                  |-> agent -> END
                  `-> deep_research_subgraph -> END
```

The normal agent node stays unchanged for normal turns.

### Research Subgraph

Use a small linear subgraph:

```text
plan -> gather_db -> gather_external -> verify -> synthesize
```

Node responsibilities:

- `plan`: classify scope, resolve intended schools when possible, choose
  subquestions, select source strategy, and enforce caps.
- `gather_db`: call existing `counselle_db.service` functions directly for
  authoritative envelopes and school metadata.
- `gather_external`: use source-gated Tavily search/extract and optionally a
  bounded GPT-Researcher adapter.
- `verify`: check key claims against gathered DB envelopes and extracted web
  snippets.
- `synthesize`: write the final cited answer using only verified evidence.

### GPT-Researcher Integration

Use GPT-Researcher as a bounded helper, not as the owner of the whole workflow.

Rules:

- Do not use GPT-Researcher's full multi-agent LangGraph app for MVP.
- Do not trust GPT-Researcher-generated citation metadata as final UI metadata.
- Do not let GPT-Researcher bypass `SourceConfig`.
- If GPT-Researcher cannot enforce the request's source gates cleanly, skip it
  for that run and use the direct Tavily pipeline.
- Counselle's `SourceRegistry` remains the source of truth for final citation
  markers and source metadata.
- DB context comes from Counselle service envelopes, not model-invented DB
  summaries.

The safest MVP shape:

- Research planning, DB gathering, verification, and final synthesis are owned
  by Counselle code.
- GPT-Researcher may help gather/summarize external context only within the
  allowed source set.
- Direct Tavily search/extract remains the fallback and may be the first
  implementation if GPT-Researcher integration friction is high.

## Settings

Add settings for deep research:

- `deep_research_enabled`: default `false` until implementation and evals pass.
- `deep_research_max_wall_clock_s`: default `90`.
- `deep_research_soft_timeout_s`: default `75`.
- `deep_research_max_schools`: default `4`.
- `deep_research_max_tavily_searches`: default `8`.
- `deep_research_max_tavily_extract_urls`: default `12`.
- `deep_research_max_final_sources`: default `12`.
- `deep_research_max_verified_claims`: default `30`.
- `deep_research_max_parallel_tasks`: default `4`.
- `deep_research_max_est_cost_usd`: default `1.00`.
- `model_research_fast`: default to the cheap model.
- `model_research_smart`: default to the counselor model.
- `model_research_verifier`: default to the cheap model unless evals show it is
  too weak.
- GPT-Researcher model-tier environment mapping, if used:
  - `FAST_LLM`: cheap model.
  - `STRATEGIC_LLM`: cheap model.
  - `SMART_LLM`: strong model.

## Public Interfaces

No new public API is required for MVP.

Keep:

- `POST /v1/sessions/{id}/messages`.
- Current `SourceConfig`.
- Current SSE event types.
- Current transcript model.

Protocol notes:

- Use `step.kind = "research"` for research phases.
- Continue emitting `sources` before `done`.
- Continue emitting `usage` when available.
- Populate `UsageData.est_cost_usd` when the research run has a usable
  estimate.
- Keep source markers as `[n]` in final prose.

## Failure Behavior

If DB fails:

- Do not run a normal-looking research report.
- Tell the user DB-backed verification is unavailable and return an error or a
  limited answer, depending on what failed.

If Tavily fails:

- Continue with DB-only research if useful.
- Say external/current-source search was unavailable.

If Reddit is disabled:

- Do not call Reddit.
- Do not cite Reddit.
- Do not mention Reddit findings from prior context.

If web or edu is disabled:

- Do not call those tools.
- Final answer must not include those source types.

If the question is too broad:

- Ask a clarifying question instead of starting an expensive run.

If caps are hit:

- Stop gathering.
- Verify what was gathered.
- Return a partial verified report with a clear limitation.

If verification finds conflicts:

- Show both sources where allowed.
- Explain which source is more appropriate for the claim.
- Avoid overclaiming.

## Acceptance Criteria

Functional:

- Normal questions still route to the existing agent path.
- Explicit deep-research requests route to the research subgraph.
- Obvious multi-school/current-policy strategy questions route to research.
- Source config gates are honored in every research node.
- Research progress appears in the existing activity timeline.
- Final answers use existing inline citation markers and source panel metadata.

Honesty:

- Every numeric/date/policy claim in the final answer is verified or caveated.
- Reddit is never used as factual proof.
- Disabled sources never appear in final citations.
- DB envelopes remain the authority for DB-backed values.
- Conflicts are surfaced, not hidden.

Cost and latency:

- Max wall-clock, search, extract, source, school, and cost caps are enforced.
- Timeout returns a partial honest answer, not an uncaught failure.
- Usage event includes token/tool usage and estimated cost when possible.

Regression:

- Existing normal-chat tests continue to pass.
- Existing source-control behavior is unchanged for normal turns.
- Existing frontend protocol validation does not need a version bump.

## Implementation Plan

### Phase 1: PRD and Docs

- Keep this PRD in `plans/deep-research/` while the feature is active work.
- Add an implementation plan next to it if the work is split across sessions.
- Graduate final docs to `specs/deep-research/` only after build and evals pass.

### Phase 2: Settings and Routing

- Add deep-research settings with conservative defaults.
- Add a `route` node after `prepare`.
- Implement conservative routing with deterministic rules first.
- Keep ambiguous cases on normal chat or clarify.
- Add graph tests proving normal path behavior is unchanged.

### Phase 3: Research State and Progress

- Extend `TurnState` with msgpack-plain research keys only if needed.
- Add helpers to emit `research` step start/end/error chunks.
- Add timeline labels for research phases in `config/assets/step_labels.yaml`.
- Avoid a new SSE event type.

### Phase 4: DB-First Gather

- Implement `gather_db` using `counselle_db.service` directly.
- Resolve schools through existing service logic.
- Use typed envelopes returned by existing service functions.
- Register DB citations through the existing `SourceRegistry`.
- Prefer existing dossier, compare, values, programs, diversity, and benchmark
  service functions before custom SQL.

### Phase 5: External Gather

- Reuse Tavily source gating patterns from `app/toolset.py`.
- Add extract support only if needed for official pages where snippets are not
  enough.
- Use Tavily `include_domains` for school-site searches and Reddit allowlists.
- Use `exclude_domains` to keep Reddit out of open web when Reddit is disabled.
- Try GPT-Researcher as an adapter only after direct source-gated retrieval is
  working.

### Phase 6: Verification

- Define structured internal models for planned questions, evidence chunks,
  draft claims, verification results, conflicts, and unknowns.
- Use a verifier agent with strict structured output.
- Verify top factual claims against raw DB envelopes and extracted passages.
- Drop or caveat unsupported claims before synthesis.

### Phase 7: Synthesis

- Generate a concise report from verified claims.
- Use source markers already registered in `SourceRegistry`.
- Separate DB facts, current official findings, sentiment, unknowns, and
  recommendations.
- Do not ask the synthesizer to invent citation metadata.

### Phase 8: Evals and Hardening

- Add research eval cases without expanding MVP scope.
- Add source-isolation tests.
- Add cost/cap tests.
- Add live smoke checks only after routine tests pass.
- Keep `deep_research_enabled` off until evals pass.

## Test Plan

Routine command:

```bash
uv run pytest -m "not live_llm and not live_search and not live_db"
```

Coverage visibility:

```bash
uv run pytest -m "not live_llm and not live_search and not live_db" --cov --cov-report=term-missing
```

Frontend checks if protocol fixtures or UI labels change:

```bash
cd frontend && npm run typecheck && npm test
```

Targeted test cases:

- Router sends simple fact questions to normal agent.
- Router sends explicit deep-research requests to research subgraph.
- Router sends obvious multi-school strategy questions to research subgraph.
- Too-broad research asks clarify instead of spending.
- Web disabled means no web search/extract calls and no web citations.
- Edu disabled means no school-site calls and no edu citations.
- Reddit disabled means no Reddit calls and no Reddit citations.
- Reddit enabled can produce sentiment but not quantitative facts.
- Research caps stop gathering and return partial verified output.
- Timeout produces honest partial report.
- Verifier rejects unsupported numbers, dates, and policy claims.
- Verifier surfaces DB-vs-official-web conflicts.
- Final synthesis contains no unregistered citation markers.
- `sources` event resolves every inline marker.
- `usage` event is present when model usage is available.

Eval additions:

- Multi-school comparison: "Compare Duke, Rice, and Vanderbilt for an
  international CS applicant who needs aid."
- Current-policy question: "Are BU and Northeastern test optional for the
  upcoming cycle?"
- Aid policy: "Research international financial aid at NYU, USC, and Miami."
- Program-fit report: "Research whether Northeastern co-op is a strong reason
  to apply for CS."
- Sentiment-only Reddit case: "What do students say about campus culture at UC
  Berkeley?"
- Disabled-source isolation case for each external source.
- Contradiction case where DB vintage and official current page differ.
- No-source case where the answer must say no authoritative evidence was found.

## Open Questions

- Whether GPT-Researcher should be added in the first implementation slice or
  after direct Tavily research is working.
- Whether verifier should start on the cheap model or use the strong model for
  policy/deadline-heavy claims.
- Whether the UI needs a visible "Deep research" toggle later. MVP can rely on
  explicit user language and conservative routing.

## Assumptions

- Conservative auto-triggering is the MVP default.
- Existing frontend protocol support for `step.kind = "research"` is enough for
  the first version.
- Counselle's source registry remains the final citation authority.
- GPT-Researcher is useful only if it can be bounded by the same source controls
  and cost caps as the rest of the app.
- Large extracted web content is not persisted in MVP.
