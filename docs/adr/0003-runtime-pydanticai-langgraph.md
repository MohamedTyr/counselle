# ADR 0003 — Agent runtime: PydanticAI + LangGraph

**Status:** Accepted

## Context
We need an agentic runtime that supports tool use (especially MCP), skills, multi-agent/subagents for deep research, citations, streaming/async, in-session memory, clarifying questions, and — a hard requirement — **easy model swapping** (Claude/GPT/Gemini/open models). It must be futureproof and Python-first (the pipeline is Python). We surveyed the 2026 frontier (`docs/research/agent-stack-evaluation.md`).

## Decision
- **PydanticAI** as the agent-definition layer.
- **LangGraph** as the orchestration layer.

## Rationale
- **PydanticAI:** model-agnostic (one-line `model=` swap from env → satisfies "configure model with ease"); native MCP client; **typed outputs** (`result_type`) that *are* our citation envelope; FastAPI-style ergonomics matching the pipeline; backed by the Pydantic team (futureproof). Skills authored as SKILL.md (ADR 0010) load on top.
- **LangGraph:** best-in-class multi-agent orchestration (parallel research subagents), `interrupt()` for visual clarifying questions, state/checkpointer for in-session memory (and long-term later). PydanticAI + LangGraph is the established complementary pattern.
- This resolves the core tension: the Claude Agent SDK is best on skills+MCP but **locks us to Claude models**; PydanticAI+LangGraph gives skills (via SKILL.md) + native MCP + best-in-class model flexibility + production orchestration, with no model lock-in.

## Alternatives considered
- **Claude Agent SDK** — best skills/MCP but Claude-only; fails the hard model-swap requirement.
- **LangGraph alone** — strong, but PydanticAI gives cleaner typed agent definition + native MCP and is more ergonomic for our team.
- OpenAI Agents SDK, Google ADK, CrewAI, Agno, Strands, MS Agent Framework, smolagents, LlamaIndex, Letta, Mastra (TS), DSPy — see the research doc; each lost on model-agnosticism, skills, MCP maturity, Python fit, or paradigm.

## Consequences
- **Risk:** PydanticAI is iterating fast (pre/early-v2). Mitigation: pin versions; agent definitions are already thin (config-driven `model=`, typed outputs) so migration is localized to `app/`; verify exact APIs against the pinned version's docs at build time (no hand-rolled adapter layer — ADR 0017).
- Per-subagent model routing is trivial (cheap model for routing, strong for synthesis).
