# ADR 0017 — Layered architecture with a pure domain core and stack-native seams

**Status:** Accepted

## Context
The honesty-critical logic (reading rules R1–R12, the citation envelope, vintage interpretation, coverage tiers, the admission season) is the product's core guarantee and must be heavily tested and stable. Meanwhile the stack (PydanticAI, LangGraph, FastAPI, GPT-Researcher) is the fastest-churning part of the system. Without a layering rule, the two tangle and both become untestable and unswappable.

## Decision
1. **Four layers, dependencies point inward only:** `domain/` (pure honesty core — no I/O, no LLM, no framework imports) ← `app/` (LangGraph graph, PydanticAI agents, research, skills) ← `adapters/` (asyncpg, Tavily, GPT-Researcher, checkpointer, embeddings) ← `api/` (FastAPI edge, SSE, request context).
2. **The domain core is a single deep module**: envelope types, the normalization engine, vintage resolver logic, tier computation, `admission_season(today)`, and all spec/protocol types. The `counselle-db` MCP server imports it for normalization.
3. **Use the stack's native seams; never wrap them.** PydanticAI `model=` is the model seam; MCP is the tool seam; LangGraph's checkpointer protocol is the session seam; SKILL.md is the workflow seam. No hand-rolled abstraction over any of them.
   **Carve-out (eng-review D2):** MCP is the tool seam *for the LLM's tool loop only*. `app/` imports `counselle_db/service.py` (plain async functions, the real API behind the thin MCP shell) directly in-process for `render_viz`, the data calendar, and tier checks — our own code never round-trips through the MCP child process.
4. **No pass-through wrappers anywhere:** a module whose interface is as complex as what it hides gets deleted. New interfaces are written only where there are two real adapters or an honesty/testability stake.

## Rationale
- The deletion test: deleting the domain core would scatter the reading rules across every tool and prompt — it concentrates the honesty guarantee in one place with a tiny interface (locality + leverage).
- Pure domain code tests with zero mocks, zero network, zero LLM — which is what makes the PRD's "TDD the normalization engine hard" cheap.
- The stack's churn (PydanticAI pre-v2 is the top stack risk) stays contained in `app/`/`adapters/`; a framework migration never touches the honesty core.
- Wrapping the stack's own seams would add interface complexity with no behavior behind it — shallow modules, pure debt.

## Alternatives considered
- **Full hexagonal/clean architecture with ports for everything** — rejected: enterprise ceremony; most "ports" would have one adapter forever and fail the deletion test.
- **No layering (prototype-style single package)** — rejected: the honesty core would tangle with the fastest-churning dependencies, making the one thing we must test hard to test.

## Consequences
- A one-way import rule to enforce in review (optionally by a lint check later).
- The MCP child process (stdio) is supervised by the service lifespan — exponential-backoff restart, status surfaced in `/v1/health`; a tool call hitting a dead child gets a structured tool error, never a hang (eng-review D4).
- Framework swaps/upgrades are localized; the domain core and its tests survive them.
- The repo layout (ARCHITECTURE §5) mirrors the layers, making the structure self-explanatory.

## Accepted deviations

1. **`app/` ← `counselle_db/service`** (eng-review D2 carve-out, documented above): `app/` imports `counselle_db/service.py` directly in-process for render_viz, the data calendar, and tier checks.

2. **`api/` ← `counselle_db/reconcile`**: `api/main.py` (lifespan) and `api/routes/system.py` (the admin reconcile route) import `counselle_db.reconcile` directly, bypassing the `app/` layer. This is accepted for MVP1 because the reconciler has no `app/`-layer business logic — it is infrastructure maintenance wired at the process boundary. Adding an `app/` wrapper would be a pass-through with no behaviour behind it and would fail the deletion test.
