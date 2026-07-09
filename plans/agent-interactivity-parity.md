# Agent Interactivity Parity — the run IS the message

Date: 2026-07-08
Branch: feat/mvp3-frontend-prototype
Status: completed; implementation landed
Depends on:
- `specs/agent-mode/plan/agent-mode-architecture-plan.md` (Agent V1)
- `specs/agent-mode/plan/agent-run-surface-design.md`
- the chronological-segments work already on this branch

## Problem statement

Counselle still has chatbot turn semantics under an agent-looking surface.
The target is **exact** Claude Code / Codex interaction semantics:

1. **The run is the message.** There is no "trace section" + "final answer
   artifact". Narration, tool calls, results, and the closing text are one
   chronological transcript, and that whole transcript is the assistant's
   response — including what Copy copies.
2. **Stop is a suspend, not amnesia.** Stopping a run keeps everything the
   agent did (tool calls AND results) in the model-visible history. The next
   message continues from exactly where the run stopped.
3. **You can talk to it mid-run.** Sending a message while the agent is
   working does not 409. It is queued, shown in the transcript immediately,
   and delivered to the model at the next loop boundary (after the in-flight
   step finishes). If the run ends first, it becomes the next turn's input.

What exists today vs. the target:

| Behavior | Today | Target |
|---|---|---|
| Chronological transcript render | ✅ done (`TurnState.segments`, inline `AssistantBody`) | keep |
| Ordered segments persisted/replayed | ✅ done (`app.records.build_segments`, transcript `segments`) | keep |
| Copy | ❌ copies `message.text` (answer prose only) | whole run |
| Stop → continue | ❌ cancel persists **prose only** (`partial_messages`, the "prose invariant") — tool calls/results are dropped from `messages` | full completed partial history survives |
| Send mid-run | ❌ hard 409 (`registry.start` single-flight); FE cancels active run before sending | queue + inject at loop boundary |
| Visual: steps read as separate zone | ⚠️ mostly fixed but needs polish (`DefaultToolWidget` still looks like an activity row) | inline beats, one stream |
| Thinking visible | ❌ off by default (`thinking_summaries=False`); per-paragraph toggles when on | on by default, one toggle per thinking episode, provider trace verbatim |
| Tool call detail | ⚠️ `StepDetail` + `ToolUi` exist but contract is not locked in docs/tests | UI renders ONLY the tool's frontend payload (`StepDetail`/`ToolUi`); per-tool widgets slot in later |

Non-goals:
- Ask/Agent mode picker
- background runs that outlive the SSE consumer beyond what the turn registry already does
- new workspace tools
- branching/edit-history trees
- process-crash-exact mid-node resume
- server-side auto-start of a queued next turn after the prior run ends

## Context read

This plan was expanded after reading the current code and the shipped planning
artifacts. The important current facts are:

- `app/agent_node.py` still drives PydanticAI through
  `agent.run_stream_events(...)`. It only gets `result.all_messages()` after a
  successful final result. On cancel/timeout/error, there is no live model
  history snapshot available to the registry.
- The pinned local package is `pydantic_ai==1.107.0`. `Agent.iter(...)` exists
  and returns `AgentRun`; `AgentRun.next_node`, `AgentRun.next(node)`,
  `AgentRun.all_messages()`, and `AgentRun.ctx.state.message_history` are
  available.
- In 1.107, bare `async for node in agent_run` skips capability hooks. The
  production loop must use `next_node` + `await agent_run.next(node)`, not bare
  iteration.
- `ModelRequestNode.stream(run.ctx)` yields model response stream events
  (`PartStartEvent`, `PartDeltaEvent`, `PartEndEvent`, `FinalResultEvent`).
  `CallToolsNode.stream(run.ctx)` yields tool handling events
  (`FunctionToolCallEvent`, `FunctionToolResultEvent`, plus future built-in /
  output tool events). Both can be fed into the existing `EmissionRouter`.
- `CallToolsNode.user_prompt` is already a PydanticAI seam for adding user text
  alongside tool return parts in the next model request. It is useful for
  steering after a tool cycle.
- `app/records.py` already stores chronological replay `segments[]` as
  msgpack-plain dicts and updates step segments in place by `step_id`.
- `domain/events.py`, `frontend/src/api/chat/types.ts`, and the SSE validator
  already know about `narration`, `StepData.ui`, and `ToolUi`.
- `app/tool_specs.py`, `app/steps.py`, and `app/tool_middleware.py` already
  implement the safe tool receipt direction: student-facing details come from
  `StepDetail`/`ToolUi`, not raw tool results.
- `frontend/src/features/ai-chat/turn-reducer.ts` already renders one ordered
  `segments` array. It still creates a new `thinking` segment for every
  thinking event, has no `user` segment, and has no whole-run serializer.
- `frontend/src/features/ai-chat/useTurnEngine.ts` currently cancels an active
  turn before sending another message. That is the biggest frontend behavior
  change for mid-run steering.
