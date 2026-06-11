# ADR 0022 — Protocol: `step`/`thinking` events, Last-Event-ID resume, cancel — additive within v1

**Status:** Draft (MVP2 architecture pass, 2026-06-11 — moves to `docs/adr/` as Accepted when the build starts)

## Context
The PRD-mvp2 chat experience requires granular work visibility (the activity timeline: tool calls, searches, reasoning summaries), refresh-proof streams, and a stop button. Protocol v1 (ADR 0016) has `meta/delta/viz/clarify/sources/usage/done/error` — no step granularity (MVP1 realized "visible reasoning" as prose narration in `delta`), no reconnect semantics, no cancel. v1's rule: additive changes don't bump the version; clients ignore unknown event types.

## Decision
1. **New `step` event** — start/end pair per unit of agent work: `{step_id, status: start|end|error, kind: db_tool|sql|web_search|edu_search|reddit_search|viz|skill|research, label, tier, detail}`. `detail` (on end) carries the expandable receipts (query, domains, result counts, field keys, duration). **Emission seam is a build-time gate:** preferred = PydanticAI's native streamed-run tool events (verify the pinned version emits them — today `app/agent_node.py` consumes only Part events); decided fallback = seams we already own (the MCP `process_tool_call` hook where `annotate_mcp_result` sits, plus our own Tavily/`render_viz`/skill functions). Either way, no hand-wrapped tools (ADR 0017). The mapping (tool call → kind/tier/label) is a **named pure step-mapper module**, not route-handler code; labels come from a `step_labels.yaml` data asset. The `research` kind is reserved for the deep-research follow-up.
2. **New `thinking` event** — `{text}`: the model's *interstitial* text between tool calls is rerouted here (it rode `delta` in MVP1); only final-answer text rides `delta`. No second model call. Honesty rule: thinking narrates intent, never facts-first (prompt-enforced, eval-watched).
3. **Steps persist — the transcript contract grows.** At turn end the **step record** (steps + receipts + thinking lines + the derived one-line receipt) is written into the graph state alongside the messages (no new storage; the checkpointer holds it). `GET /v1/sessions/{id}` returns it per assistant message. This is what makes the PRD's "expandable forever" receipt and the collapsed-receipt-on-revisit true; without it the timeline would be ephemeral stream theater.
4. **The turn lifecycle gets one owner: the turn registry** (`app/turns.py`). Today the turn *is* the request-handler coroutine, so a client disconnect (F5) kills the turn — refresh-proof streams are impossible in that shape. The registry runs each turn as a **detached asyncio task** and owns, per session: the task, the event **ring buffer**, the **single-flight lock**, and the **cancel handle**. Interface: `start / attach(last_event_id) / cancel / is_generating`; the endpoints are thin callers.
5. **Resume:** events already carry the SSE `id:` field (MVP1, `api/sse.py`); a new **`GET /v1/sessions/{id}/stream`** attaches via the registry honoring `Last-Event-ID`. No active turn in this process → `204` → the client falls back to the transcript read. The buffer is best-effort; **persisted state (prose + step record) is the correctness guarantee.**
6. **Cancel:** **`POST /v1/sessions/{id}/cancel`** → the registry cancels the task at the graph boundary; partial prose persists; **`done.data.status` gains `cancelled`** — extending the existing `complete|awaiting_input` enum (`domain/events.py`), not adding a parallel `stop_reason` field.
7. **Single-writer rule:** one active turn per session via the registry's lock; a concurrent send → `409 stream_active`; "send mid-stream re-asks" is client-orchestrated (cancel → await done → send). Session list rows expose `is_generating` from the registry.
8. **All of it is additive within v1** — `v` stays 1; the MVP1 harness keeps working unmodified (and proves the rule).

## Rationale
- Source-control enforcement becomes *visibly* real for free: a disabled source's tool isn't mounted (ADR 0013), so its `kind` cannot appear in the timeline — no new enforcement code.
- Rerouting interstitial narration to `thinking` is the KISS realization: the content already exists; only its routing changes. A summarizer model pass would add cost and latency for unproven benefit (fallback if dogfooding shows sparsity).
- SSE's own `id:`/`Last-Event-ID` is the native resume seam — no bespoke sequence protocol; the `id:` field already ships in MVP1.
- **The turn registry passes the deletion test:** without it, detached-task ownership, buffering, locking, and cancellation smear across four route handlers; with it, every piece of single-instance state has one home — and scale-out becomes "re-back one module."
- In-process buffer + persisted-state fallback gives F5-proof chats with **zero new infrastructure**; durability of the *conversation* was already guaranteed by the checkpointer (ADR 0019), and the step record rides the same mechanism.

## Alternatives considered
- **Protocol v2** — rejected: nothing breaks; v1's additive rule was designed for exactly this.
- **WebSockets for bidirectional control** — rejected (Part I §25 stands): cancel is just an HTTP POST; SSE stays simpler and HTTP-native.
- **Durable event log (Redis Streams / Postgres events table) for replay** — rejected for MVP2: new infra to make a *progress display* replayable when the transcript already guarantees the content; revisit at scale-out alongside the other single-instance state.
- **A second cheap-model pass to generate `thinking` summaries** — deferred, not chosen: cost + latency for something the interstitial text likely provides.
- **Steps synthesized client-side from prose narration** — rejected: theater, not truth; the PRD demands the timeline render real work.

## Consequences
- `app/` gains the turn registry and the step-mapper module; the route layer goes back to being dumb translation (thin callers of the registry + encode-and-yield).
- The registry and the step mapper are unit-testable without HTTP or an LLM: disconnect-survival, replay-from-id, cancel, 409, and table-driven label mapping (fake event source / fixtures).
- The receipts surface real queries/domains/counts — never DSNs or credentials (house rule, tested).
- Step records grow graph-state size on long chats — receipts are bounded (no payloads), and the existing checkpoint TTL knob (ADR 0019) covers growth; watch, don't pre-build.
- The single-instance state has exactly two owners (the registry + rate counters) — the documented posture of ADR 0023; scale-out re-backs them, nothing else.
- The eval set gains a watch: facts must not appear first in `thinking`.
- Pre-MVP2 turns have no step record — the renderer shows prose only for them (acceptable; PRD decision 5 wants the receipt default for new turns).
