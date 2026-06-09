# ADR 0013 — Per-request source control (the MVP dropdown)

**Status:** Accepted

## Context
The PRD requires an MVP dropdown to choose which external sources the agent may use (besides our DB): web, Reddit (with per-community enable/disable), and .edu.

## Decision
A **source-config object travels with each request** (web on/off; Reddit on/off + a per-subreddit allowlist; .edu on/off; our DB always on). The orchestrator **builds the agent's toolset from that config per request**.

## Rationale
- A disabled source's tool object is **never constructed** (unmounted, not hidden), so a disabled source can't be reached and never appears in citations. When the deep-research subagent is added (deferred — ADR 0009), it receives the same `source_config` to gate its retriever list.
- Reddit per-community toggles **bound the labeled subreddit menu the agent picks from** (the agent steers which sub to search; the dropdown limits the choices) — see ADR 0015.
- Enforced in the orchestration layer (in code), not merely a prompt instruction.

## Consequences
- The "dropdown" is the UI surface of the source-config; the config is a first-class request parameter even with a minimal UI.
- Citations only ever reference enabled sources.