- `specs/mvp2/plan/wire-contract.md` is behind the current code for
  `narration`, `segments`, `StepData.ui`, and the future `user_message` event.
  It needs an additive update, not a rewrite.
- `docs/ARCHITECTURE.md` §27.7 still describes the prose invariant as the full
  terminal-history rule. This plan changes that to: completed model history
  snapshots win; the prose invariant survives only as the uncommitted tail rule.

## Locked principles

These are the rules for implementation. Do not trade them off while coding.

1. **The product "what" above is fixed.** The plan can change implementation
   details if code reality requires it, but the behavior cannot drift.
2. **Do not break the current chronological surface.** The existing
   `segments` render/replay is the base layer; this work extends it.
3. **Provider history must be replayable.** Never persist a message history
   with dangling tool-call parts, missing tool returns, empty assistant
   responses, or non-msgpack state.
4. **Terminal persistence has one owner.** Keep the H1 discipline:
   `app.turn_persistence.build_terminal_update` stays the single payload
   builder for complete/cancel/error/timeout/awaiting-input record writes.
5. **The raw model-facing tool result never becomes UI.** The UI renders
   `StepDetail`, `StepSource`, and `ToolUi` only. If a future tool needs richer
   UI, it designs a public payload and widget; it does not expose raw JSON.
6. **Steering is part of the active run only if injected.** A queued message
   that loses the race to run completion is displayed live as `injected:false`
   and sent by the frontend as the next normal user turn.
7. **No new durable queue service.** This is in-process, scoped to the existing
   `TurnRegistry` lifetime. Multi-replica/distributed steering is future deploy
   work, not this plan.

## Target data contracts

### `RunHandle`

Add a small in-memory module: `app/run_handle.py`.

```python
from collections import deque
from dataclasses import dataclass, field
from typing import Any

@dataclass(frozen=True)
class SteeringMessage:
    user_message_id: str
    text: str
    injected: bool = False

@dataclass
class RunHandle:
    session_id: str
    messages_snapshot: list[dict[str, Any]] = field(default_factory=list)
    snapshot_seq: int = 0
    emissions_len_at_snapshot: int = 0
    steering_queue: deque[SteeringMessage] = field(default_factory=deque)
    queued_at_terminal: list[SteeringMessage] = field(default_factory=list)

    def record_snapshot(
        self,
        messages: list[dict[str, Any]],
        *,
        emissions_len: int,
    ) -> None:
        self.messages_snapshot = messages
        self.snapshot_seq += 1
        self.emissions_len_at_snapshot = emissions_len
```

Store serialized `ModelMessage` dicts in `messages_snapshot`, not live
Pydantic objects. That matches `state["messages"]`, `build_terminal_update`,
and LangGraph's msgpack-plain checkpoint contract.

### `RunHandleStore`

Add a tiny store on `GraphDeps` / `AppDeps`:

```python
class RunHandleStore:
    def __init__(self) -> None:
        self._handles: dict[str, RunHandle] = {}

    def register(self, session_id: str) -> RunHandle: ...
    def get(self, session_id: str) -> RunHandle | None: ...
    def unregister(self, session_id: str, handle: RunHandle) -> None: ...
```

The registry owns registration/removal. The node only looks up and updates the
handle. The store is process-local and never enters graph state.

`run_turn._prepare_turn_input` must include `session_id` in `turn_ids` so
`run_agent_node` can find the handle from `deps.run_handles.get(session_id)`.
That value is plain state and harmless if an old checkpoint lacks it.

### `Emission`

Extend `app.records.Emission`:

```python
Emission = tuple[
    Literal["delta", "viz", "step", "thinking", "narration", "user"],
    Any,
]
```

The `user` payload is:

```python
{
    "text": str,
    "user_message_id": str,
    "injected": bool,
}
```

Rules:
- `build_segments()` turns `("user", payload)` into
  `{"kind": "user", ...payload}`.
- `build_parts()` ignores `user` segments.
- `steps`, `narration`, `thinking`, `receipt`, sources, and usage ignore
  `user` segments.
- `extract_transcript()` continues to render the outer user entry for the
  initial prompt. Mid-run steering users live inside the assistant run's
  `segments[]`, not as separate transcript entries.

### `user_message` wire event

Add `user_message` to `domain.events.EventType` and FE protocol types:

```json
{
  "v": 1,
  "type": "user_message",
  "data": {
    "text": "Also compare cost.",
    "user_message_id": "uuid",
    "injected": true
  }
}
```

Semantics:
- `injected:true`: this text was or will be included in the active model run.
- `injected:false`: the active run ended before injection; the frontend should
  submit it as the next normal message after the terminal event.

## Phase 0 — migrate the loop to `agent.iter()` with no behavior change

Goal: replace `run_stream_events` without changing the wire stream, records,
model result, usage, source registry, viz placement, tool overflow, or error
semantics.

This phase is the foundation for stop/steer. It ships no user-visible behavior
except the internal loop change.

