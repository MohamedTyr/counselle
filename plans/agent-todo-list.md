# Implementation Plan: Agent Todo List — Plan Reminder Capability

Status: Draft for review
Date: 2026-07-10
Branch: feat/mvp3-frontend-prototype

## Goal

Close the gap between "the agent *has* a plan tool" and "the harness *keeps the
agent on its plan*". Today `write_plan` (vendored from pydantic-ai-harness per
D13, `app/plan_tool.py`) records the plan once — and then nothing ever surfaces
it again. On a long run the plan scrolls out of the model's attention with
every tool result that lands after it, which is exactly when focus is lost.

The fix is the other half of the harness `Planning` capability we deliberately
did not vendor: an **ephemeral plan reminder** appended to the tail of every
model request while a plan exists. The agent re-reads its own checklist on
every step without us adding a single new tool, without touching the durable
message history, and without invalidating the prompt cache.

## The reference design (pydantic-ai-harness `experimental/planning`)

Studied at HEAD (`pydantic/pydantic-ai-harness`, MIT). Two pieces, 191 lines
total:

1. **`PlanningToolset`** — a single `write_plan(items)` tool. Full-plan
   replacement on every call, four statuses
   (`pending/in_progress/completed/cancelled`), a rendered checklist in the
   return, and a corrective nudge when more than one step is `in_progress`.
   **Already vendored** as `app/plan_tool.py` (we extended the return into our
   receipt envelope for the FE checklist; keep that).
2. **`Planning` capability** — the part we skipped. Its `wrap_model_request`
   hook appends `<plan-reminder>…current checklist…</plan-reminder>` to the
   *last* message of each outgoing request, prefixed by a `CachePoint`. Key
   properties, verified against their implementation:
   - **Ephemeral.** The mutation happens on the per-request message list after
     core has persisted durable history; the reminder never enters
     `message_history`. No stale reminders accumulate, replay stays clean.
   - **Cache-safe.** The reminder sits *after* a cache breakpoint at the tail,
     so the cached prefix stays byte-identical across turns. The mutable plan
     is never injected into the system prompt (that would bust the cache on
     every update).
   - **No burden.** Static usage guidance lives in the system prompt
     (cache-stable); the model owns the plan through one tool; the reminder is
     read-only context, not another instruction to obey.
   - **Subagent-ready.** `for_run()` clones the capability with fresh state, so
     the same instance can be listed in `SubAgents(shared_capabilities=[…])`
     and every child gets an isolated plan. This is how the harness gives
     subagents the todo feature — relevant when D12 (deep-research subagent,
     nested run groups) lands: our capability slots in with zero extra work.

This is also the shape every serious harness converged on (Claude Code's
`TodoWrite` is the same design: one full-replacement tool + injected
`<system-reminder>` surfacing the current todo state, nudging only when
relevant). Single tool, model-owned state, harness-injected recall.

## The second reference (LangChain deep agents)

