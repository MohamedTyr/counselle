# Research — Agent Stack Evaluation (frameworks, model-config, skills)

> Verdicts captured in [ADR 0003](../adr/0003-runtime-pydanticai-langgraph.md), [ADR 0010](../adr/0010-skills-via-skill-md.md), [ADR 0011](../adr/0011-model-config-env-litellm.md).
>
> The frontier-tech survey behind ADRs 0003 (runtime), 0010 (skills), 0011 (model config). Conducted June 2026 via web research. Specific version numbers/package names were pulled from the live web and should be re-verified at build time; the directional conclusions are consistent and load-bearing.

## Evaluation rubric (Counselle's needs)
Agentic loop quality · tool use especially **MCP** · **skills** (SKILL.md-style) · **subagents/multi-agent** (for deep research) · **easy model swapping (hard requirement)** · citations · streaming/async/HITL · in-session + future long-term memory · production maturity · futureproofing · **Python-first** (the pipeline is Python). Principle: never reinvent the wheel.

---

## Part 1 — Agent frameworks

### Scorecard (1–5; weighted for our needs)

| Framework | Model flex | MCP | Skills | Multi-agent | Agentic loop | Citations/typed-out | Streaming/async | HITL | Memory | Prod maturity | Python-first | Total/55 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **PydanticAI + LangGraph** | 5 | 5 | 4 | 5 | 5 | 5 | 5 | 5 | 3 | 4 | 5 | **51** |
| LangGraph (standalone) | 5 | 4 | 3 | 5 | 5 | 4 | 5 | 5 | 4 | 5 | 5 | 50 |
| Claude Agent SDK | 1 | 5 | 5 | 3 | 5 | 4 | 5 | 4 | 3 | 5 | 5 | 45 |
| PydanticAI (standalone) | 5 | 5 | 4 | 3 | 4 | 5 | 5 | 3 | 2 | 3 | 5 | 44 |
| Mastra (TS) | 5 | 5 | 4 | 4 | 4 | 4 | 5 | 3 | 4 | 4 | 1 | 43 |
| Google ADK | 3 | 4 | 2 | 5 | 4 | 4 | 5 | 4 | 3 | 3 | 4 | 41 |
| OpenAI Agents SDK | 3 | 4 | 2 | 3 | 4 | 4 | 5 | 4 | 3 | 3 | 5 | 40 |
| Agno | 5 | 4 | 2 | 4 | 3 | 3 | 5 | 2 | 3 | 3 | 5 | 39 |
| MS Agent Framework | 4 | 3 | 4 | 4 | 3 | 4 | 4 | 4 | 3 | 3 | 3 | 39 |
| LlamaIndex AgentWorkflow | 4 | 2 | 2 | 3 | 3 | 4 | 4 | 3 | 4 | 4 | 5 | 38 |
| CrewAI | 4 | 3 | 2 | 5 | 3 | 3 | 4 | 2 | 2 | 4 | 5 | 37 |
| Strands Agents (AWS) | 4 | 5 | 2 | 4 | 3 | 3 | 5 | 2 | 2 | 2 | 5 | 37 |
| Letta (MemGPT) | 3 | 2 | 2 | 2 | 3 | 3 | 3 | 2 | 5 | 3 | 5 | 33 |
| smolagents | 4 | 3 | 2 | 2 | 3 | 3 | 4 | 2 | 2 | 2 | 5 | 32 |
| DSPy | — | — | — | — | — | — | — | — | — | — | 5 | (prompt-optimizer, not a runtime; complements any choice) |

### The core tension and how it resolves
- **Claude Agent SDK** is best on skills + MCP (co-created MCP, invented Agent Skills) but **locks us to Claude models** — fails the hard model-swap requirement.
- **PydanticAI + LangGraph** is best on model-agnosticism + production orchestration, with skills via SKILL.md and native MCP. It delivers ~95% of the skills value without model lock-in.

### Verdict → **PydanticAI (agent definition) + LangGraph (orchestration)** (ADR 0003)
PydanticAI: model-agnostic one-line swap, native MCP, typed outputs (= the citation envelope), FastAPI-style fit with the Python pipeline, Pydantic-team-backed (futureproof). LangGraph: best multi-agent + `interrupt()` HITL (clarifying questions) + state (in-session memory). Runner-up: LangGraph alone (if skills deprioritized). Third: Strands (if we ever go deep AWS/Bedrock).
**Biggest risk:** PydanticAI pre/early-v2 API churn → pin versions + thin adapter.

---

## Part 2 — Model provider abstraction / routing

| | LiteLLM | OpenRouter | PydanticAI native | LangChain init_chat_model |
|---|---|---|---|---|
| Coverage | 100+ providers | 300+ models | 20+ direct (+LiteLLM/OpenRouter) | 20+ |
| Self-host | Yes (MIT) | No (SaaS) | In-process | In-process |
| Per-agent model | Yes | Yes | Yes (first-class) | Yes (config dict) |
| MCP gateway | Yes | Via framework | Native client | Via plugin |
| Fallbacks/retries | Native | Auto | Limited | Via callbacks |
| Cost tracking | Virtual keys/budgets | Basic | No | No |
| Open-weight models | Yes (Ollama/vLLM) | Yes (many) | Ollama | Ollama+ |

**Verdict (ADR 0011):** PydanticAI's per-agent `model=` from env handles the common case with zero extra infra. Add **LiteLLM** (self-hostable, MIT) as a sidecar only when we need fallbacks, budgets, cost dashboards, or open-weight models. OpenRouter is a viable `base_url` for catalog breadth (SaaS). Cloudflare AI Gateway rejected as primary (no MCP gateway / team budgets / Python tooling).

---

## Part 3 — Agent skills ecosystem

- **SKILL.md is an open, cross-vendor standard** (formalized 2026; adopted across 30+ tools): a directory with YAML frontmatter (`name`, `description`) + Markdown body + optional `scripts/`/`references/`/`assets/`. Progressive disclosure: metadata at startup, full instructions only when triggered, scripts run via bash without loading code into context.
- **Usable beyond Claude Code:** via the Claude API/Agent SDK (uploadable skills) and portably across many tools when using only standard fields.
- **MCP is the transport layer** (~97M downloads/mo, Linux-Foundation-governed): skills answer "how to do this job consistently"; MCP answers "how to reach external systems." Keep them separate. Vet MCP servers (only a minority score "high trust").

**Verdict (ADR 0010):** author skills as **SKILL.md** (workflow), reach external systems via **MCP servers** (transport), wire to PydanticAI agents. Avoid framework-specific tool decorators as the canonical skill definition (lock-in); use thin adapters if needed.

---

## Net stack
**PydanticAI + LangGraph + MCP + SKILL.md + (optional) LiteLLM** — the lowest-lock-in, most futureproof Python agent stack in mid-2026, satisfying model-agnosticism, skills, MCP, multi-agent, citations, and memory. Plus **GPT-Researcher** for deep research (see `deep-research-bakeoff.md`).