### Implementation steps

1. **Add the handle store but keep it inert.**
   - Create `app/run_handle.py` with `RunHandle`, `SteeringMessage`, and
     `RunHandleStore`.
   - Extend `app.graph.GraphDeps` with
     `run_handles: RunHandleStore | None = None`.
   - Extend `app.deps.AppDeps` initialization so the API runtime has one store.
   - Tests that construct `GraphDeps` directly should keep working because the
     field defaults to `None`.

2. **Register a handle per active turn.**
   - In `TurnRegistry._drive`, before calling `_run_turn`, register:
     `turn.run_handle = self._deps.run_handles.register(turn.session_id)` when
     the store exists.
   - Add `run_handle: RunHandle | None = None` to `_Turn`.
   - In `_drive` `finally`, unregister in all paths:
     `store.unregister(turn.session_id, turn.run_handle)`.
   - Use identity-aware unregister so a stale handle cannot remove a newer
     turn's handle after a race.

3. **Thread `session_id` through turn ids.**
   - In `run_turn.run_turn`, set:
     `turn_ids = {"message_id": ..., "user_message_id": ..., "session_id": session_id}`.
   - Preserve existing `message_id` reuse for parked-compat continuation.
   - This is server-internal; no wire field changes.

4. **Rewrite the agent loop locally in `run_agent_node`.**
   - Keep all setup before the run unchanged: prompt, toolset, tool deps,
     overflow, registry, viz staging, final writer, `EmissionRouter`.
   - Replace:
     ```python
     async with agent.run_stream_events(...) as stream:
         async for event in stream:
             router.handle(event)
     ```
     with:
     ```python
     from pydantic_graph import End
     from app.pydantic_iter_nodes import CallToolsNode, ModelRequestNode

     async with agent.iter(
         user_text,
         message_history=history or None,
         deps=TurnDeps(...),
         usage_limits=limits,
     ) as run:
         node = run.next_node
         while not isinstance(node, End):
             if isinstance(node, ModelRequestNode):
                 async with node.stream(run.ctx) as stream:
                     async for event in stream:
                         router.handle(event)
                 node = await run.next(node)
             elif isinstance(node, CallToolsNode):
                 async with node.stream(run.ctx) as events:
                     async for event in events:
                         router.handle(event)
                 node = await run.next(node)
             else:
                 node = await run.next(node)
     ```
   - Do not use bare `async for node in run`; it bypasses PydanticAI capability
     hooks in 1.107.
   - Create `app/pydantic_iter_nodes.py` as the only file that imports
     `pydantic_ai._agent_graph`. It re-exports `ModelRequestNode` and
     `CallToolsNode`, and has a small import-time assertion that both classes
     expose `.stream(...)`. If a future PydanticAI version moves these classes,
     the failure is isolated and explicit.
   - After the context exits, read `run.result`. If present, use
     `run.result.all_messages()` / `run.result.usage` exactly like today.
     If `run.result` is `None` on budget, keep the current
     `partial_messages(...)` budget path.

5. **Preserve router closure behavior.**
   - `ModelRequestNode.stream` provides `FinalResultEvent`; the router's final
     answer detection should still work.
   - `AgentRunResultEvent` is not emitted by the node streams. Confirm that
     `router.close("complete")` still flushes final candidate text. If a test
     exposes a miss, add a public `router.finish_run_result()` wrapper around
     the current `_handle_run_result()` behavior and call it when `End` is
     reached.
   - Keep `_close_router_and_flush_final_safely(...)` exception paths exactly
     equivalent.

6. **Snapshot only at replay-safe node boundaries.**
   - Add helper in `app/agent_node.py`:
     `record_replayable_snapshot(run, handle, emissions_len)`.
   - Dump with:
     `ModelMessagesTypeAdapter.dump_python(run.all_messages(), mode="json")`.
   - Do **not** snapshot after every node blindly. Snapshot only when the
     history has no dangling tool call:
     - do not snapshot after `UserPromptNode`; the original graph state already
       contains the user request and no assistant work has completed yet
     - after `CallToolsNode` completes and returns the next `ModelRequestNode`
       or `End`
     - after a final `CallToolsNode` that returns `End`
     - after a `ModelRequestNode` only when the model response contains no
       tool-call parts
   - Implement a replay validator helper and call it before storing:
     `assert_provider_replayable(messages)`. It should scan serialized message
     parts and reject histories where a `tool-call` id has no matching
     `tool-return`/function result part after it. Keep it conservative; if the
     helper is unsure, skip the snapshot rather than persisting bad history.

7. **Keep state output byte-compatible.**
   - The returned update keys remain:
     `messages`, `source_registry`, `viz_emitted`, `usage`,
     `tool_result_store`, `pending_clarify`, `turn_records`.
   - No `RunHandle` field enters state.

### Phase 0 tests

Add/modify tests in `tests/app/test_run_turn.py`, `tests/app/test_steps_router.py`,
and `tests/app/test_turns.py`.

