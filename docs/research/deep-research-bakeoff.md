# Research — Deep Research Bake-off (quality vs cost)

> Verdict captured in [ADR 0009](../adr/0009-deep-research-gpt-researcher.md).
>
> The 4-way comparison behind ADR 0009. Two passes were run: an initial OSS deep-research survey, then a focused head-to-head on the four systems the user flagged, with **token/cost efficiency as a primary axis** ("best quality while not going broke"). Conducted June 2026 via web research; benchmark/version specifics should be re-verified at build time.

## Requirement recap
Cited, multi-source research with **pluggable custom sources** (our DB via MCP + Reddit + .edu + general web), official-vs-community source tiering, a verification/cross-check step, model-configurable (route sub-steps to cheap models), Python-embeddable, permissive license, **and controllable cost**.

---

## The four systems

### GPT-Researcher (assafelovic/gpt-researcher) — Apache-2.0, Python
Planner+executor+publisher (+optional LangGraph multi-agent). **Native pluggable sources via MCP** (`RETRIEVER=tavily,mcp`) + 7 web engines + local docs. **Three model tiers** (`FAST_LLM`/`SMART_LLM`/`STRATEGIC_LLM`) + depth/breadth/concurrency caps + per-tier token limits. Documented cost ~$0.08–0.10/task (cheap) to ~$0.50–1.00 (deep multi-agent). Citations inline, 20+ sources; **no published precision/recall benchmark**; verification is implicit (we add an explicit step). Clean Python async API; can also run as an MCP server. Production-grade.

### STORM (stanford-oval/storm) — MIT, Python
Wikipedia-style article generator (DSPy-based). Multi-perspective conversation → outline → cited article. **Best documented citation quality (~85% precision/recall).** Per-role model assignment (cheap conv, strong writer) via litellm. Retriever interface exists (10+ web RMs + Qdrant VectorRM) but **no MCP, no Reddit**, and custom retrievers take more work. Output is a long-form article, not Q&A. Est. cost $0.30–2.00/task. **Runner-up** — use if citation precision becomes a hard product line.

### Alibaba-NLP/DeepResearch (Tongyi DeepResearch) — Apache-2.0
Primarily a **30B-A3B MoE model** (+ thin inference harness), not a pluggable framework. Strong benchmarks (GAIA 70.9, BrowseComp 43%/58% heavy) **for a single model**, but **hardcoded tools, no MCP, no custom-source pluggability, not a clean Python library, GPU self-hosting cost**. **Disqualified on requirements.**

### dzhng/deep-research — MIT, **TypeScript**
Minimal <500-LoC recursive breadth/depth reference impl. Firecrawl-only, single global model, source list (no inline citations). ~$0.10–0.71/task. **Disqualified** (wrong language for our Python stack; no pluggable sources).

---

## Quality-vs-cost comparison

| Dimension | GPT-Researcher | STORM | dzhng | Alibaba DR |
|---|---|---|---|---|
| Citation quality | Good (inline, 20+ src) | **Very high (~85%)** | Low (list only) | High benchmarks, no citation metric |
| Source pluggability | **Excellent (MCP + 7 engines + docs)** | Good (10+ RMs, Qdrant); no MCP/Reddit | None (Firecrawl) | **None (hardcoded)** |
| Verification | Implicit (we add explicit) | Multi-perspective (not fact-check) | None | None |
| Python-embeddable | **Yes (clean async)** | Yes (Runner API) | **No (TS)** | Partial (awkward) |
| Model routing / cheap mode | **Yes (3 tiers)** | Yes (per-role) | Partial (1 global) | No (model is the system) |
| Cost profile | **$0.08–1.00/task, fully dialable** | $0.30–2.00 | $0.10–0.71 | API per-token or GPU |
| License | Apache-2.0 | MIT | MIT | Apache-2.0 |
| Prod readiness | **Strong** | Research-grade | Demo only | Research/cloud |
| PydanticAI+LangGraph+MCP fit | **Excellent** | Fair | Poor | Poor |

## Quality/cost frontier
- **Cheapest-good:** GPT-Researcher fast mode (~$0.08–0.10, full pluggability).
- **Best-but-expensive:** STORM with a strong writer (~$1–2, best citations, no MCP/Reddit).
- **Dominated for us:** dzhng (TypeScript), Alibaba DR (GPU + no pluggable sources + not a library).

---

## Verdict → **GPT-Researcher**, cheap-model-routed, capped depth, DB-first (ADR 0009)
The only system that natively satisfies pluggable sources via MCP (our DB + Reddit + .edu) **and** gives best-in-class cost control. Configure (defaults, swappable per-agent — ADR 0011): `FAST_LLM`/`STRATEGIC_LLM` → Gemini 2.5 Flash, `SMART_LLM` → Gemini 2.5 Pro (escalate + higher depth for high-stakes); `BREADTH=3`, `DEPTH=2` default; `RETRIEVER=tavily,mcp` with the `counselle-db` MCP server (Reddit and .edu via Tavily domain scoping, ADR 0015).

**Cost synergies:** DB-first (web/Reddit only fills gaps — a base-tier dossier rarely touches the web) · depth/breadth caps · cheap-model routing · cache per (school, question-type, snapshot). *(The scope gate was later removed — ADR 0002 revised — so research is no longer bounded by school count; DB-first carries the cost control.)*

**We add (already PRD features):** source-type tagging (MCP metadata, official vs community), an explicit verification step, and a ~50-question eval set to measure citation accuracy before launch (since GPT-Researcher lacks a published one).

**Runner-up:** STORM, if citation precision becomes a hard product requirement (route all roles but the writer to cheap models; cap perspectives/top-k).

## Data-quality caveats
GPT-Researcher's ~$0.10 figure predates 2026 pricing/multi-agent mode (expect $0.30–0.50 typical with Sonnet synthesis). STORM's 85% is on Wikipedia-style content, not admissions/Reddit. Alibaba's GAIA numbers are self-reported. No system is benchmarked specifically on university-admissions content — hence our own eval set.
