# Counselle — MVP1 PRD

> **Status:** MVP1 scope locked (pre-code). This is the complete product requirements document for MVP1 — what we're building and why. The *how* lives in `docs/ARCHITECTURE.md` and the ADRs in `docs/adr/`; the data the agent reads is documented exhaustively in `docs/DATABASE_GUIDE.md`.
>
> **The ultimate goal:** the perfect AI agent for thinking about, and answering anything about, any university or school — able to think, take steps, reason about those steps, and take further actions.
>
> **MVP1 in one line:** a thing to think with and to answer your questions about any school — with real depth, total honesty, and a citation on everything.

---

## Problem Statement

A student applying to US colleges is drowning in fragmented, stale, and untrustworthy information. The facts that decide their future — what it really takes to get in, what a school will actually cost *them*, what graduates actually earn, what campus life is actually like — are scattered across IPEDS spreadsheets, College Scorecard data files, Common Data Set PDFs, school marketing pages, and thousands of Reddit threads. None of these speak the student's language, none of them are combined, and the tools that do combine them (rankings sites, chatbots) routinely present stale numbers without dates, national benchmarks as school-specific values, marketing as fact, and Reddit hearsay as truth.

The student's questions are also rarely well-formed. "Is NYU good?" is unanswerable without knowing *good for what* — major, cost, vibe, selectivity. A search box returns something anyway; a good counselor asks first. Most students don't have a good counselor.

The result: high-stakes decisions made on bad or misread information, by the population least equipped to detect when a number is wrong, outdated, or not about them at all.

## Solution

**Counselle MVP1 is an honest, cited, college-knowledge agent for student applicants** — a thinking partner that answers anything about any of the ~2,746 4-year US institutions in our database, fusing four sources into one answer:

1. **Our structured database** — up to ~1,000 fields per school from a 1,093-field catalog (IPEDS, College Scorecard, and extracted Common Data Set), always on, always first.
2. **The live web** — for anything beyond the data's cutoff.
3. **The school's own .edu site** — current deadlines, policies, programs (official).
4. **Reddit communities** — campus vibe and lived experience (community-tier, never cited as fact).

The signature experience (the wedge): **the deep school dossier on demand.** Ask about any one school and get a complete, sectioned, cited, honest profile — admissions and selectivity, cost and aid, outcomes and earnings, academics and majors, student body and campus life — with every value dated, sourced, and tiered official vs community.

Around the wedge, the agent can compare schools side by side, filter and rank across the whole database ("public schools in California under 30% admit rate"), run deep research with a verification pass for open questions, render honest visualizations, and — critically — **ask a clarifying question before guessing** when the question is underspecified.

What makes it different is a single non-negotiable: **never lie to a student.** Every value is decoded and formatted by code (never re-typed by the model), stamped with its source and vintage, tiered official vs community, and rendered "not available" rather than invented. The agent knows the date of its own data, knows today's date and where we are in the admissions season, and says what it doesn't know.

**MVP1 ships on a deliberately minimal web chat**: a plain chat page carrying the message stream, the three visualization components, the clarifying-question widget, and the source-control dropdown. No design effort beyond that — the agent is the product; the polished UI is a later phase.

---

## User Stories

### The wedge: the school dossier

1. As a student applicant, I want to ask about any school and get a complete, sectioned profile (admissions, cost, aid, outcomes, earnings, academics, student body), so that I understand a school deeply without visiting ten websites.
2. As a student applicant, I want the dossier to show the facts that matter *for my question* rather than a fixed dump of every field, so that it reads like an answer from a counselor, not a database printout.
3. As a student applicant, I want every number in the dossier to carry its source and date, so that I can trust it — or know exactly how much to trust it.
4. As a student applicant, I want the dossier to fuse community sentiment (what students on Reddit actually say about the school) alongside the official numbers, clearly marked as community voice, so that I get the lived reality, not just statistics.
5. As a student applicant asking about a school we don't carry (a 2-year college, a school outside the curated set), I want a graceful "not in our database" answer instead of a fabricated profile, so that I'm never misled by invented data.

### Asking questions and getting honest answers