Required gates:

1. **Golden stream equivalence.**
   - Use the existing function-model scripted multi-tool fixture.
   - Run once through the old loop behavior captured as expected event types /
     payloads, then through the iter loop.
   - Assert event sequence equivalence for `meta`, `narration`, `step`,
     `thinking`, `delta`, `viz`, `sources`, `usage`, `done`.
   - Do not compare UUIDs/timestamps directly; normalize them.

2. **Final answer/viz placement.**
   - Existing viz marker placement tests must still pass.
   - Add a case where final text is buffered until `End`; assert final prose is
     not emitted as narration.

3. **Tool pairing.**
   - Parallel tool call starts and as-completed results still pair by
     `tool_call_id`.

4. **Snapshot safety.**
   - Script a model response with a tool call and pause before tool result.
     Assert no snapshot with dangling tool call is stored.
   - Script two full tool cycles. Assert the last snapshot contains both tool
     call/return pairs.

5. **No behavior change.**
   - Routine suite:
     `uv run pytest -m "not live_llm and not live_search and not live_db"`.
   - `uv run ruff check . && uv run mypy .`.
   - Frontend should not need changes in Phase 0.

## Phase 1 — stop = suspend (cancel-time history persistence)

Goal: a stopped/error/timeout run persists the completed model-visible history
available at the last safe boundary, not just streamed answer prose.

### Implementation steps

1. **Extend terminal persistence.**
   - Change `build_terminal_update(...)` in `app/turn_persistence.py`:
     ```python
     def build_terminal_update(..., partial_history: list[dict[str, Any]] | None = None):
         if partial_history is None:
             new_messages, changed = partial_messages(messages, emissions)
         else:
             new_messages = partial_history
             changed = new_messages != messages
             new_messages, tail_changed = append_legal_uncommitted_tail(...)
             changed = changed or tail_changed
     ```
   - `partial_history` wins over `partial_messages` because it is a real
     provider history, not a prose-only approximation.
   - Keep `partial_messages` unchanged for old/no-snapshot paths and budget
     paths.

2. **Append only legal uncommitted prose tail.**
   - Use `RunHandle.emissions_len_at_snapshot` to find tail emissions:
     `tail = turn.emissions[handle.emissions_len_at_snapshot:]`.
   - Only tail `delta` prose is eligible.
   - Append a partial `ModelResponse(TextPart(...))` only if the current
     `partial_history` tail can legally anchor it:
     - tail exists
     - last message is a `ModelRequest`
     - no dangling tool call would be created
   - If not legal, drop it from `messages`. It remains in the turn record via
     `emissions`, so the UI still shows what streamed.

3. **Use the handle in registry partial persistence.**
   - In `TurnRegistry._persist_partial`, read `turn.run_handle`.
   - If `handle.messages_snapshot` is non-empty, pass it as
     `partial_history`.
   - If there is no handle or no snapshot, current behavior is identical.
   - Timeout and shutdown error already share `_persist_partial_guarded`; they
     get the same history behavior automatically.

4. **Mark continuation context in the next prompt.**
   - In `run_turn._prepare_turn_input`, detect when the previous record's
     terminal status was `cancelled` or server-side `error` and the current
     `messages` include model history after that record's `messages_offset`.
   - Prefix the new user prompt content with:
     ```text
     [Request interrupted by user - the previous run was stopped; its completed steps above are real.]
     ```
   - Use ASCII hyphen in the actual prompt string.
   - Do not store a separate marker in state; the marker is part of the new
     user prompt sent to the model. The checkpoint then remains ordinary
     provider history.
   - For timeout/shutdown `error`, use:
     ```text
     [Previous run ended early on the server; its completed steps above are real.]
     ```

5. **Keep ghost-turn guards.**
   - If a turn is cancelled before `meta`, keep current behavior: no record.
   - If cancelled after `meta` but before any snapshot/prose, build only the
     honest cancelled record; do not append an empty response.
   - Cancel during parked-compat clarify continuation keeps `_partial_anchor`
     replacement semantics.

6. **Update architecture language.**
   - `docs/ARCHITECTURE.md` §27.7 G2 should say:
     completed partial provider history is persisted when available; the prose
     invariant is now the tail fallback, not the whole cancel/error rule.

### Phase 1 tests

Add to `tests/app/test_turn_persistence.py`, `tests/app/test_turns.py`, and
`tests/app/test_run_turn.py`.

Required gates:

1. Stop after two complete tool cycles, then ask a follow-up. A scripted model
   asserts its `message_history` includes both tool call/return pairs.
2. Stop after a tool call is issued but before its result. Persisted messages
   end at the previous safe boundary; replay validator passes.
3. Stop before any model response. Messages remain unchanged, and the existing
   ghost-turn guard holds.
4. Stop after answer prose streamed past the latest safe snapshot. The
   transcript record shows the streamed prose; provider messages include the
   prose tail only if it can anchor legally.