Studied `langchain-ai/deepagents` at HEAD ("the batteries-included agent
harness", 26k stars) plus the `TodoListMiddleware` it composes from
`langchain/langchain` (`langchain/agents/middleware/todo.py`). Same converged
core — one `write_todos(todos)` tool, full-list replacement, model-owned —
with these deltas worth reacting to:

- **No dynamic reminder.** The middleware appends *static* guidance to the
  system prompt every request and relies on the tool's own `ToolMessage` echo
  ("Updated todo list to …") sitting in history for recall. Nothing re-surfaces
  the list at the request tail. Our `write_plan` receipt already persists in
  history the same way, so counselle today ≈ deepagents minus their prompt
  depth. The pai-harness/Claude Code ephemeral reminder is strictly stronger on
  the "didn't lose focus" axis (recency at every request, zero history growth),
  so we keep it — this is the one place the two references disagree, and we
  side with the harness.
- **Battle-tested prompt text is where deepagents wins.** Their tool
  description is essentially Claude Code's `TodoWrite` description: explicit
  *when-NOT-to-use* rules ("if the task is trivial / under 3 steps, do NOT use
  this tool" — the anti-burden rule, verbatim what we want), completion-honesty
  rules ("ONLY mark completed when FULLY accomplished; if you encounter errors
  or blockers, keep it in_progress and add a task describing the blocker" —
  straight into counselle's honesty pillar), immediacy ("mark completed
  IMMEDIATELY, don't batch"), and a finishing rule ("the final answer must be
  the message AFTER your last `write_todos` call — marking the last todo
  complete is not itself an answer"). Our current `write_plan` docstring is the
  short harness one; Phase 1 upgrades it with these lines.
- **Parallel-call guard.** Full replacement + two parallel `write_todos` calls
  = ambiguous precedence; deepagents rejects the whole response with error
  `ToolMessage`s in an `after_model` hook. We take the rule but not the
  machinery: one line in the tool description ("never call `write_plan` more
  than once in parallel") — a loop-level enforcement hook is not worth its
  weight for a last-write-wins race on a steering artifact (documented risk
  below).
- **Statuses.** They drop `cancelled` (rule: delete irrelevant items instead).
  We keep our four — `cancelled` is honest visible history in the FE checklist
  ("agent decided not to do this") rather than a silent disappearance.
  They allow multiple `in_progress` for parallelizable work; our loop is
  sequential, so the harness's exactly-one rule stays.
- **Subagents confirm the D12 story.** Every deepagents subagent (including
  the auto-added general-purpose one) gets its **own** `TodoListMiddleware`
  instance in its middleware stack, and `todos` is in the state keys explicitly
  excluded from flowing between parent and child in either direction. Todo
  lists are strictly per-agent-context — exactly the pai-harness
  `shared_capabilities` + `for_run` isolation we planned, independently
  converged on by both harnesses.

## Discovery: the D13 blocker is stale

D13 (agent-mode architecture plan) recorded that pydantic-ai-harness needs the
v2 capabilities API (`pydantic-ai-slim>=2.1.0`) and deferred the reminder trick
to a future framework upgrade. **Our pinned pydantic-ai 1.107.0 now has the
full capabilities API**: `Agent(capabilities=…)`,
`AbstractCapability.wrap_model_request` with the exact signature the harness
uses, `CachePoint`, and `for_run`. Verified live against `.venv`:

- The harness `Planning` capability runs **verbatim** on 1.107.0: second model
  request carries `[CachePoint, '<plan-reminder>…']` at the tail; durable
  history (`result.all_messages()`) contains no reminder.
- Same result through **`agent.iter()`** — our driver (`agent_node.py:645`).
- `CachePoint` is **silently skipped by the Google model**
  (`pydantic_ai/models/google.py` maps it to a no-op with a comment pointing at
  Google's explicit-cache API) and honored by Anthropic — cross-provider safe,
  consistent with ADR 0011 (model-agnostic backend).

So no framework upgrade, no dependency, no fork: we vendor ~40 more lines.

## Current state (verified 2026-07-10)

- `app/plan_tool.py` — `TaskStatus`, `PlanItem`, `PlanState`, `render_plan`,
  `make_write_plan_tool`. The tool writes into a `PlanState`, but the state is
  created inside the factory and **nothing ever reads it back**.
- `app/agent_node.py:557` — `Tool(make_write_plan_tool(), takes_ctx=False)`
  mounted per turn; `Agent(...)` is built fresh each turn (replay-safe) and
  passes no `capabilities`.
- `app/steps.py:242` — `write_plan` receipts map to the plan step kind
  (`_plan_detail_kwargs` cleans `public_receipt` into `detail.items` /
  `completed` / `total`). Start events carry `detail=None`; items arrive on the
  end event. No backend changes needed for the FE.
- **Frontend: the pinned checklist is dead code.**
  `PlanChecklist` (`AgentRunView.tsx:33` — status icons, `completed/total`
  counter, muted completed rows) exists and is unit-tested, and
  `latestPlanStep` (`activity-trace-helpers.ts:18`) exists — but **neither is
  called from the render tree**. The `ChatMessage.tsx:129` docstring promises
  "`write_plan` tool segments are suppressed here; the pinned `PlanChecklist`
  above the stream renders the latest one instead" — neither half is
  implemented: `write_plan` currently renders as a generic
  `DefaultToolWidget` beat labeled "Updating the plan" (step_labels.yaml:81),
  and no checklist ever appears. The architecture plan (line 714, "Render
  `write_plan` receipts as one pinned checklist that updates in place") is the
  documented target this plan finishes.
- `config/assets/prompts/counselor.md:62` — static planning guidance already in
  the system prompt ("when `write_plan` is present, call it and update it…").
  Cache-stable, exactly where the harness puts its guidance. No changes needed.
- `tests/app/test_plan_tool.py` — covers the tool logic.

## Design

Backend: one new class, one shared object, one constructor argument, one
richer tool docstring. Frontend: wire the two already-built, already-tested
pieces into the render tree. No new tools, no new step kinds, no new events,
no API changes.

### 1. `PlanReminder` capability (`app/plan_tool.py`, ~40 lines)

Vendor the harness `Planning._capability.py` logic, adapted to our layout:

```python
@dataclass
class PlanReminder(AbstractCapability[Any]):
    """Ephemeral tail reminder of the current plan (harness Planning, D13)."""

    state: PlanState
    cache_ttl: Literal["5m", "1h"] = "5m"

    async def wrap_model_request(self, ctx, *, request_context, handler):
        items = self.state.items
        if not items:
            return await handler(request_context)
        messages = request_context.messages
        last = messages[-1]
        if isinstance(last, ModelRequest):
            reminder = UserPromptPart(
                content=[CachePoint(ttl=self.cache_ttl), _reminder_text(render_plan(items))]
            )
            messages[-1] = replace(last, parts=[*last.parts, reminder])
        return await handler(request_context)
```

Deliberate deviations from the harness version, and why:

- **No `get_toolset()`.** The harness capability owns the tool; we keep
  `write_plan` in `extra_tools` where it already lives, wired to the same
  `PlanState`. Capability-owned toolsets add an ownership layer
  (`CapabilityOwnedToolset`) we get nothing from, and our tool's receipt
  envelope (FE checklist contract) stays untouched.
- **No `get_instructions()`.** Guidance already lives in `counselor.md` and is
  covered by prompt tests. Two sources of the same instruction is drift bait.
- **No `for_run()` override needed yet.** We build a fresh Agent + state per
  turn, so per-run isolation is already guaranteed by construction. When D12
  subagents arrive, add the harness's one-line `replace(self)` clone.

### 2. Wiring (`app/agent_node.py`, ~4 lines changed)

```python
plan_state = PlanState()
extra_tools = [Tool(make_write_plan_tool(plan_state), takes_ctx=False), ...]
...
agent = Agent(..., capabilities=[PlanReminder(plan_state)])
```

One-way data flow: the tool writes `PlanState`, the capability reads it. The
state is per-turn, rebuilt from nothing each turn — same replay-safety story as
every other per-turn object in `run_agent_node` (module docstring rule).

### 3. Tool docstring upgrade (`app/plan_tool.py`)

Replace the short harness docstring on `write_plan` with the battle-tested
deepagents/Claude Code text, trimmed to counselle (a tool description is
static per run — cache-safe — and is the single highest-leverage place for
this guidance). The lines to carry:

- **When not to use** — trivial/single-step/conversational work: skip the tool
  and just do the task (the anti-burden rule).
- **State discipline** — mark `in_progress` before starting a step, mark
  `completed` immediately after finishing (never batch), keep exactly one step
  `in_progress`.
- **Completion honesty** — only mark `completed` when fully accomplished; on
  errors or blockers keep it `in_progress` and add a step naming the blocker.
- **Full replacement + no parallel calls** — pass the entire ordered plan every
  time; never call `write_plan` more than once in parallel.
- **Finishing** — the final answer is the message *after* the last `write_plan`
  call; marking the last step complete is not an answer.

`counselor.md`'s planning paragraph stays as-is (it already says when to plan
and to keep plans 3–6 steps); the operational rules live with the tool.

### 4. Frontend: finish the pinned checklist (`ChatMessage.tsx`, ~15 lines)

Implement exactly what the `ChatMessage.tsx:129` comment already documents —
the two halves that were never wired:

1. **Pin the latest plan above the stream.** In `AssistantBody`, compute
   `latestPlanStep(message.segments)` and, when non-null, render
   `<PlanChecklist step={planStep} />` above the segment list. Because the
   turn-reducer updates segments in place as step events stream, the pinned
   checklist **updates in place automatically** on every `write_plan` — one
   checklist per assistant message, never a trail of stale copies. Historical
   messages replay their final plan state for free (segments are persisted).
2. **Suppress `write_plan` beats in the stream.** In `SegmentBeat`'s `tool`
   case, return `null` for `kind === "write_plan"` — the pinned checklist is
   the single rendering; a generic "Updating the plan" beat under it is noise.

Two polish details that make it feel right, not just present:

- **Skip item-less steps in `latestPlanStep`.** A `write_plan` step's start
  event has `detail=None` (items land on the end event). Prefer the latest
  `write_plan` step *with items* so the checklist never flickers empty during
  the start→end window.
- **Spin the `in_progress` icon only while the turn is live.** `PlanChecklist`
  renders `LoaderCircleIcon` statically today; add `animate-spin` gated on the
  turn's live status (pass `isLive` down, reusing `isLiveStatus`). A finished
  or cancelled run must settle — a spinner on a dead run lies about activity
  (same honesty rule the trace already follows for `awaiting_input`).

Reference check: this matches both harness UIs — Claude Code pins/refreshes
one todo checklist rather than spamming update beats, and deep-agents-ui
renders the `todos` state key as a single panel updating in place.

### 5. Cross-turn behavior (explicit decision)

The reminder is **per-run**, matching the harness. On a new user turn the plan
starts empty and no reminder fires until the agent plans again. The previous
plan is still visible to the model in message history (its own `write_plan`
calls), so nothing is lost — but a stale checklist from a finished task is not
force-fed into a fresh, possibly unrelated request. Within a run — the place
focus actually erodes, up to `agent_max_model_requests` requests — the reminder
fires on every request.

Follow-up option (not V1): rehydrate `PlanState` from the most recent
`write_plan` receipt in `state["messages"]` so multi-turn tasks keep their
checklist alive across turns. ~15 lines when wanted; deliberately out until a
real run shows the need.

## Non-goals

- **No new tools** (`add_task`/`update_task`/`complete_task` CRUD is the
  known anti-pattern; full-plan replacement with one tool is what both the
  harness and Claude Code ship).
- **No plan-completion enforcement** (blocking run end on open items) — the
  reminder + the single-in_progress nudge are the steering mechanism; hard
  gates fight the model.
- **No system-prompt injection of the plan** — busts the prompt cache on every
  update; the whole point of the tail-reminder design is avoiding this.
- **No subagent implementation** — D12 stands. This lands the capability those
  subagents will share when they exist.

## Risk register

1. **Capabilities API interaction with our stream router** — `wrap_model_request`
   wraps the request path only; emissions/steps flow from response parts, so the
   router never sees the reminder. Verified live via `agent.iter()` smoke test;
   Phase 2 pins it with a regression test on durable history.
2. **`messages[-1]` not a `ModelRequest`** — harness guards with `isinstance`
   and silently skips; we keep that guard (a reminder is best-effort steering,
   never worth failing a turn over).
3. **Token cost** — one checklist re-read per request, a few hundred tokens,
   after the cache point. Bounded by plan size (guidance says 3–6 steps).
4. **Parallel `write_plan` calls** — full replacement means two parallel calls
   race last-write-wins on `PlanState` (deepagents rejects these with an
   `after_model` hook). Accepted: the docstring forbids it, the artifact is
   steering-only, and both receipts still render honestly in the trace. If a
   real run ever shows the race, the deepagents-style guard is the known fix.

## File manifest

- `app/plan_tool.py` — add `PlanReminder` + `_reminder_text` (~40 lines);
  upgrade the `write_plan` docstring (§ Design 3).
- `app/agent_node.py` — shared `PlanState`, `capabilities=[…]` (~4 lines).
- `tests/app/test_plan_tool.py` — two focused additions (below).
- `frontend/src/features/ai-chat/components/ChatMessage.tsx` — render the
  pinned `PlanChecklist` in `AssistantBody`; suppress `write_plan` beats in
  `SegmentBeat` (~10 lines).
- `frontend/src/features/ai-chat/components/activity-trace-helpers.ts` —
  `latestPlanStep` skips item-less steps (~3 lines).
- `frontend/src/features/ai-chat/components/AgentRunView.tsx` — `isLive` prop
  on `PlanChecklist`, `animate-spin` on the in-progress icon (~5 lines).
- FE tests — `ChatMessage.test.tsx`: pinned checklist renders + `write_plan`
  beat suppressed; extend the existing `PlanChecklist` cases in
  `AgentRunView.test.tsx` for the spin gate.

## Phases

### Phase 1: capability + wiring + docstring

Port the `wrap_model_request` body from the harness `_capability.py` (keep
their comment discipline about why the mutation is ephemeral). Wire the shared
state in `agent_node.py`. Upgrade the `write_plan` docstring with the
deepagents/Claude Code rules (§ Design 3).

### Phase 2: pin the two behaviors that matter

Per the testing stance (AGENTS.md: no reflexive tests; do test what breaks
honesty/replay), exactly two:

1. **Reminder fires ephemerally** — FunctionModel run where request 1 calls
   `write_plan`; assert request 2's tail carries the `<plan-reminder>` and the
   rendered checklist.
2. **Durable history stays clean** — after the same run, assert no message in
   `result.all_messages()` contains `plan-reminder`. This is the
   checkpointer/replay-critical property: a leaked reminder would be persisted
   and re-sent forever.

Gate: routine suite green (`uv run pytest -m "not live_llm and not live_search
and not live_db"`), `ruff` + `mypy` clean.

### Phase 3: frontend wiring

The § Design 4 changes: pinned checklist + beat suppression + the two polish
details, with the FE tests from the manifest. Gate: `cd frontend && npm run
typecheck && npm test`.

### Phase 4: live sanity (manual, one run)

One real multi-step prompt through the API (:8000 backend + :5173 Vite, per
the in-browser gate setup). Confirm: the checklist pins above the stream and
updates in place as steps complete; no duplicate "Updating the plan" beats;
the spinner settles when the run ends; a replayed (reloaded) session shows the
final plan state; and the agent visibly returns to its plan after tool
detours.