6. As a student applicant, I want to ask anything about a school in plain language ("does Duke require SAT scores?", "how much will Michigan cost if my family makes $60k?"), so that I don't need to know what IPEDS or a CDS is.
7. As a student applicant, I want the agent to answer from its database first and only go to the web when the database can't answer or is stale, so that answers are fast, consistent, and grounded in vetted data.
8. As a student applicant, I want the agent to *teach as it answers* — explaining terms like "yield," "demonstrated interest," "need-blind," "middle-50%" when they come up, so that I learn the process while getting my answer.
9. As a student applicant, I want honest answers about selective schools that are kind in tone but never inflate or soften the numbers, so that I can plan realistically without being crushed or deceived.
10. As a student applicant, I want the agent to tell me when a value simply isn't available for my school (e.g. CDS factor weights for a school that hasn't filed extractable CDS data) and fall back to the best available source, so that absence of data is never papered over.
11. As a student applicant, I want the agent to never present a national benchmark as my school's own value (e.g. the "all institutions" earnings figures), so that I'm not comparing my school against itself.
12. As a student applicant, I want negative net-price values, privacy-range tokens, coded values, and other data quirks handled correctly behind the scenes, so that I see "your grants would exceed cost" instead of "-$2,536" and never see a raw code like "control: 2".

### Clarifying questions

13. As a student applicant who asks something underspecified ("is NYU good?"), I want the agent to ask me a short clarifying question with tappable options (plus a free-text "Other"), so that the answer is about *my* situation instead of a generic average.
14. As a student applicant, I want clarification only when my answer would *materially change* the response — one focused round, 2–4 options, never an intake form — so that the agent feels like a sharp counselor, not a survey.
15. As a student applicant, I want the agent to state its assumption and answer anyway when one reading of my question is clearly likeliest ("Assuming undergrad CS — … if you meant something else, tell me"), so that I'm never blocked by needless questions.
16. As a student applicant, I want to be able to ignore the option chips and just type a normal reply, so that the chat always stays a chat.
17. As a student applicant, when a clarifying question resolves what matters to me ("cost & affordability"), I want the subsequent answer and any comparison table to be built around those dimensions, so that my answer reflects what I said.

### Comparing and finding schools

18. As a student applicant, I want to compare two or more schools side by side on the dimensions I care about, with a citation on every cell, so that I can weigh them honestly.
19. As a student applicant, I want to filter and rank across the whole database ("private schools in the Northeast with strong CS and admit rates above 40%"), so that the agent helps me *build* a list, not just react to one.
20. As a student applicant, I want to ask how a school compares to the national picture ("is a 78% graduation rate good?"), so that numbers have context.
21. As a student applicant, I want comparisons to handle missing values honestly (a cell reads "not available," never a guess), so that gaps in the data are visible rather than filled in.

### Programs, majors, money, and outcomes

22. As a student applicant, I want earnings and debt *by major* at a given school, so that I can weigh what studying X at Y actually leads to.
23. As a student applicant, I want net price by family income band — not just sticker price — so that I know what a school costs people like me.
24. As a student applicant, I want graduation, retention, and loan-default rates presented plainly, so that I see outcomes, not just inputs.
25. As a student applicant, I want earnings figures to come with their honest caveat (they reflect students who entered ~a decade ago, not current students), so that I read them correctly.
26. As a student applicant, I want the student-body picture — size, demographics, diversity breakdown — so that I can tell whether I'd belong there.

### Test scores, admissions process, and the season

