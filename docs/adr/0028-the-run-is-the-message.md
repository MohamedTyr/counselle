# ADR 0028 — The run is the message

**Status:** Accepted

## Context

Counselle's interactive turn model now needs to behave like an agent runtime,
not a prose-only chat loop. The active turn can be reattached, cancelled, and
steered while it is still running, and the transcript has to preserve the whole
chronological run, not just the final answer text.

That requires one more seam too: active-run metadata has to live somewhere
process-local so the runtime can coordinate the live run without serializing
non-checkpoint-safe objects into LangGraph state.

## Decision

- The assistant response is the whole run. Copy, transcript replay, and export
  consume the ordered run record (`segments` / `parts`), so narration, steps,
  thinking, tool receipts, mid-run `user_message` steering, and final prose all
  belong to the same assistant message.
- `app/agent_node.py` drives PydanticAI through `agent.iter(...)` and the
  public `next_node` / `next(...)` loop, not `run_stream_events()`.
- `app/run_handle.py` provides a process-local `RunHandleStore`. The registry
  creates one handle per active session, the node looks it up by `session_id`,
  and steering / replayable snapshot data stays in memory only.
- Stop is suspend. `POST /v1/sessions/{id}/cancel` preserves the partial
  provider history and the partial turn record, then finalizes the run as
  cancelled. The next message continues from the checkpointed history.
- Mid-run steering happens through `POST /v1/sessions/{id}/steer`. The backend
  emits `user_message` immediately, injects the text into the active run at the
  next safe boundary when possible, and otherwise replays it as
  `injected:false` so the client can send it as the next normal turn.
- Native thinking summaries are controlled by `thinking_stream` (default on).
  `thinking_summaries` remains only as a compatibility alias.
- Public tool details stay explicit and safe: `StepDetail` / `ToolUi` carry the
  rendered receipt payload, while raw tool results never cross the wire.

## Rationale

The run-as-message model keeps the transcript and the live stream aligned.
`agent.iter(...)` is the native seam for a stepped run, and the process-local
handle store keeps active-run coordination simple without polluting persistent
graph state. `thinking_stream` is a product toggle, not a second contract
surface.

## Alternatives

- Keep `run_stream_events()` as the main loop seam. Rejected because it ties
  the runtime to the older stream shape and makes steering / snapshot
  coordination harder to express.
- Model mid-run user text as a new persisted top-level user turn. Rejected
  because steering only belongs to the active run when it is injected; otherwise
  it is just the next normal message.
- Persist the active-run handle in LangGraph state. Rejected because the
  handle is process-local, transient, and not serializable.
- Keep `thinking_summaries` as the canonical config flag. Rejected because the
  shipped setting is `thinking_stream`, with `thinking_summaries` only as a
  compatibility shim.

## Consequences

The registry, node, and transcript read all have to treat the assistant turn as
a chronological run. Stop semantics preserve partial history, steering uses the
`user_message` event, and copy/export can no longer be prose-only shortcuts.
Scale-out still requires backing the process-local handle store separately; this
ADR stays compatible with the single-instance posture.