5. Cancel during parked-compat clarify continuation still replaces the parked
   record and freezes `clarify.answer`.
6. Watchdog timeout and shutdown drain persist snapshots with `status:"error"`;
   shutdown is not mislabeled as cancelled.
7. Edit/regenerate still slices at `messages_offset` and refuses corrupt
   targets.

## Phase 2 — mid-run steering (send while it works)

Goal: the composer stays usable during a run. A message sent mid-run appears
immediately in the transcript and is injected into the next legal model request
boundary.

### Backend wire/API

1. **Add endpoint.**
   - Route:
     `POST /v1/sessions/{session_id}/steer`
   - Body:
     ```python
     class SteerBody(BaseModel):
         text: str = Field(min_length=1, max_length=4000)
     ```
   - Dependencies:
     `require_json`, `message_rate_limit`, `current_active_user`,
     `owned_session`.
   - Response:
     - active run: `202 {"status":"queued","user_message_id":"..."}`
     - idle/no active run: `409 {"status":"idle"}` or a normal error envelope
       with a machine-readable `status`. The frontend falls back to
       `sendMessage`.
   - Do not update source config or title from steer; it is not a new turn.

2. **Add domain event.**
   - `domain.events.EventType` gains `"user_message"`.
   - Add `UserMessageData` and `ev_user_message(text, user_message_id, injected)`.
   - FE `ProtocolEvent` and `protocolEventTypes` gain it.
   - SSE validator accepts it.

3. **Registry API.**
   - Add exceptions:
     `NoActiveSteerTarget` (route maps to 409 idle).
   - Add:
     ```python
     async def steer(self, session_id: str, text: str) -> dict[str, str]:
     ```
   - Synchronous claim rules:
     - read `_turns[session_id]`
     - require `turn.finalized is False`
     - require `turn.run_handle is not None`
     - require task alive and not cancelling
   - Create `SteeringMessage(user_message_id=str(uuid4()), text=text.strip())`.
   - Append it to `turn.run_handle.steering_queue`.
   - Broadcast `ev_user_message(..., injected=True)` immediately through the
     same observation/buffer path used by model events.
   - Append `("user", payload)` to `turn.emissions` so cancel/timeout partial
     records replay the bubble.

4. **Avoid duplicate observation logic.**
   - Extract a helper in `TurnRegistry`:
     ```python
     def _append_observed(self, turn: _Turn, event: Event) -> None:
         observed = self._observe(turn, event)
         if observed is not None:
             turn.buffer.append(observed)
     ```
   - `_drive` uses it for run events.
   - `steer()` uses it for `user_message`.
   - `_observe` handles `kind == "user_message"` by appending
     `("user", event.data)` to `turn.emissions`.

### Backend injection loop

1. **Drain at legal boundaries only.**
   - In `run_agent_node`, get:
     `handle = deps.run_handles.get(session_id)` when possible.
   - Before running a `CallToolsNode`, drain queued steering texts into
     `node.user_prompt` if the node's response contains tool calls and will
     produce another model request.
     - Multiple queued messages join in arrival order.
     - Use clear separators:
       ```text
       Student sent this while you were working:
       <message 1>

       Student sent another message while you were working:
       <message 2>
       ```
     - Keep the text as user prompt content, not system prompt content.
   - Before running a `ModelRequestNode`, if queue is non-empty, append
     `UserPromptPart`s to `node.request.parts` only if the request has not yet
     streamed. This catches the small race where a message arrives after tools
     finished but before the next model request starts.
   - Do not inject into a final-output `CallToolsNode`; if the model is ending,
     leave queued items for the run-end flush.

2. **Record injected user segments in the node record.**
   - When the node drains a steering message for injection:
     - set `message.injected = True`
     - append `("user", payload)` to the node's local `emissions` **without**
       writing another wire event
   - The registry already broadcast the user bubble live. The node records it
     so the happy-path turn record includes it.
   - For cancellation, the registry's `turn.emissions` already includes it.

3. **Snapshot after injection.**
   - A snapshot after the next request/response boundary naturally includes the
     injected user prompt in provider history.
   - The replay validator must allow additional `UserPromptPart`s after tool
     returns in the same `ModelRequest`.

4. **Run-end flush.**
   - If `run_agent_node` exits with messages still in `handle.steering_queue`,
     move them to `handle.queued_at_terminal`.
   - After the stream terminal but before finalization, `TurnRegistry._drive`
     emits `user_message(..., injected=False)` for each leftover in order, then
     emits the terminal event. Practically, because `done/error` is currently
     emitted by `run_turn`, implement this before the first terminal append:
     `_observe` sets `terminal_appended`, so intercept in `_drive` when
     `event.type in ("done", "error")`: flush leftovers, then append terminal.
   - These non-injected messages are **not** added to `turn.emissions` and do
     not enter the completed turn record.

5. **Clarify/park interaction.**
   - Agent V1 does not mount `ask_student`, but legacy clarify paths exist.
   - If a run parks (`done(awaiting_input)`) with queued steering not injected,
     flush as `injected:false`. Do not treat it as a clarify answer.
   - A normal composer submit after parked still follows the existing clarify
     answer path.

