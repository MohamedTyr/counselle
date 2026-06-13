# ADR 0011 — Model configuration via per-agent env, optional LiteLLM sidecar

**Status:** Accepted

## Context
"We must be able to configure which model to use with ease" is a hard requirement — ideally per subagent (cheap model for routing, strong for synthesis).

## Decision
- Use **PydanticAI's per-agent `model=`**, read from env/config — a one-line swap per subagent.
- **Default provider = Vertex AI (Google); default model = Gemini 2.5 Pro** (synthesis), Gemini 2.5 Flash (cheap tier: routing/summaries). This is just the default *value* of the per-agent `model=` — any agent can be swapped to Anthropic (`claude-opus-4-8` / `claude-sonnet-4-6` / `claude-haiku-4-5`) or any other provider via env, no code change. Model-agnosticism stays the point (it's why we chose PydanticAI over the Claude Agent SDK — ADR 0003); a non-Claude default proves it.
- We share **only Vertex/GCP credentials** with the data pipeline. Counselle is an **independent service** — no runtime dependency on the pipeline, no shared config or code; the shared creds are a convenience, not a coupling.
- Add a **LiteLLM** sidecar **only if/when** we need cross-provider fallbacks, per-key budgets, cost dashboards, or open-weight models (vLLM/Ollama).

## Rationale
- PydanticAI is model-agnostic natively; no proxy needed for the common case (`docs/research/agent-stack-evaluation.md`, Part 1).
- LiteLLM (self-hostable, MIT) is the cleanest add-on for fallbacks/budgets/open models when required; it composes with PydanticAI and GPT-Researcher.

## Alternatives considered
- **OpenRouter** — largest catalog but SaaS-only, no self-host/team budgets; viable as a `base_url` if we want breadth.
- **Cloudflare AI Gateway** — lacks MCP gateway/team budgets/Python tooling; rejected as primary.
- Native LangChain `init_chat_model` — fine but adds LangChain as the model layer; PydanticAI's is cleaner for us.

## Consequences
- All per-agent model env vars live on the single Settings surface with the `COUNSELLE_` prefix (ADR 0018), e.g. `COUNSELLE_MODEL_COUNSELOR`, `COUNSELLE_MODEL_CHEAP`.
- GPT-Researcher's three tiers (`FAST_LLM`/`STRATEGIC_LLM`/`SMART_LLM`) are configured the same way when the deep-research subsystem activates (ADR 0009).
- Default routing: **Gemini 2.5 Flash** for routing/summaries, **Gemini 2.5 Pro** for synthesis; escalate to a stronger model (Gemini 2.5 Pro at higher depth, or e.g. `claude-opus-4-8`) for high-stakes. All swappable per-agent via env.
