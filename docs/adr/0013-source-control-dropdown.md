# ADR 0013 — Per-request source control (the MVP dropdown)

**Status:** Accepted

## Context
The PRD requires an MVP dropdown to choose which external sources the agent may use (besides our DB): web, Reddit (with per-community enable/disable), and .edu.

## Decision
A **source-config object travels with each request** (web on/off; Reddit on/off + a per-subreddit allowlist; .edu on/off; our DB always on). The orchestrator **builds the agent's toolset from that config per request**.

## Rationale
- A disabled source's tool object is **never constructed** (unmounted, not hidden), so a disabled source can't be reached and never appears in citations. When the deep-research subagent is added (ADR 0009), it receives the same `source_config` to gate its retriever list.
- Reddit per-community toggles **bound the labeled subreddit menu the agent picks from** (the agent steers which sub to search; the dropdown limits the choices) — see ADR 0015.
- Enforced in the orchestration layer (in code), not merely a prompt instruction.

## Consequences
- The "dropdown" is the UI surface of the source-config; the config is a first-class request parameter even with a minimal UI.
- Citations only ever reference enabled sources.

## Amendment (ADR 0037) — one sanctioned exception to *unmounted, not hidden*

The "unmounted, not hidden" mechanism assumes we construct the tool. The four
`counselle-db` tools do not meet that assumption: they arrive as one indivisible
`MCPToolset` over one stdio child process, so two of the four cannot be withheld
by construction without a second toolset and a second child process.

ADR 0037 therefore denies `get_domain` and `query_database` on the essay surface
*inside* the toolset's existing per-run result hook (`ESSAY_SURFACE_DENIED_MCP_TOOLS`
in `app/toolset.py`), refusing the call in code before it reaches the child process
or the database — never in the prompt. The principle above is intact; only the
mechanism differs, and only for a vendor toolset we cannot partially mount.
Everything we build ourselves — every workspace tool, `render_viz` — is still
unmounted, never denied. See ADR 0037 for the full trade.

## Superseded (ADR 0038) — the exception's mechanism is gone, and with it the exception

ADR 0038 (school-data-v3) deleted the `counselle-db` MCP child process entirely.
The four DB tools are no longer one indivisible `MCPToolset`; each is its own
in-process `Tool` object built by `build_db_tools()`. The condition this
amendment existed to work around — "two of the four cannot be withheld by
construction" — no longer holds, so the exception it justified is retired with
it.

`build_db_tools(..., surface=...)` (`app/toolset.py`) now simply does not
construct `get_facts` (renamed from `get_domain`) or `query_database` when
`surface is Surface.ESSAY`. There is no result hook, no in-flight denial, and
no runtime error envelope — the essay surface is narrowed by construction like
every other tool this ADR governs. **Unmounted, not hidden holds with zero
exceptions again.**