### Frontend transport

1. **Types.**
   - Add `SteerMessageInput`, `SteerMessageResult`, and
     `ChatTransport.steerMessage`.
   - Add `user_message` event type and `TranscriptSegment` kind `"user"`.

2. **Transport implementation.**
   - `chatTransport.steerMessage({sessionId,text})` POSTs to `/steer`.
   - On `202`, returns queued id.
   - On `409 idle`, throws/returns a typed idle result so the engine can call
     normal `submitMessage`.
   - Do not clear the Last-Event-ID cursor for steer; it is the same active
     turn.

3. **Reducer.**
   - `Segment` gains:
     ```ts
     | { type: "user"; id: string; text: string; injected: boolean }
     ```
   - `reduceTurn` handles `user_message`.
   - `transcriptSegmentsToEvents` maps record `{kind:"user"}` to
     `user_message`.
   - `segmentKey` uses `user-${id}`.

4. **Rendering.**
   - `SegmentBeat` renders `user` as a right-aligned user bubble inside the
     assistant run flow.
   - It visually matches normal user bubbles but is nested in the run
     rhythm: no separate outer message row, no duplicate timestamp/actions.
   - If `injected:false`, render identically; the engine will send it as the
     next turn after terminal, so it will also appear as a normal user message.
     To avoid visible duplication, remove the non-injected inline segment once
     the follow-up send is committed, or mark it as pending-converted and hide
     it from the settled assistant record.

5. **Engine behavior.**
   - `submitMessage` changes:
     - If `liveTurnRef.current !== null` and no `replaceMessageId`, call
       `transport.steerMessage(...)` instead of canceling.
     - Keep edit/regenerate behavior unchanged; replacing a prior message while
       a turn is live should still refuse or require stop first.
   - User bubble:
     - Do not add a separate persisted outer user message for steer.
     - The `user_message` event from the server is the source of truth.
     - Wait for the server `user_message` event in V1. Do not build an
       optimistic client-only steering segment; avoiding reconciliation is more
       valuable than the few milliseconds of extra immediacy.
   - On `409 idle`, fall back to normal `startSend`.
   - On terminal with one or more `injected:false` events, queue them in the
     engine and auto-call `submitMessage(text)` after the current stream
     settles. Guard against loops: only auto-send `injected:false` messages
     once.

6. **Composer.**
   - Keep composer enabled while `isSubmitting`.
   - Stop button remains available.
   - Enter submits steer during live turn.
   - Disable source controls while a turn is live. Steering uses the active
     run's source config; source changes apply to the next normal turn.

### Phase 2 tests

Backend:

1. `POST /steer` active returns 202 and emits `user_message` to all consumers.
2. `POST /steer` idle returns 409 idle.
3. Reattach with `Last-Event-ID` replays `user_message` in order.
4. Steer during a tool cycle is injected into the next model request after the
   tool result, not before.
5. Two steers preserve arrival order.
6. Steer racing run end emits `injected:false` before terminal and is not in
   the turn record.
7. Cancel after injected steer persists the user segment and provider history.
8. Cancel before injected steer flushes it as `injected:false` or drops it only
   if no `user_message` was ever acknowledged.

Frontend:

1. `useTurnEngine` sends `steerMessage` instead of canceling when a run is live.
2. `user_message` event renders a right-aligned bubble inside the assistant run.
3. `409 idle` from steer falls back to normal `sendMessage`.
4. `injected:false` terminal path auto-sends one normal next message.
5. Reattached stream with `user_message` reconstructs the same segments.
6. Existing cancel tests are rewritten: active submit no longer cancels; stop
   button still cancels.

## Phase 3 — one transcript artifact (frontend close-out)

Goal: every user-facing export/copy/share of an assistant turn treats the
whole run as the assistant message.

### Implementation steps

1. **Add `runMarkdownOf`.**
   - File: `frontend/src/features/ai-chat/turn-reducer.ts`.
   - Signature:
     ```ts
     export function runMarkdownOf(stateOrSegments: TurnState | Segment[]): string
     ```
   - Serialization rules:
     - `narration`: plain paragraph text
     - `tool`: `- <label>` plus receipt text when present
     - `user`: blockquote line `> <text>`
     - `answer`: markdown verbatim
     - `viz`: markdown table with title, school names, row labels, and display
       values; include citation vintage/source in compact parentheses when
       available
     - `thinking`: omitted from copy
   - Use existing `receiptText(step)` from `activity-trace-helpers`.
     Move it to a reducer-safe utility if importing from components would
     create a bad dependency direction.

2. **Use it in `ChatMessage`.**
   - `AssistantChatMessage` gains `runMarkdown: string`.
   - `assistantMessage(...)` computes it from `state.segments`.
   - `CopyAction` receives `message.runMarkdown`, not `message.text`.

