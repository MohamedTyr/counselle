# ADR 0009 — Deep research: embed GPT-Researcher (cost-optimized)

**Status:** Accepted

## Context
The PRD wants deep research across the web, our DB, .edu, and Reddit, with citations and a verification step — while optimizing token cost ("we don't want to get broke"). We must reuse, not rebuild. We ran a 4-way bake-off (`docs/research/deep-research-bakeoff.md`).

## Decision
Adopt **GPT-Researcher**, **embedded as a research subagent/tool inside the LangGraph orchestrator** (Anthropic orchestrator-worker pattern), cost-optimized.

**MVP1 status (2026-06-10):** the deep-research subsystem (PRD stories 39–41, including the verification pass) is **deferred from the MVP1 implementation plan**. The LangGraph graph ships a clearly-marked stub `research` node seam so the follow-up plan adds it without restructuring. This ADR remains the valid design for that follow-up.

## Rationale
- **Only OSS option with native pluggable sources via MCP** — so we plug in our DB + Reddit + .edu (a hard requirement).
- **Best controllable cost:** three model tiers (defaults: `FAST_LLM`→Gemini 2.5 Flash, `STRATEGIC_LLM`→Gemini 2.5 Flash, `SMART_LLM`→Gemini 2.5 Pro; escalate for high-stakes; all swappable per-agent — ADR 0011) + depth/breadth/concurrency caps + per-tier token limits. ~$0.08–0.10/task cheap, ~$0.50–1.00 deep (indicative, provider-dependent).
- Python-native, Apache-2.0, production-grade, native LangGraph/MCP fit.
- **Cost synergies** from other decisions: **DB-first** (web/Reddit only fills gaps — a base-tier dossier rarely touches the web), depth/breadth caps, cheap-model routing, cacheable per (school, question-type, snapshot). *(Note: the scope gate was removed — ADR 0002 revised — so research is no longer bounded by school count; DB-first now carries the cost control.)*

## Alternatives considered (and why rejected)
- **Alibaba-NLP/DeepResearch** — a 30B model with hardcoded tools, no MCP/custom sources, GPU cost; not a pluggable framework.
- **dzhng/deep-research** — TypeScript <500-LoC toy, Firecrawl-only, no inline citations.
- **STORM** — best citation precision but no MCP, no Reddit, and higher cost (its retriever interface supports 10+ web RMs + a Qdrant vector store, but custom/MCP sources take more work). **Runner-up** if citation precision becomes a hard product line.
- **A hosted/managed deep-research endpoint** (Tavily's or any vendor's) — rejected: a black box can't make **our DB a first-class source**, can't use **our cheap-model routing**, and can't carry our source-tiering/verification → generic web-only reports. GPT-Researcher is the off-the-shelf reuse and runs on Tavily anyway (ADR 0015).

## Consequences
- We add ourselves (already PRD features): **source-type tagging** (MCP metadata: official vs community) and the **verification step** (cheap cross-check of top sources) — both land with the deep-research follow-up.
- The **~50-question eval set** (PRD story 58) ships in **MVP1 Phase 7 independently of GPT-Researcher** — it measures the whole agent (facts, field selection, clarify judgment, honesty, viz); citation-accuracy measurement of the research subsystem is an added concern when this ADR activates (GPT-Researcher has no published citation-accuracy benchmark).