27. As a student applicant, I want a school's test policy and middle-50% SAT/ACT ranges shown as the enrolled cohort's range (with the agent teaching that it's not a cutoff), so that I interpret scores the way admissions offices do.
28. As a student applicant at a school with extracted CDS data, I want the deep admissions-process layer — factor weights, GPA distribution, early-decision dates, waitlist statistics — so that I understand *how* that school actually decides.
29. As a student applicant, I want the agent to know today's date and where we are in the admissions calendar (in June: list-building and essay prep; in October: ED/EA deadlines looming), so that advice is grounded in *now*.
30. As a student applicant, I want current-cycle, school-specific dates (this year's deadlines) fetched live from the school's site rather than assumed from old data, so that I never miss a deadline because of a stale snapshot.
31. As a student applicant, I want "this year" and "next year" resolved to the correct entering class, so that the agent and I are always talking about the same cycle.

### Community voice (Reddit)

32. As a student applicant, I want the agent to bring in what students actually say — campus vibe, dorm quality, social scene, workload — from the *right* communities for my question, so that I get texture no spreadsheet has.
33. As a student applicant, I want community claims always labeled as community sentiment and never converted into fake statistics ("73% of redditors say…"), so that vibe stays vibe and facts stay facts.
34. As a student applicant, I want the agent to pick relevant subreddits per question (the general admissions sub for process questions, the school's own sub for campus life, the financial-aid sub for money questions), so that community input is on-topic.

### Citations and trust

35. As a student applicant, I want every factual claim to carry a lightweight inline citation marker with an official/community chip, so that the answer stays readable while nothing is unsourced.
36. As a student applicant, I want to expand any citation marker to full detail — source, data vintage, caveats — so that transparency is one tap away when I want it.
37. As a student applicant, I want official sources (the database, the school's own site) visually distinct from community sources (Reddit), so that I always know which kind of claim I'm reading.
38. As a student applicant, I want every value dated ("IPEDS 2024-25 provisional", "College Scorecard, published Mar 2026"), so that I know how fresh each fact is.

### Deep research

39. As a student applicant with an open-ended question no single lookup answers ("how is Northeastern's co-op program actually viewed by employers?"), I want the agent to run deep research across the database, web, the school's site, and Reddit, so that I get a synthesized, multi-source answer.
40. As a student applicant, I want deep-research claims cross-checked across sources before they're stated (the verification step), so that a single bad source doesn't become my "fact."
41. As a student applicant, I want deep-research results cited the same way as everything else (official vs community, dated), so that research output is held to the same honesty bar.

### Source control

42. As a user, I want a dropdown to enable/disable the agent's external sources — web, Reddit, .edu — per request, so that I control where answers come from (the database is always on).
43. As a user, I want per-community Reddit toggles, so that I can limit which subreddits the agent may draw from.
44. As a user, I want disabled sources to be genuinely unreachable by the agent (enforced in code, not by a polite instruction) and absent from citations, so that the control is real.

### Visualizations

45. As a student applicant, I want a sectioned, cited stat-block card when I ask about one school, so that the dossier's key facts are scannable.
46. As a student applicant, I want a comparison table for multi-school questions, with each cell carrying its own citation and "not available" where data is missing, so that side-by-side comparison is honest at the cell level.
47. As a student applicant, I want an SAT/ACT middle-50% score band rendered as a visual range (SAT shown per section, never as a fabricated 1600 composite; ACT as a clean composite band), so that I see where the enrolled class actually landed.
48. As a student applicant, I want every number in any visualization to come from the data layer, never re-typed by the model, so that a chart can't contain a hallucinated value.
49. As a student applicant, I want community/qualitative content rendered as a clearly-labeled community card, never a quantified chart, so that visual authority matches data authority.
50. As a student applicant, I want no trend/time-series charts when the data holds only one year (any trend line would be fabricated), so that visual honesty matches verbal honesty.

### Conversation and session

51. As a student applicant, I want the agent to remember what I said earlier in the session (my intended major, the schools we've discussed, my clarifying-question answers), so that I never repeat myself within a conversation.
52. As a student applicant, I want multi-step questions handled with visible reasoning steps (resolve the school → fetch facts → research gaps → verify → answer), so that complex questions get real work, not one-shot guesses.

### Operator / developer stories

53. As the operator, I want the default model provider and per-agent models configured via environment (default: Vertex AI Gemini 2.5 Pro, cheap tier Flash), swappable to any provider without code changes, so that we're never locked to one vendor.
54. As the operator, I want deep research bounded by cost levers — DB-first routing, depth/breadth caps, cheap-model tiers — so that an unbounded school count can't blow up spend.
55. As the operator, I want the agent's database access to be strictly read-only with hard guardrails (dedicated role, statement timeout, row cap), so that the agent can never harm the pipeline's data.
56. As a developer, I want agent workflows authored as portable skills (the open SKILL.md standard) loaded on demand, so that the agent's procedural knowledge is editable, versionable, and not vendor-locked.
57. As a developer, I want a new field added by the pipeline to be discoverable by the agent immediately and automatically, so that data growth never requires manual agent updates.
58. As a developer, I want an eval set (~50 university questions with known answers) measuring citation accuracy and field-selection accuracy, so that honesty regressions are measurable before students see them.

---

## Implementation Decisions

These decisions are **already made and locked** (each has an ADR — see `docs/adr/README.md`). The PRD records them at the product level; the full technical elaboration lives in `docs/ARCHITECTURE.md` and will be refined in the upcoming architecture/planning pass. No *new* architectural decisions are made in this document.

**Scope and coverage**

- **Primary user is the student applicant**; the agent's personality, defaults, and feature priority are tuned for a student. (ADR 0001)
- **MVP1 is the informational layer only** — think + answer. The "doing" layer (chancing, personalization, writing) is deliberately deferred; the retrieval layer is built so those can stack on top later. (ADR 0001)
- **The agent works on any school in the database (~2,746 curated 4-year US institutions).** There is no tracked-school gate. "Tracked" is repurposed as a **CDS-depth tier** — *base* (IPEDS + Scorecard), *CDS-extracted* (deepest; 8 schools today), *CDS PDF-only* — computed from actual data presence, read live, and surfaced to the agent so it sets honest expectations instead of refusing schools. The only hard boundary is in-the-database-or-not. (ADR 0002)

**Honesty (the carve-out that overrides startup speed)**

- **Value-reading rules and provenance live in code, never in the model's head.** The database is a minefield (fractions stored 0–1, coded integers, NULL semantics, national-benchmark traps, earnings lag); a normalization engine implementing the twelve reading rules (R1–R12, specified in `docs/DATABASE_GUIDE.md` §6) decodes, scales, formats, and dates every value before the model sees it. (ADR 0006)
- **Every value travels as a citation envelope**: display string, raw numeric, availability flag, source, official/community tier, vintage, caveat. Citations, source tiering, recency awareness, and the visualization data feed all fall out of this one structure. (ADR 0006)
- **Numbers never round-trip through the model.** For visualizations, the model decides the *shape* (which schools, which fields, which chart); a tool fetches the *numbers* directly from envelopes. Community content renders as a qualitative community card, never a quantified chart. No time-series charts while the data holds a single vintage. (ADR 0014)
- **Recency is first-class**: per-value vintage on every envelope; an always-available data calendar of each source's cutoff; today's date injected by the runtime; the admissions season computed deterministically from the date. Time-sensitive questions route to the web instead of trusting the snapshot. Season awareness is context, not a deadline tracker.
- **Read-only database access** via a dedicated role with statement timeout and row cap — the agent can never write to the pipeline's data. (ADR 0012)

**Data access**

- Database access is a standalone MCP server with **three layers**: field discovery (so 1,093 fields never overwhelm), safe typed tools for the 90% path (resolve school, fetch values, dossier, compare, find/filter, programs, diversity), and a guarded read-only SQL escape hatch for the long tail. Parameterized SQL only. (ADRs 0004, 0005)
- **Field discovery is hybrid**: a compact always-loaded category map for the common path plus semantic search over the long tail, with a self-healing index and a keyword fallback so a newly added field is never invisible. (ADRs 0007, 0008)

**External sources**

- **All three external searches (web / .edu / Reddit) are one search backend — Tavily — scoped by domain**, as three thin tools. Nothing is scraped by us. The .edu tool is pinned to the school's stored site URL (official tier); **Reddit is agent-steered** — the agent picks the relevant subreddit(s) per question from a labeled menu (community tier, never cited as fact). (ADR 0015)
- **DB-first**: external search fires only when the database can't answer or is stale per the data calendar. This is also the primary cost lever.
- **Source control is per-request and enforced in code**: a source-config object (web on/off; Reddit on/off + per-subreddit allowlist; .edu on/off; DB always on) gates which tools the agent can reach. A disabled source is unmountable and never appears in citations. (ADR 0013)

**Deep research**

- Deep research is **GPT-Researcher embedded as a subagent** — chosen over hosted research black boxes because our database must be a first-class source, with our model routing and our source tiering. Cost-controlled by cheap-model tiers, depth/breadth caps, and DB-first routing. We add source-type tagging and a **verification pass** (cross-check top cited sources before stating a fact). (ADR 0009)

**Runtime and configuration**

- **Runtime: PydanticAI (agents, typed outputs = the citation envelope) + LangGraph (orchestration, in-session memory via state, clarifying questions via interrupt)**. Model-agnostic by construction. (ADR 0003)
- **Clarifying questions are a typed spec rendered by a dumb widget** — question + 2–4 option chips with hints + an always-present "Other" free text; multi-select when natural. The judgment rule: clarify only when the missing detail materially changes the answer and there's no sensible default; otherwise assume-and-state, or just answer. One round max; the chips are a shortcut, not a modal — a typed reply always works.
- **Models are configured per-agent via environment; default provider Vertex AI (Gemini 2.5 Pro; Flash for the cheap tier)**, swappable to Anthropic or any provider with no code change. (ADR 0011)
- **Skills are authored in the open SKILL.md standard**, loaded on demand; skills are the workflow layer, MCP the transport layer. (ADR 0010)
- **Counselle is an independent service.** It shares only credentials (read-only DB connection, Vertex/GCP keys) with the data pipeline — no shared code, config, or runtime dependency. The database is the contract.

**MVP1 surface (decided in this PRD)**

- **MVP1 ships a deliberately minimal web chat**: message stream, the three dumb visualization components, the clarifying-question widget, and the source-control dropdown. Zero design ambition — just enough surface to make every MVP1 behavior real and demoable. Visualizations degrade to Markdown where no renderer exists. The polished product UI is a later phase.
- **Citation UX (resolved here, was the last open product question): inline expandable markers.** Each claim carries a lightweight inline marker with an official/community chip; expanding it reveals full source detail (source, vintage, caveat). Clean reading by default, full transparency one tap away, nothing hidden.

**Visualizations (MVP1 catalog)**

- **Three ship in MVP1**: the dossier stat block, the comparison table (per-cell citations), and the SAT/ACT middle-50% score band (SAT per section — never a fabricated composite; ACT composite directly). **Deferred**: net-price-by-income bars, admissions-factor weight grid. Placement follows tool-call order; one render-spec contract; dumb components. (ADR 0014)

## Testing Decisions

Startup mode: test where lying to a student is possible; skip ceremony everywhere else. Tests assert **external behavior, never implementation details**.

- **The normalization engine is the honesty-critical core and gets the full TDD treatment.** `docs/DATABASE_GUIDE.md` §6 (rules R1–R12, the data-type semantics, the sentinel/range-token and source-preference tables) *is* its spec — every rule becomes at least one behavioral test (fraction→percent, coded-int decode vs plain-int passthrough, NULL/missing → "not available", negative currency preserved, range tokens never arithmetic'd, FTE never shown as headcount, URL scheme fixing, national-benchmark fields never presented as school values, vintage attached).
- **The eval set is the agent-level test**: ~50 university questions with known answers, scoring citation accuracy, field-selection accuracy (the wrong-field-for-the-concept risk in visualizations), and clarify-vs-assume judgment. It is an engineering tool for finding regressions — **no formal numeric launch bar is set for MVP1**; we ship on judgment.
- **No golden-test or contract-test machinery in MVP1** (deliberately dropped as enterprise-ish for a prototype): tool outputs and the render/clarify spec shapes are validated by their typed schemas at runtime, which is enforcement enough at this stage.
- **No UI-level testing in MVP1** — the minimal chat surface is not the product under test; the agent is.
- Prior art: none in this repo (greenfield). The pipeline repo's test conventions apply only as loose inspiration; this service tests independently.

## Out of Scope (deferred, deliberately)

- **Chancing** — no admission-odds math against a student's profile. (MVP1 ships the chancing *knowledge* — test ranges, factor weights, acceptance rates — without the personal *math*.)
- **User personalization & long-term memory** — no stored user profile, no cross-session memory. In-session working memory only.
- **Essay and activity writing** — the entire "doing" layer.
- **Process management** — no deadline tracking, no task lists, no "walk me through my application." MVP1 answers about the process; it doesn't manage yours.
- **Schools outside the database** — 2-year colleges, non-US institutions, and anything outside the curated set get the honest "not in our database" response, not best-effort guessing.
- **Polished product UI** — MVP1's chat surface is deliberately minimal; the real UI is a later phase.
- **Deferred visualizations** — net-price-by-income bars, admissions-factor weight grid (designed, not built).
- **Trend/time-series anything** — excluded until the data has more than one vintage per source.
- **Writing to the database, triggering CDS collection, or any pipeline-side action** — the agent is a read-only consumer; CDS collection stays admin-initiated in the pipeline.
- **Formal launch-bar thresholds** — the eval set exists, but MVP1 ships on judgment, not a numeric gate.

## Further Notes

### Decision history & rationale (from the design conversations — kept so the reasoning isn't lost)

- **Primary user = the student applicant.** Considered: student, counselor, parent, persona-neutral. Chosen: the student — the biggest market and the hardest to get right (high emotional stakes, low data literacy), which forces the best version of the product. This re-ranked everything: clarifying questions became non-negotiable, honesty must be kind *and* honest, the agent must teach as it answers, and Reddit became genuinely useful (campus vibe) but permanently community-tier.
- **MVP1 = think + answer; the "doing" layer is the future.** The killer student job is chancing / "where should I apply," but that needs the student's profile (deferred). Most of "what does it take to get in" needs zero user data — it's admissions data we already have. So MVP1 ships the knowledge without the personal math, and later phases (personalization, chancing, memory, writing) stack on this retrieval layer.
- **Wedge = the deep school dossier.** Considered four wedges: dossier, honest head-to-head comparison, smart list-building, deep-research report. The dossier leans hardest into the one asset nobody else has: up to ~1,000 structured fields per school, fused with live web and Reddit, cited and honest.
- **Capability gaps surfaced during brainstorming and folded into the feature list:** source tiering (Reddit ≠ truth), data-recency awareness (know what it doesn't know), clarifying questions (the difference between a counselor and a search box), tables as first-class output, in-session working memory, multi-school batch operations (filter/rank/compare N schools), and the deep-research verification step. "Process management" was considered and excluded — it's a different product.
- **School coverage was originally tracked-only, then reversed (2026-06-09):** the agent initially covered only the 8 CDS-rich schools; this made the product an artificially narrow sandbox. Reversed to all in-database schools, with "tracked" repurposed as the CDS-depth tier. "Works everywhere, deepest where CDS exists."
- **External search consolidated on Tavily (no scraping, no hand-rolling):** one search+extract backend for all three external searches, scoped by domain; Reddit steered by the agent from a labeled subreddit menu rather than a hardcoded mapping. Deep research deliberately stays GPT-Researcher (with Tavily underneath) rather than a hosted research endpoint, because a black box can't treat our DB as a first-class source.
- **The source-control dropdown** was added late as an explicit MVP control: user-selectable external sources, enforced in the orchestration layer so a disabled source is unreachable, not merely discouraged.
- **Clarifying questions got a judgment rule, not just a widget:** clarify only when it materially changes the answer; otherwise assume-and-state; never an intake form. A student-facing tool that interrogates every turn is worse than one that guesses well.
- **Visualizations got a provenance boundary:** the model picks the shape, a tool fetches the numbers, and community content can never masquerade as a quantified chart. The SAT-composite trap (IPEDS percentiles are per-section and must never be summed to 1600) is encoded in the chart definition itself.
- **MVP1 surface and citation UX were resolved in this PRD (2026-06-10):** a deliberately minimal web chat (the smallest surface on which every MVP1 behavior is real), and inline expandable citation markers with official/community chips (clean by default, fully transparent on demand). The remaining open questions are engineering-side (exact library APIs at build time, the Tavily/Reddit domain-scoping check, the eval harness) and live in `docs/ARCHITECTURE.md` §19.

### The three principles (inherited from the data pipeline)

1. **KISS** — the smallest thing that works; no abstraction before it's needed.
2. **Never reinvent the wheel** — the whole stack is battle-tested pieces chosen by surveying the frontier.
3. **Startup speed over enterprise completeness — with one carve-out: the data is the product; never lie to a student.** Honesty about values, sources, and recency lives in code, not in the model's head, and is the one place we spend extra effort regardless of cost.

### Documentation map

| Document | What it holds |
|---|---|
| `docs/ARCHITECTURE.md` | The full system design (to be refined in the next planning pass) |
| `docs/DATABASE_GUIDE.md` | The exhaustive data contract — every table, the field catalog, reading rules R1–R12, provenance, gotchas |
| `docs/adr/README.md` | Index of all 15 architectural decision records |
| `docs/research/` | The stack survey and the deep-research bake-off behind the choices |