3. **Audit `message.text` usages.**
   - Keep `message.text` as final citeable answer prose for old consumers,
     title defaults, tests, and dumb display.
   - Anything user-facing that means "copy/export the assistant response" must
     use `runMarkdown`.
   - `answerBlocksOf` stays as the answer/citation subset and its doc comment
     should say "answer subset", not "copyable artifact".

4. **Inline step styling polish.**
   - `DefaultToolWidget` should read like one beat in prose flow:
     - same left edge rhythm as narration/answer
     - no heavy grouped container around consecutive steps
     - status dot/spinner/check is compact
     - receipt line has good typography, not debug weight
   - Keep `PlanChecklist` pinned special-case for `write_plan`.
   - `MessageSources` stays at the end of a settled run.

5. **Manual visual check.**
   - Run API + frontend.
   - Ask a multi-tool question that produces narration, at least one tool, and
     final answer. Use a prompt that requests a comparison table so a viz is
     expected.
   - Screenshot light/dark and desktop/mobile into `artifacts/`.

### Phase 3 tests

1. `runMarkdownOf` includes narration, tool labels/receipts, user steering
   bubbles, answer markdown, and viz table.
2. `runMarkdownOf` omits thinking text.
3. `CopyAction` copies the whole run string.
4. `message.text` remains answer-only.
5. Existing citation/source tests still use answer blocks and pass.

## Phase 4 — nothing hidden (thinking + tool detail)

Goal: native provider thought output is visible by default as one collapsed
episode per continuous thinking run, and tool detail rendering is formally
limited to public payloads.

### Thinking implementation

1. **Rename the setting with compatibility.**
   - Add `thinking_stream: bool = True` to `config.Settings`.
   - Keep `thinking_summaries: bool | None = None` for one release as a
     deprecated compatibility field. Effective value:
     `thinking_stream if thinking_summaries is None else thinking_summaries`.
     This lets existing `COUNSELLE_THINKING_SUMMARIES` deployments keep their
     behavior while new code uses `COUNSELLE_THINKING_STREAM`.
   - Add a settings test for both env names and document that the old name will
     be removed after this feature stabilizes.
   - In `run_agent_node`, gate Gemini `include_thoughts` on
     `settings.thinking_stream`.
   - Keep the provider caveat in comments/docs:
     Gemini exposes native thought output via `include_thoughts`; it is the
     rawest trace Google exposes through the API, not private internal CoT
     tokens. Counselle displays that provider output byte-for-byte.

2. **Merge consecutive thinking events in the frontend reducer.**
   - In `reduceTurn`, when a `thinking` event arrives and the last segment is
     `thinking`, append `"\n\n" + text` to that segment instead of creating a
     new segment.
   - If a narration/tool/user/answer/viz segment occurs, the next thinking
     event starts a new episode.
   - Keep backend paragraph streaming unchanged. Wire granularity remains
     useful; rendering coalesces episodes.

3. **Thinking labels.**
   - Live label: `Thinking`.
   - Settled label for now: `Thought`.
   - Later duration can use segment arrival timestamps; do not invent duration
     now from whole-turn time.

4. **Tests.**
   - Settings test asserts default `thinking_stream` is true.
   - Router test asserts `ThinkingPart` text is emitted verbatim.
   - Reducer test asserts consecutive thinking events render as one segment
     with exact concatenated text.
   - Render test asserts one collapsed row for one episode.

### Tool detail implementation

1. **Document the dual-channel contract.**
   - `domain.events.StepDetail` docstring:
     public, student-safe receipt fields only; no raw tool result.
   - `domain.events.ToolUi` docstring:
     structured public UI payload for widget rendering.
   - `app.tool_specs.ToolSpec.receipt` docstring:
     everything the generic UI may render from this tool.

2. **Tighten generic rendering.**
   - `ToolWidgets.tsx` already has a registry keyed by `step.ui.widget`.
   - Add a clean expandable detail area to `DefaultToolWidget`:
     - rows for public `StepDetail` fields that are approved for students
     - do not render `field_keys` or `row_count` (already marked internal)
     - do render `query`, `summary`, `domains`, `result_count`,
       `value_count`, `duration_ms`, `tool`, `viz_type`, `schools`, `items`,
       `completed/total`, `next_actions`, `error` when present and safe
   - Use labels, not raw key names.
   - If `step.ui` exists and a widget is registered, that widget owns its view.
     The generic detail can still be available under a small disclosure if it
     adds value.

3. **Tests.**
   - Unknown/future `step.kind` falls back to `DefaultToolWidget`.
   - Unknown/future `step.ui.widget` falls back to `DefaultToolWidget`.
   - Generic widget renders every allowed `StepDetail` field.
   - Generic widget does not render `field_keys`, `row_count`, or arbitrary raw
     extra data.
   - Tool middleware tests still prove raw top-level `ui` is stripped/demoted
     before model-visible result where applicable.

## Docs and ADR updates

Do these after Phases 0-4 are implemented and tests are green.

