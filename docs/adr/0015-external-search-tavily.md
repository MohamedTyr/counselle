# ADR 0015 — External search via Tavily, scoped by domain; deep research stays GPT-Researcher

**Status:** Accepted

## Context
The agent needs three external searches — general **web** (Google-style), the school's own **.edu** site, and **Reddit** (community sentiment) — and they must be fast, cheap, and accurate. We already hold each school's official URL (`institution.website` / `admissions_url`) and a curated set of admissions subreddits. We must not reinvent the wheel or build scrapers (KISS, startup mode).

## Decision
1. **All three searches are one backend — Tavily — scoped by domain.** Tavily returns already-extracted page content, so **we never fetch or scrape pages ourselves**; we only tell it where to look. Three thin tools:
   - `search_web(query)` — no domain filter. Tier varies by result domain: `official` for `.gov`/`.edu` domains, else `community` with caveat "General web source — verify on the school's official site."
   - `search_school_site(school, query)` — Tavily `include_domains = [the school's saved URL]`; the tool resolves the domain from the DB, the agent only names the school. **Official** tier.
   - `search_reddit(query, subreddits)` — Tavily `include_domains = [subreddits the agent picked]`. **Community** tier (never cited as fact).
2. **Reddit is agent-steered.** The agent picks the relevant subreddit(s) from a small labeled menu in its context (`r/ApplyingToCollege`, `r/chanceme`, `r/financialaid`, `r/[SchoolName]`, program subs) by intent — not a blunt injected allowlist. School subs are best-effort (reason the likely name; an empty result is harmless), so **no mapping table is maintained**. The source-control dropdown (ADR 0013) **bounds the menu** the agent may pick from.
3. **Deep research stays GPT-Researcher** (ADR 0009), with **Tavily as its retriever** — one search backend for both the fast inline tools and deep research.
4. **We do not route deep research through a hosted/managed research endpoint** (Tavily's or anyone's).

## Rationale
- Three named tools (vs one generic) so the source dropdown maps 1:1 (disable Reddit → don't mount `search_reddit`), the citation tier is unambiguous per tool, and intent stays clear.
- Domain scoping gives the ".edu" and "Reddit" behaviors for free — no custom fetchers, no scrapers. We supply the domains/subreddits we already have; Tavily does the rest.
- **DB-first** means search fires only when the DB can't answer or is stale (data calendar, §12) — most questions never search, which is the speed/cost edge over a search-everything tool like Perplexity.
- **Why not a hosted research endpoint:** a black-box web-research API can't make **our DB a first-class source**, can't use **our cheap-model routing**, and can't carry **our source-tiering/verification**. It would produce generic, web-only reports — exactly what we beat. GPT-Researcher *is* the off-the-shelf reuse (built on Tavily); keeping it preserves the DB integration and cost control with no extra build work.

## Alternatives considered
- **Custom page fetchers / "direct-to-source" scraping using saved URLs** — rejected: builds infra Tavily already provides; violates KISS / never-reinvent.
- **One generic `search(query, domains)` tool** — workable, but loses the clean dropdown mapping and per-tool tiering; the three thin tools are clearer for the same cost.
- **Hosted Tavily (or other) deep-research endpoint instead of GPT-Researcher** — rejected (see Rationale); revisit only if such an endpoint ever exposes custom first-class sources *and* model routing.

## Consequences
- One Tavily account/key powers web, .edu, Reddit, and GPT-Researcher's retrieval — a single search dependency to manage and budget.
- The fast inline search tools and the deep-research subgraph (ADR 0009) share the same backend, so search quality/caching improvements help both.
- Exact Tavily parameters (e.g. `search_depth`, result caps) and the default subreddit menu are confirmed at build time.