1. **New ADR.**
   - Title: `The run is the message`.
   - Decisions:
     - `agent.iter` is the loop seam for snapshots and steering.
     - cancel/error/timeout persist last replay-safe provider history snapshot.
     - mid-run user text is a `user_message` event and a `user` segment.
     - non-injected queued messages are client-owned next-turn sends.
     - raw tool results are never UI.
   - Explicitly supersede the prose-invariant-only reading of §27.7 G2.

2. **`docs/ARCHITECTURE.md`.**
   - §27 event protocol: add `user_message`.
   - §27 turn lifecycle: add steering and snapshot persistence.
   - §27.7 G2: update prose invariant language.
   - §18 model settings: rename/default thinking setting.

3. **`specs/mvp2/plan/wire-contract.md`.**
   - Add `narration` current truth if still missing/stale.
   - Add `StepData.ui`.
   - Add transcript `segments[]` as the chronological replay surface.
   - Add `user_message` event and transcript `user` segment.
   - Add `/steer` endpoint.

4. **`TODOS.md`.**
   - Record deliberate non-goal:
     server-side auto-start of queued next turns after active run completion.

## Order and gates

Implement in this order:

1. Phase 0: `agent.iter` loop and safe snapshots.
2. Phase 1: cancel/error/timeout snapshot persistence.
3. Phase 2: mid-run steering.
4. Phase 3: copy and visual close-out.
5. Phase 4: thinking default + tool detail contract.
6. Docs/ADR.

Rationale:
- Phase 0 is a hard dependency for both snapshot persistence and injection.
- Phase 1 should land before Phase 2 because stop-continuity is the
  trust-critical behavior and reuses the same handle.
- Phase 3 can land after Phase 2 because `user` segments affect copy.
- Phase 4 can technically land earlier, but keeping it after steering avoids
  mixing provider-thought behavior with loop mechanics during the risky part.

Per-phase verification:

```bash
uv run pytest -m "not live_llm and not live_search and not live_db"
uv run ruff check . && uv run mypy .
cd frontend && npm run typecheck && npm test
```

Run frontend checks only for phases touching frontend code.

For Phase 0 specifically, do not proceed without the golden stream-equivalence
test. An unverified loop rewrite is too risky to build on.

## Risk register

1. **`agent.iter` fidelity.**
   - Risk: stream events differ from `run_stream_events`.
   - Mitigation: golden equivalence test; keep `EmissionRouter` unchanged.

2. **Capability hook bypass.**
   - Risk: bare `async for node in agent_run` skips hooks.
   - Mitigation: use `agent_run.next_node` + `await agent_run.next(node)`.

3. **Dangling tool calls on replay.**
   - Risk: Gemini rejects histories with unpaired tool calls.
   - Mitigation: snapshot only at validated safe boundaries; add validator
     tests.

4. **Duplicate user bubbles.**
   - Risk: optimistic steer segment plus server `user_message` plus auto-send
     creates duplicates.
   - Mitigation: server event is source of truth for injected messages; hide or
     remove `injected:false` inline segment when converted to next turn.

5. **Happy-path record misses steering.**
   - Risk: registry sees `user_message`, but node-built complete record does
     not.
   - Mitigation: node appends `("user", payload)` to local emissions when it
     injects steering.

6. **RunHandle lifecycle leaks.**
   - Risk: stale handle steers/snapshots a dead run.
   - Mitigation: registry-owned identity-aware register/unregister in
     `_drive` `try/finally`.

7. **Terminal ordering.**
   - Risk: `injected:false` events emitted after `done/error` are invisible
     because buffers close at terminal.
   - Mitigation: flush queued-at-terminal before appending terminal event.

8. **Thinking provider caveat.**
   - Risk: "raw thinking" overclaims what Gemini exposes.
   - Mitigation: docs say provider thought output is displayed verbatim; no
     claim that Google exposes private internal CoT tokens.

9. **Checkpoint compatibility.**
   - Risk: old records lack `segments`, `user`, or `ui`.
   - Mitigation: all fields additive/optional; existing transcript fallback
     remains.

10. **Rate-limit semantics.**
    - Risk: steering bypasses message caps.
    - Mitigation: `/steer` uses `message_rate_limit` like message send.

## Definition of done

This work is done when:

- A multi-tool run renders as one chronological assistant message.
- Copy copies the chronological run, not just final answer prose.
- Stopping after completed tool cycles and then continuing gives the model
  those completed tool calls/results in history.
- Stopping mid-tool never persists a dangling tool call.
- Sending while the agent works queues visibly and injects at the next legal
  boundary.
- Raced end-of-run steering becomes the next normal message without losing the
  user's text.
- Reattach and transcript reload preserve `user_message`/`user` ordering.
- Thinking is on by default and collapsed as one episode per continuous
  provider thought run.
- Tool UI renders only public `StepDetail`/`ToolUi` payloads.
- Routine backend checks and relevant frontend checks pass.
