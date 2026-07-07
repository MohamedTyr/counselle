# Counselle Agent Mode Architecture Plan

Date: 2026-07-07
Branch: feat/mvp3-frontend-prototype
Status: scoped; implementation not started

## Purpose

This plan turns the agent design notes into an implementation blueprint.

The goal is to replace the old counselor/chat behavior with one transparent,
Codex-style agent mode. Counselle should stop feeling like a chatbot that
thinks briefly and then answers. It should feel like a real agent run:
it receives a task, plans, uses skills and tools, observes results, recovers
from failures, keeps working when the path is unclear, and ends with a useful
answer or artifact.

The earlier scratch design notes have been consolidated into this document.
This is now the canonical architecture and execution plan for Agent V1.

## Why We Are Doing This

Counselle is supposed to be the AI agent for college admissions, not a normal
chat assistant. The current shape is too chat-like:

- user asks
- model thinks/narrates
- model calls some tools
- model gives an answer

That works for short Q&A, but it is not enough for the product we are building.
Students will eventually ask Counselle to work through messy, multi-step
admissions tasks:

- compare schools with conflicting evidence
- inspect current workspace state
- research deadline changes
- build application plans
- reason about essays and activities
- update tasks or essays once write tools exist
- continue running in the background while the student watches progress

That needs an agent loop, not a chat turn.

We are aiming for the behavior users already understand from agents like Codex
and Claude Code:

- visible plan
- visible tool calls
- visible exploration
- visible failures and retries
- final answer as the last part of the run
- enough transparency to trust the work
- no raw chain of thought

The key product bet is trust. A student should be able to see what Counselle
checked and why. The UI does not need to be fancy in V1, but the run must be
observable and honest.

## What We Are Aiming To Build

Agent V1 is one mode only.

There is no Ask/Agent/Research picker yet. Agent mode replaces the old AI
counselor/chat behavior completely.

The first implementation is about the agent brain and architecture, not
frontend polish. The V1 UI can be minimal and raw-safe:

- transcript rows
- step rows
- tool names
- labels
- safe receipts
- errors and retries
- artifacts such as visualizations
- final answer

The first implementation is also not about adding new workspace tools. Existing
tools must become clean, observable, and agent-friendly first. Once that works,
workspace read/write tools can use the same pattern.

## MVP Scope

Build now:

- one agent mode replacing old counselor behavior
- stronger PydanticAI agent loop
- tolerant frontend SSE reader before any new backend step kinds
- simple model-owned planning tool
- longer agent-run limits
- minimal long-run context hygiene: production-time overflow of oversized tool
  results only (spill + read-back), vendored from pydantic-ai-harness where it
  is actually useful
- token-based run budget as the cost ceiling
- transparent run log from existing step events
- cleaner tool result and receipt contracts
- one ToolSpec registry so tool metadata lives in one place (D14)
- a docstring pass treating tool descriptions as prompt engineering
- agent-visible visualization values
- minimal frontend run surface and safe receipts for all tool kinds
- phase-by-phase live E2E feedback loop with visible agent traces
- orchestrated implementation using implementer, reviewer, fixer, and E2E
  subagents
- tests around the agent loop, tool receipts, and visualization result shape

Do not build now:

- mode picker
- permissions layer
- approval gates
- rich diff UI
- new workspace/write tools
- `ask_student` / clarify interrupts in Agent V1
- subagent execution
- exact mid-run resume after process crash
- a separate agent console frontend
- broad frontend redesign or chat-chrome polish pass
- custom orchestration framework
- raw chain-of-thought display

## Architecture Summary

The clean architecture is:

```text
TurnRegistry
  owns: detached run task, reattach, cancel, timeout, partial persistence

LangGraph
  owns: durable session state, temporal context, later multi-node expansion

PydanticAI Agent
  owns: reasoning loop, planning, tool choice, retries, stopping, final answer

Tool Layer
  owns: typed tools, implementation, result shape, receipts, artifacts

Event Stream
  owns: observable step/thinking/viz/sources/usage/done/error protocol

Frontend
  owns: rendering transcript rows, generic receipts, artifacts, final answer
```

This is deliberately not a new runtime. We already have the right spine:

- `app/turns.py`: detached turn supervisor
- `app/graph.py`: LangGraph shell and checkpointed state
- `app/agent_node.py`: PydanticAI run with tool loop
- `app/run_turn.py`: graph-to-wire event adapter
- `app/steps.py`: PydanticAI event to step event mapping
- `domain/events.py`: SSE event protocol
- `app/toolset.py`: tool assembly and MCP wrapping
- `app/skills.py`: skill loader (progressive disclosure)
- `app/viz.py`: visualization tool and artifact staging
- `app/viz_placement.py`: final-answer marker placement
- `frontend/src/features/ai-chat/components/ActivityTrace.tsx`: current trace UI

We should evolve these seams, not replace them.

## Core Architecture Decisions

### D1. One Agent Mode Replaces Counselor Chat

The old counselor prompt and behavior should become agent behavior. We can keep
the admissions expertise, citation discipline, temporal context, and warmth,
but the primary identity becomes:

```text
Counselle is an admissions work agent.
```

Not:

```text
Counselle is a chatty counselor that answers after thinking.
```

Code impact:

- Replace or heavily rewrite `config/assets/prompts/counselor.md`.
- Rename later if useful, but do not spend time on cosmetic file moves first.
- `app/prompt.py` can keep loading the same prompt asset initially to reduce
  blast radius.

### D2. LangGraph Owns Lifecycle, Not The Brain

Keep the graph simple for V1:

```text
prepare -> agent -> END
```

LangGraph should own:

- temporal context preparation
- checkpointed state
- session continuity
- later multi-node expansion

LangGraph should **not** own clarify for Agent V1. The current
`ask_student`/`interrupt()` path re-executes the whole agent node on resume,
which means model work and tool calls are replayed. That is acceptable for the
old short chat clarify behavior, but it is the wrong default for a long-running
agent and becomes dangerous once write tools exist.

Agent V1 decision:

- Do not mount `ask_student`.
- The agent should make reasonable assumptions, state them, and continue.
- Clarify without replay belongs to future StepPersistence/job-runner work.

LangGraph should not own the inner reasoning loop in V1. Do not build a custom
node graph like:

```text
plan -> tool -> observe -> decide -> tool -> verify -> answer
```

That would duplicate what PydanticAI already gives us.

### D3. PydanticAI Owns The Agent Loop

`app/agent_node.py` should remain the place where the model, prompt, tools,
usage limits, source registry, visualization staging, and event router are
assembled.

The inner agent loop is:

```text
model request
tool call(s)
tool result(s)
model observes
repeat
final answer
```

This should stay inside PydanticAI's `run_stream_events()` rather than a custom
Python loop.

### D4. TurnRegistry Owns Long-Running Execution

`app/turns.py` already has the right supervisor model:

- POST starts a detached task
- SSE consumer can disconnect without killing the run
- GET stream can reattach with `Last-Event-ID`
- cancel is separate
- timeout creates a terminal error
- partial output is persisted on cancel/error
- transcript is the fallback after the buffer is gone

For agent mode, this becomes more important. We should tune it rather than
replace it.

Agent V1 long-run stance:

- Supports long in-process runs.
- Supports reconnecting to an active run.
- Persists transcript/partial output on terminal paths.
- Does not guarantee exact continuation of an active model/tool step after
  process death.

Crash-proof active-run resume is a future StepPersistence/job-runner problem,
not V1.

### D5. Add A Simple Planning Tool

The missing agentic primitive is not a whole planner service. It is a small
model-owned plan tool.

Target tool:

```text
write_plan(items)
```

Rules:

- The model passes the full ordered plan every time.
- Each item has `content` and `status`.
- Status values: `pending`, `in_progress`, `completed`, `cancelled`.
- Keep at most one item `in_progress`.
- The tool returns a readable plan summary.
- The run log shows plan updates as visible steps.

Why this shape:

- It matches the Pydantic AI Harness experimental Planning pattern.
- Full-plan replacement avoids index bugs.
- It is simple enough for MVP.
- It gives the user Codex-like progress without building complex UI.

Where it belongs:

- New small module under `app/`, likely `app/plan_tool.py` or similar.
- Mounted as an extra PydanticAI tool in `app/agent_node.py`.
- Mapped in `config/assets/step_labels.yaml`.
- Persisted naturally as tool-call history and step events.

Do not make a separate plans table yet.

### D6. Tool Contracts Must Separate Audiences

Every important tool result has two audiences:

1. The agent needs structured data to reason.
2. The frontend/user needs a safe public receipt or artifact.

Target conceptual envelope:

```python
{
    "status": "success" | "warning" | "error",
    "summary": "...",
    "result_for_agent": {...},
    "public_receipt": {...},
    "artifacts": [...],
    "provenance": {...},
    "next_actions": [...],
}
```

For error paths:

```python
{
    "status": "error",
    "summary": "...",
    "root_cause": "...",
    "safe_retry": "...",
    "stop_condition": "...",
}
```

This does not mean every existing tool must be rewritten in one huge pass.
It means new cleanup work should move existing tools toward this shape.

The agent should not write frontend copy by hand for each tool call. Tool
metadata and step mapping should own public labels and receipts.

### D7. Existing Tools First

Do not add workspace tools first.

Clean these existing tools first:

- `counselle-db` MCP tools
- Tavily web/search-school-site/Reddit tools
- `render_viz`
- `load_skill`
- do **not** mount `ask_student` in Agent V1
- new `write_plan` because the agent loop needs it

The only new V1 tool should be the planning tool. It is part of the agent loop,
not a product capability expansion.

### D8. Keep Citations, Remove Programmatic Overconstraint

Citations are not the problem. Inline citation instructions are compatible
with agent freedom because the model chooses where citations belong.

Keep:

- citation envelopes
- source registry
- inline markers
- source metadata
- source list event
- citation discipline for factual claims

Relax or remove programmatic constraints that block the agent from reasoning.

The clearest example is `render_viz`: it currently fetches values, stages an
artifact, and returns only a small acknowledgement plus sources and placement
marker to the model. For agent mode, the agent should receive compact
structured values too.

### D9. Preserve Visualization Placement Markers

The current visualization placement mechanism is good:

```text
render_viz -> returns [[viz:1]]
agent places marker in final answer
viz_placement converts marker into streamed viz block
```

Keep this.

Change the agent-facing result so `render_viz` returns enough data to reason:

```python
{
    "status": "success",
    "summary": "Built comparison table with 9 available values.",
    "placement_marker": "[[viz:1]]",
    "result_for_agent": {
        "type": "comparison_table",
        "title": "...",
        "schools": ["Vanderbilt", "Duke", "Rice"],
        "rows": [
            {
                "label": "Acceptance rate",
                "values": [
                    {
                        "school": "Duke",
                        "display": "4.1%",
                        "available": true,
                        "marker": "[1]"
                    }
                ]
            }
        ]
    },
    "public_receipt": {
        "label": "comparison table",
        "value_count": 9
    },
    "provenance": {
        "sources": ["[1]", "[2]"]
    }
}
```

The frontend artifact stays the existing `RenderSpec`.

### D10. Event Protocol Evolves, It Does Not Get Replaced

Keep protocol V1 event types:

- `meta`
- `step`
- `thinking`
- `delta`
- `viz`
- `clarify`
- `sources`
- `usage`
- `done`
- `error`

The V1 plan should improve `step` and `thinking`, not introduce a second
parallel event protocol.

Needed changes:

- Make `StepDetail` safe for transparent agent mode.
- Show generic receipts for all step kinds, not only search.
- Add enough detail to show plan updates, skill loading, DB tools, SQL, viz,
  and safe tool errors.
- Keep secrets and huge payloads out of wire events.

### D11. Frontend Stays Dumb And Minimal

The frontend should render:

- timeline rows
- start/end/error status
- labels
- elapsed time
- safe detail
- artifacts
- final answer

It should not understand tool business logic.

Known current issue:

- `frontend/src/features/ai-chat/components/activity-trace-helpers.ts` hides
  DB/sql/viz receipts and only reveals search receipts.

For agent mode, that should change. Generic safe receipts should render by
default.

Do not build rich diff UI or approval UI yet.

### D12. Subagents Are Future Nested Run Groups

Do not implement subagents in V1.

When implemented later, use one delegation tool shape:

```text
delegate_task(agent_name, task)
```

Subagents should appear as nested run groups:

```text
Researcher
  Checked official sources
  Found 4 relevant pages

Verifier
  Confirmed 6 claims
  Flagged 1 conflict
```

Not as random chat participants.

Pydantic AI Harness experimental `SubAgents` is the right pattern to study
later: child agents have isolated message history, self-contained tasks,
budgets, timeouts, and optional event streaming.

### D13. Pydantic AI Harness: Vendor The Code, Don't Take The Dependency

We inspected `pydantic-ai-harness` at commit:

```text
b5b93704c3d997bf1910528d964306118589738c
```

Finding:

- It is an official PydanticAI capability library (MIT).
- It is not a replacement runtime.
- **It requires `pydantic-ai-slim>=2.1.0`; we are on pydantic-ai 1.107.**
  Everything in it is built on the v2 capabilities API (`AbstractCapability`,
  `wrap_model_request`, `after_tool_execute`) — none of which exists in 1.x.
  `pip install pydantic-ai-harness` is off the table without a major
  framework upgrade.
- Stable useful capabilities include `CodeMode`, `FileSystem`, and `Shell`.
- Experimental useful patterns include `Planning`, `SubAgents`,
  `StepPersistence`, compaction, and overflow.

For V1 (vendoring stance):

- **Vendor two small pieces** (~250 lines total, MIT, no v2 dependencies in
  the parts we take):
  1. The `PlanningToolset` tool logic (Phase 2) — `PlanItem`, full-plan
     replacement, `render_plan` checklist, single-in_progress nudge, and the
     battle-tested `write_plan` docstring.
  2. The overflow design + pure payload helpers (Phase 3) — reduce oversized
     tool returns at production time with spill-to-store + read-back.
- Do not couple a pydantic-ai v2 migration to Agent V1. Ship V1 on 1.107;
  evaluate the v2 upgrade as its own task afterward (see Future Work) — it is
  the natural on-ramp for SubAgents and StepPersistence, since Pydantic's
  batteries ecosystem is v2-only going forward.
- Do not import unstable experimental capabilities unless they clearly save
  more time than they add risk.

### D14. One Tool = One Spec, In One Place

The tool architecture of the best agentic products (Claude Code, Codex,
Cursor) is five boring patterns applied with discipline. Counselle already
has three and a half of them:

- Small, orthogonal, stable tool set (~16 tools, no overlap) — have it; D7
  protects it. Never add a second tool with overlapping semantics.
- Progressive disclosure (`load_skill`, ADR 0013 unmounted-not-hidden
  gating) — have it; keep both.
- Cross-cutting concerns as middleware around tools (`process_tool_call`
  citation annotation, the Phase 3 overflow on the same seams) — have the
  seams; Phase 4 makes them uniform.
- Tool descriptions as prompt engineering — halfway there (see below).
- One tool = one spec — the real gap, fixed in Phase 4.

The gap: everything about a tool is currently scattered across four places —
the docstring in a closure (`app/toolset.py`), the label template
(`config/assets/step_labels.yaml`), the receipt logic (`app/steps.py`
mapper), and the gating (`build_tools`). Adding one tool is a four-file
scavenger hunt, and drift in any one place silently loses a label or receipt
(the `_SafeDict` "?" fallback papers over it).

Fix: a lightweight `ToolSpec` registry — one frozen spec per tool carrying
name, step kind, tier, label reference, safe-receipt builder, and gating
flag. `build_tools`, the `StepMapper`, and the unmounted-suppression set all
derive from the one list instead of maintaining parallel truths.
`step_labels.yaml` stays the editorial voice (ADR 0018 bucket 2); the spec
references it. ~100 lines, and future workspace tools become "fill in one
spec" instead of a four-file hunt.

Two companion rules:

- **Docstrings are prompt engineering, not documentation.** The model reads
  every tool description on every request — it is the highest-leverage text
  in the system. Every description must say when to use the tool, when NOT
  to use it over its siblings, and what to do after an error.
- **Explicitly not copying from the big players:** dynamic tool
  search/deferred schemas (solves the 100+ tool problem; we have 16),
  CodeMode (parked in Future Work), plugin/marketplace layers and per-tool
  RBAC (enterprise cosplay), and MCP-ifying first-party tools for uniformity
  (MCP is the integration boundary, not the architecture — counselle-db over
  MCP + in-process Tavily/viz is the right split).

### D15. MCPs And Skills: One Seam, One Boundary, One Audience

D14 gave tools the one-thing-one-place treatment. MCPs and skills get the
same discipline via three rules. Nothing here is new construction — it forces
already-planned work (Phase 1, 3, 4, 7) through single choke points instead
of parallel copies.

**Rule 1 — One middleware seam for all cross-cutting tool concerns.**

Today citation annotation is written twice: `annotate_mcp_result` (the
`process_tool_call` hook) for MCP tools, and `registry.annotate_search_results`
pasted inline into each of the three Tavily closures. Phase 3 (overflow) and
Phase 4 (D6 error envelope) would each be written twice again on those seams.

Instead: `app/tool_middleware.py` (~60 lines) — an ordered list of pure
wrappers (`annotate_citations → error_envelope → overflow_spill`) composed
once and applied at exactly two mount points: the MCP `process_tool_call`
hook and a single `wrap()` inside the in-process tool factories. Adding a
future concern (rate metering, timing, redaction) = one function appended to
one list, applied everywhere. This is the harness/Claude Code middleware
pattern at startup scale.

**Rule 2 — One error boundary in the MCP server.**

`counselle_db/server.py` has zero `except` handling today; a `ServiceError`
surfaces as a raw MCP protocol error string with no recovery hint, and the
agent burns rounds guessing. The fix respects the thin-shell rule (server.py
tools stay ~3 lines): a single `@tool_errors` decorator that catches
`ServiceError` and returns the D6 error shape (`root_cause`, `safe_retry`,
`stop_condition`). All 11 tools get the contract from one decorator; tool #12
gets it for free.

The transport rule stays fixed: MCP is for process isolation (the DB child
owns a pool and a catalog — correct), in-process for everything else. Any
future MCP follows the same recipe — env allowlist, read timeout, the shared
middleware hook from Rule 1, specs in the D14 registry. The D14 registry
covers MCP tools too: a spec does not care about transport, and the 11 DB
tool names live in `step_labels.yaml`/`StepMapper` exactly like the
in-process ones.

**Rule 3 — Docstrings own contracts; skills own procedure; the prompt owns
identity.**

Three layers, each owned in exactly one place:

- **System prompt**: invariant identity and safety only — paid on every
  request, so it stays minimal.
- **Skills**: situational procedure — when to reach for which tool, ordering,
  tier expectations, voice, fallbacks. Loaded on demand.
- **Tool docstrings** (in the server / ToolSpec): the only place a tool's
  inputs, outputs, and field names are documented.

The moment a skill restates a schema, there are two sources of truth and one
rots — we already shipped the proof: `dossier-assembly` documents a
`not_in_db` flag that does not exist (the real contract is a `status`
discriminated union), so an agent following the skill mishandles the
honesty-critical not-in-DB path today. Skills say "call `resolve_school` and
branch on its `status`" and stop; the docstring owns what statuses mean.

Corollaries:

- Skill frontmatter `description` is prompt engineering, same bar as tool
  docstrings: it must say *when to load me* (`dossier-assembly` is the
  quality bar; hold the others to it).
- Skills are prompt-code, not docs — they get a lint test (Phase 7): every
  backticked tool reference in a `SKILL.md` exists in the ToolSpec registry,
  frontmatter is complete, and no skill exceeds a size budget (a loaded
  skill is context spend).
- The Phase 1 prompt reframe doesn't just rewrite `counselor.md` — it
  *evicts* situational chunks (season guidance, dossier voice, comparison
  etiquette) into skills so the invariant layer stops paying for them.

The loader (`app/skills.py`) is already right — progressive disclosure, the
menu derived from frontmatter, never raises. Keep it as-is.

### D16. Frontend: Minimal Run Surface, Not A Redesign

The V1 frontend should make the agent observable without becoming a separate
frontend project. The goal is not to polish every chat detail. The goal is to
make a live agent run readable:

- tolerant stream parsing
- visible run transcript
- real `thinking` narration, not fake loading words
- a pinned plan checklist
- compact tool rows
- safe receipts and recoverable errors
- final answer and artifacts

The frontend should **not** understand tool business logic. It should render
the safe receipt the backend sends. Rich per-tool renderers, task diffs,
approval UI, and broad chat-chrome redesign are future work.

Three contracts matter for V1:

**Contract 1 — tolerant reader first.** `sse.ts` currently throws
`TransportError` on unknown event types and unknown step kinds, even though
`domain/events.py` says clients ignore unknown event types. This must be fixed
before `write_plan` ships.

Rules:

- unknown top-level event type -> skip the frame and continue
- unknown step kind -> keep the event and render a generic step row
- unknown done status -> map to a safe fallback
- malformed known events -> still fail loudly

**Contract 2 — one kind-presentation registry.** Per-kind frontend knowledge is
currently scattered across `sse.ts`, `activity-trace-helpers.ts`, and reducer
receipt logic. Replace that with one `KIND_PRESENTATION` map with a required
default entry. A new kind should render decently before any custom UI exists.

**Contract 3 — memoization floor.** Agent runs produce more events than chat
turns. Settled messages and settled markdown blocks should not re-render and
re-parse on every SSE event. Add the minimum `React.memo` / stable key work
needed to keep streaming usable.

V1 run surface:

- Replace or adapt `ActivityTrace` into an `AgentRunView`.
- Show `thinking` and `step` entries in real stream order.
- Delete fake thinking text such as `THINKING_WORDS` and ticker/dwell
  machinery if it is still active in the run path.
- Show a live wall-clock timer based on arrival time, not summed sparse step
  durations.
- Render `write_plan` receipts as one pinned checklist that updates in place.
- Render every tool call as one compact row: label, status, safe receipt text,
  source chips where present, safe error text on failure.

Keep the existing composer/message chrome unless it directly blocks the agent
run. Cosmetic polish is not part of Agent V1.

Invariants to protect:

- reducer/model stay presentation-agnostic
- `TimelineEntry` remains the timeline extension point
- transcript replay uses the same reducer path as live streaming
- `step_labels.yaml` owns editorial labels
- frontend has a default presentation for unknown future kinds

## Target Agent Loop

The visible loop should look like this:

```text
1. Start run
   - emit meta
   - show "Using Counselle agent"

2. Create/update plan when work is multi-step
   - call write_plan
   - show plan step

3. Select tool or skill
   - maybe load_skill
   - maybe search fields
   - maybe query DB
   - maybe search official website
   - maybe render visualization

4. Observe result
   - agent receives structured data
   - user sees safe receipt

5. Decide next action
   - continue, retry, narrow scope, or stop

6. Recover from failures
   - use error result root cause and safe retry instructions
   - stop if stop condition reached

7. Finish
   - final answer is streamed as delta
   - final answer may place artifacts with markers
   - sources, usage, done events close the run
```

The agent can use short operational narration, but hidden chain of thought
must not be exposed.

Good narration:

```text
I am checking official pages because deadline facts can change after the DB vintage.
```

Bad narration:

```text
Here is my private reasoning chain...
```

## Implementation Operating Model

This work must be run as an orchestrated feedback loop.

The main Codex session is the **orchestrator**, not the primary implementer.
The orchestrator owns phase boundaries, task decomposition, integration,
evidence review, and the decision to move forward. Implementation and review
work should be delegated to subagents whenever the work can be split cleanly.

Subagent defaults:

- All implementer, fixer, reviewer, and E2E subagents run with **medium
  thinking**.
- Implementers get narrow, disjoint ownership: specific files, modules, or
  responsibilities.
- Reviewers are independent from implementers.
- Fixers receive only the rejected findings and the relevant files; they do
  not reopen the whole phase unless the phase is structurally wrong.

Every phase or milestone follows this loop:

1. **Orchestrator scopes the phase.**
   - Re-read the phase section and relevant source files.
   - Split work into small implementation tasks with non-overlapping write
     scopes.
   - Define the live E2E prompt(s) and what the run trace must show.

2. **Implementer wave.**
   - Launch implementer subagents for the phase tasks.
   - Each implementer writes code, runs scoped checks, and reports changed
     files plus evidence.
   - The orchestrator integrates the work and resolves conflicts.

3. **Local verification.**
   - Run the fast automated checks that match the phase: unit tests,
     typecheck, prompt tests, reducer tests, or backend routine tests.
   - Automated tests are useful, but they are not the quality gate for this
     project. They only prove code paths did not obviously break.

4. **Live E2E agent run.**
   - Start the real backend and frontend locally.
   - Run actual user prompts through the UI or the real streaming API.
   - Watch the full agent trace: plan, thinking narration, tool calls,
     receipts, errors/retries, visualizations, sources, final answer, and
     usage/done events.
   - Save useful screenshots, traces, logs, and notes under `artifacts/`.

5. **Reviewer wave.**
   - Launch exactly **two** independent reviewer subagents per wave, both on
     medium thinking.
  - Reviewer A focuses on code/runtime correctness: architecture boundaries,
    tool contracts, event protocol, state, and tests. Reviewer A must also
    inspect the live E2E trace evidence for the runtime behavior they are
    approving.
  - Reviewer B focuses on live E2E behavior: whether the visible run behaves
    like an agent, whether actions/tool calls are transparent, whether the
    final answer is useful and cited, and whether the UI exposes enough
    evidence to debug the run.
  - Both reviewers must review real evidence from the live E2E run, not only
    automated test output.

6. **Fix loop.**
   - If either reviewer rejects, launch fixer subagent(s) for the specific
     findings.
   - Re-run relevant automated checks and another live E2E agent run.
   - Launch a new two-reviewer wave.
   - Repeat until **both reviewers approve in the same wave**.

7. **Commit gate.**
   - Only after same-wave two-reviewer approval, the orchestrator commits the
     phase.
   - The commit summary must include what changed, what live prompt(s) were
     run, what the agent trace showed, and which checks passed.
   - Then move to the next phase.

Live E2E is not optional. For this agent, a phase is not done just because
automated tests pass. A phase is done when the real product can run a real
query and the orchestrator plus reviewers can see, in the trace, what the
agent reasoned operationally, which tools it used, what it observed, how it
recovered, and why the final answer is trustworthy.

## Build Plan

### Phase 0: Lock Scope And Baseline

Goal: Make sure implementation starts from the correct product shape.

Actions:

- Use this file as the canonical design note and build plan.
- Do not modify canonical `specs/` yet.
- Identify current tests around agent node, steps, viz, and frontend trace.
- Record current behavior before edits if needed.

Acceptance:

- The team agrees V1 is one mode only.
- The team agrees no permission/approval/rich-diff work happens in V1.
- The team agrees the orchestrator/fixer/reviewer/E2E loop is the way phases
  are shipped.
- The first implementation task after this is Phase 0.5, not the planning
  tool.

### Phase 0.5: Make The Stream Reader Forward-Compatible

Goal: Let the backend evolve the agent protocol without killing the frontend
stream.

This must land before `write_plan`, new step kinds, or richer receipts. It is
the compatibility floor for the whole agent build.

Files:

- `frontend/src/api/chat/sse.ts`
- `frontend/src/api/chat/types.ts`
- existing transport/SSE tests

Changes:

- Unknown top-level event type: skip the frame and continue.
- Unknown step kind: preserve the step event with a generic kind/presentation
  fallback.
- Unknown done status: map to a safe fallback instead of crashing the stream.
- Malformed known events still fail loudly.
- Add the first small `KIND_PRESENTATION` default entry if needed so unknown
  step kinds do not render blank rows later.

Tests:

- Unknown event type is ignored.
- Unknown step kind produces a generic step event/row path.
- Malformed `meta`, `step`, and `delta` events still error.

Acceptance:

- Adding `write_plan` cannot break existing live streams just because the
  frontend does not know that kind yet.
- Live E2E smoke with the existing agent still streams without "Couldn't load
  this conversation" and without client-side protocol crashes.

### Phase 1: Reframe Prompt From Counselor To Agent

Goal: Replace chat/counselor behavior with agent behavior while preserving
admissions honesty.

Files:

- `config/assets/prompts/counselor.md`
- `app/agent_node.py` for unmounting `ask_student`
- `app/prompt.py` only if a rename is worth it
- prompt-related tests

Changes:

- Rewrite identity as admissions work agent.
- Keep citation instructions.
- Keep DB-first guidance where it helps.
- Keep temporal awareness.
- Remove or soften "exactly one final answer" style chat constraints if they
  conflict with visible agent operation.
- Remove `render_viz` prose constraint that says numbers never appear in model
  tokens.
- Add planning guidance:
  - use `write_plan` for multi-step work
  - update plan as steps start/finish
  - keep plan short
- Add transparent operation guidance:
  - visible operational summaries are allowed
  - do not reveal hidden chain of thought
  - do not dump raw JSON unless useful and safe
- Remove `ask_student` from the Agent V1 toolset.
- Teach the agent to make reasonable assumptions, state them, and continue
  instead of parking the run for clarify.
- Evict situational content into skills (D15 Rule 3). The prompt keeps only
  invariant identity and safety; procedure moves to `skills/` where the agent
  loads it on demand:
  - the hardcoded four-season paragraph (it also conflicts with
    `season_calendar.yaml` — delete, don't relocate, the yaml is the truth)
  - dossier voice guidance → `dossier-assembly`
  - comparison etiquette → `school-comparison`
  - anything else that only matters for a specific task shape

Tests:

- Existing prompt assembly tests still pass.
- New assertions check that agent prompt contains planning/tool-loop guidance.
- Agent tool assembly no longer mounts `ask_student` for Agent V1.
- Assert the evicted chunks are gone from the assembled prompt (no season
  paragraph, no dossier-voice text) and present in their skill bodies.

Live E2E gate:

- Run at least one real prompt through the UI.
- Confirm the assistant behaves as an agent, not a counselor chat answer.
- Confirm vague prompts lead to stated assumptions, not `ask_student` parking.
- Confirm the visible trace still separates thinking, tools, sources, and final
  answer.

### Phase 2: Add The Planning Tool

Goal: Give the model a simple, visible task plan primitive.

Dependency: Phase 0.5 must already be done. The frontend currently throws on
unknown step kinds, so `write_plan` must not ship before the tolerant reader.

Do not write this from scratch. Port the harness `PlanningToolset`
(`pydantic_ai_harness/experimental/planning/_toolset.py`, ~76 lines, MIT) —
the tool logic has zero v2 dependencies. Take nearly verbatim:

- `PlanItem` (content + pending/in_progress/completed/cancelled)
- full-plan replacement semantics
- `render_plan` checklist output with the `(2/5 completed)` summary line
- the gentle "keep only one step in_progress" nudge (a note in the return,
  not a hard error)
- the `write_plan` docstring wording ("Pass the entire ordered plan every
  time... Call this when you start and when you finish a step so your
  progress stays visible.") — battle-tested prompt engineering

Add on top: our `public_receipt` envelope and the step-label mapping.

Known v2-only piece we can NOT take on 1.107: the harness re-injects the
current plan as an ephemeral tail reminder behind a `CachePoint` on every
model request (`wrap_model_request`), so the model never loses its plan and
the prompt cache never busts. For V1 the plan living in tool-call history is
good enough; the reminder trick becomes free after a v2 migration.

New likely file:

- `app/plan_tool.py`

Existing files:

- `app/agent_node.py`
- `config/assets/step_labels.yaml`
- `domain/events.py` only if `StepDetail` needs new fields
- tests for agent/steps

Tool shape:

```python
write_plan(items: list[PlanItem]) -> dict[str, Any]
```

`PlanItem`:

```python
content: str
status: Literal["pending", "in_progress", "completed", "cancelled"]
```

Return shape:

```python
{
    "status": "success",
    "summary": "Plan updated: 4 steps, 1 in progress.",
    "public_receipt": {
        "items": [...],
        "completed": 1,
        "total": 4
    },
    "next_actions": ["Continue with the in-progress step."]
}
```

Keep state local to the PydanticAI run. Do not persist a separate plan table.
The plan is visible through tool events and model history.

Tests:

- Plan tool validates statuses.
- Plan tool warns or summarizes if more than one item is in progress.
- Step mapper labels `write_plan` clearly.
- A scripted FunctionModel/TestModel can call `write_plan` and produce step
  events.

Live E2E gate:

- Run a real multi-step prompt that should require planning.
- Confirm `write_plan` appears in the visible trace.
- Confirm the plan checklist updates as work progresses.
- Confirm the final answer follows from the visible plan and tool work.

### Phase 3: Tune Agent Run Limits And Long-Run Hygiene

Goal: Stop chat-era caps from killing real agent runs too early — and make
long runs actually survivable. Raising the timeout alone is decorative: the
real blocker for hours-long runs is message-history growth. Every tool result
stays in history forever, so by model request 40 the run re-sends an enormous
history on every call — cost grows quadratically and the run eventually hits
the model's context ceiling mid-flight. This phase raises the limits AND adds
the minimal hygiene that makes the limits meaningful.

Files:

- `config/settings.py`
- `app/agent_node.py`
- `app/toolset.py`
- `app/tool_overflow.py` (new: vendored payload helpers, per-run spill
  store, `read_tool_result` tool)
- `app/turns.py`
- tests for settings, limits, and timeout behavior

Current limits:

- `max_tool_rounds = 12` — note: wired as `UsageLimits(request_limit=...)`,
  so it is actually a MODEL REQUEST cap, not a tool-round cap. The rename
  below fixes the lie in the name.
- `turn_timeout_s = 180`
- MCP read timeout is 30 seconds in `app/toolset.py`
- `stream_buffer_size = 20_000` events — sized for a worst-case CHAT turn

Naming decision (resolved): rename to `agent_*` settings, no back-compat
aliases. We are pre-launch with no external consumers — backward compatibility
with ourselves is enterprise cosplay.

Target settings:

```python
agent_max_model_requests: int = 80
agent_max_total_tokens: int = 2_000_000  # the real cost ceiling per run
agent_turn_timeout_s: int = 3600
agent_mcp_read_timeout_s: float = 60.0
agent_tool_result_max_chars: int = 8_000  # hard cap entering history
```

Three sub-tasks:

1. **Limits.** Raise request/timeout limits as above. Pass BOTH
   `request_limit` and `total_tokens_limit` to `UsageLimits` — for a startup
   paying per token, the token budget is the real runaway-loop guard; the
   request count is just the sanity floor. Keep per-tool timeouts bounded,
   keep the process-level concurrent turn cap, keep cancel support.

2. **Long-run context hygiene (small, not enterprise).**
   Adopt the harness overflow design: reduce oversized tool returns **at
   production time, once, persisted** — the reduced form is what enters
   message history, so nothing is re-shrunk per request. (This replaces an
   earlier `history_processors` idea: per-request re-shrinking is strictly
   worse — more work, same result.)
   - Any tool result over `agent_tool_result_max_chars`: **spill the full
     payload to a local per-run store and keep a compact reference + preview
     in history**, with bounded truncation as the fallback. Lossless, zero
     LLM cost, no silent data drop.
   - Mount a `read_tool_result(handle)` tool so the agent can read a spilled
     payload back if it actually needs it (its own returns are exempt from
     reduction).
   - Port the pure helpers from the harness
     (`experimental/overflow/_payload.py`: `measure`, `json_sketch`,
     `truncate_text`) — no v2 dependencies.
   - Mount the band logic as one wrapper in the D15 middleware pipeline
     (`app/tool_middleware.py`, Phase 4) — never hand-wired twice at the MCP
     hook and the tool closures separately. If Phase 3 lands before Phase 4,
     pull the pipeline skeleton forward: it is ~60 lines and both phases
     need it; the overflow helpers themselves stay pure in
     `app/tool_overflow.py`.
   - D6's compact `result_for_agent` already pushes this way; this makes it
     a rule, not a hope. Full phase-boundary compaction stays in Future Work.

3. **Ring buffer sizing (conscious decision, not a surprise).**
   `stream_buffer_size` was sized for a chat turn; an hours-long run emits
   far more events. Head-eviction then breaks live reattach-from-start
   (transcript fallback only covers terminal state). Either raise the event
   cap alongside the other limits or document the eviction behavior as
   accepted — decide explicitly during implementation, default to raising it
   since the byte budget (`stream_buffer_bytes`) is the real OOM guard.

Tests:

- Settings defaults update; old names are gone (grep-clean).
- Token budget stops a runaway loop cleanly (same budget-message path as the
  request limit).
- Oversized tool result is spilled + reduced once at production time, and the
  reduced form (reference + preview) is what lands in history.
- `read_tool_result` returns the spilled payload, and its own returns are
  never re-reduced.
- Small tool results pass through byte-identical (no reduction below the
  threshold).
- Turn timeout still persists partial and emits terminal error.

Live E2E gate:

- Run a longer real prompt that triggers multiple tool calls.
- Confirm the run stays attached/re-attachable while working.
- Confirm oversized-result handling is visible enough to debug when it happens.
- Confirm cancel/timeout/budget behavior produces a user-visible terminal state,
  not a silent broken stream.

### Phase 4: Standardize Tool Observations, Receipts, And The ToolSpec Registry

Goal: Existing tools return useful observations for the agent and safe receipts
for the UI — and tool metadata stops living in four places (D14).

Files:

- `domain/events.py`
- `app/steps.py`
- `app/tool_specs.py` (new: the D14 ToolSpec registry, ~100 lines)
- `app/tool_middleware.py` (new: the D15 composed pipeline, ~60 lines)
- `config/assets/step_labels.yaml`
- `app/toolset.py`
- `adapters/tavily_tools.py`
- `counselle_db/server.py` (the D15 `@tool_errors` decorator)
- `counselle_db/service.py` only if service results need small additions
- frontend helper later in Phase 6

Five sub-tasks:

1. **ToolSpec registry (D14).** One frozen spec per tool:

   ```python
   @dataclass(frozen=True)
   class ToolSpec:
       name: str              # stable, verb_noun
       kind: StepKind         # timeline identity
       tier: StepTier | None
       label: str             # template (sourced from step_labels.yaml)
       receipt: Callable[..., StepDetail]  # safe receipt builder
       gated_by: str | None   # source-config flag, None = always mounted
   ```

   `build_tools`, the `StepMapper`, and the unmounted-suppression set
   (`GATEABLE_TOOLS`) derive from the one registry — no parallel truths.
   The registry covers **every** tool the agent can see, MCP and in-process
   alike (D15: a spec doesn't care about transport — the 11 DB tool names
   live in `step_labels.yaml`/`StepMapper` exactly like the Tavily ones).
   Registry completeness is a test: every mounted tool has a spec, every
   spec's label key exists in `step_labels.yaml`.

2. **Middleware pipeline (D15 Rule 1).** `app/tool_middleware.py`: the
   ordered pure wrappers (`annotate_citations → error_envelope →
   overflow_spill`) composed once, mounted at exactly two seams — the MCP
   `process_tool_call` hook and one `wrap()` in the in-process tool
   factories. The inline `registry.annotate_search_results` calls in the
   three Tavily closures move into the pipeline; Phase 3's overflow lands
   here instead of being written twice.

3. **MCP error boundary (D15 Rule 2).** One `@tool_errors` decorator in
   `counselle_db/server.py` catching `ServiceError` → the D6 error shape
   (`root_cause`, `safe_retry`, `stop_condition`). Server tools stay ~3-line
   thin shells; all 11 get the contract from one place.

4. **Docstring pass (D14 companion rule).** Rewrite every tool description
   as prompt engineering: when to use it, when NOT to use it over its
   siblings (DB vs web vs .edu vs Reddit is the critical disambiguation),
   and what to do after an error. `search_reddit`'s "lived experience,
   never verified fact" is the quality bar.

5. **Receipt/observation upgrade** — the original scope below.

Do not force a huge generic abstraction beyond the spec: the ToolSpec is a
metadata record, not a framework. Start by making the current `StepDetail`
and mapper better.

Needed receipt fields may include:

```python
tool: str | None
query: str | None
summary: str | None
result_count: int | None
row_count: int | None
value_count: int | None
schools: list[str] | None
field_keys: list[str] | None
domains: list[str] | None
next_actions: list[str] | None
error: str | None
```

Rules:

- Never include secrets.
- Never include DSNs.
- Never include full huge payloads.
- Include counts, labels, safe args, and recovery hints.
- Tool implementation or tool metadata owns public meaning.

Tests:

- Registry completeness: every tool the agent can see (MCP `list_tools` +
  `build_tools`) has exactly one ToolSpec and no spec is orphaned; every spec
  label key resolves in `step_labels.yaml`; the gated set equals the specs
  with `gated_by` set (no drift with `GATEABLE_TOOLS`).
- Middleware pipeline: each wrapper is unit-tested pure; one integration test
  per mount point proves the same pipeline runs on MCP and in-process results.
- MCP error boundary: a raised `ServiceError` comes back as the D6 error
  shape, not a raw protocol error string.
- Step details serialize without null clutter.
- DB/sql/viz/skill steps have safe receipts.
- Search failures show `error` status and recovery detail.
- Disabled source tools still do not paint fake work.

Live E2E gate:

- Run a real prompt that uses DB tools and at least one external search.
- Confirm each tool call has a useful visible label and safe receipt.
- Confirm tool errors, if induced or encountered, show recovery information.
- Confirm the frontend does not need tool-specific business logic to explain
  the run.

### Phase 5: Fix `render_viz` For Agent Mode

Goal: Keep artifact placement, but return structured values to the agent.

Files:

- `app/viz.py`
- `app/viz_placement.py` likely unchanged
- `tests/app/test_viz.py`
- `tests/app/test_viz_pure.py`
- `tests/app/test_viz_placement.py`
- prompt tests

Keep:

- `placement_marker`
- staged `RenderSpec`
- dedupe by signature
- marker-to-viz streaming
- citation registration

Change:

- Return `result_for_agent` with compact table/stat values.
- Return `public_receipt`.
- Return `status` and `summary`.
- Remove tests that enforce "numbers never transit the LLM."
- Replace them with tests that enforce:
  - values are cited
  - values use tool `display` strings
  - placement marker still works
  - no uncited invented values are produced by the tool

Acceptance:

- Agent can call `render_viz`, inspect returned values, place marker in the
  answer, and cite nearby facts.
- Frontend still receives the same `viz` event shape.

Live E2E gate:

- Run a real prompt asking for a comparison table or stat block.
- Confirm the trace shows the `render_viz` tool call and safe receipt.
- Confirm the agent can refer to the returned values in nearby cited prose.
- Confirm the visualization appears exactly where the marker placed it.

### Phase 6: Build The Minimal Agent Run Surface

Goal: Make the live run readable like a Codex/Claude-Code-style transcript
without turning this phase into a broad frontend redesign.

Phase 0.5 already owns the tolerant reader. Phase 6 consumes that contract and
builds the visible surface on top of the existing reducer/event model.

Files:

- `frontend/src/features/ai-chat/turn-reducer.ts` only if arrival timestamps
  or plan state need a small model addition
- `frontend/src/features/ai-chat/components/AgentRunView.tsx` (new or adapted)
- `frontend/src/features/ai-chat/components/activity-trace-helpers.ts`
  (run-view helpers, `KIND_PRESENTATION`, receipt formatting)
- `frontend/src/features/ai-chat/components/ChatMessage.tsx`
- `frontend/src/features/ai-chat/components/CitationRenderer.tsx`
- related tests

Four sub-tasks:

1. **`AgentRunView`: run transcript.**
   - Show `thinking` narration and `step` rows in true stream order.
   - Prefer adapting the existing `ActivityTrace` machinery if that is faster
     than creating a new component from scratch.
   - Delete fake thinking text/ticker behavior from the agent run path.
   - Use wall-clock arrival time for live/settled duration. Do not sum sparse
     tool durations and call that the run time.

2. **Pinned plan checklist.**
   - `write_plan` receipts update one checklist in place.
   - The checklist shows item content, status, and completed/total.
   - Repeated plan updates should not spam separate large tool rows.

3. **Generic tool receipt rows.**
   - One compact row per action: label, status, safe receipt text.
   - Render safe key/value detail for unknown receipt fields.
   - Keep source chips where present.
   - Error rows show safe error text and retry/stop guidance when present.
   - No per-tool rich UI in V1.

4. **Memoization floor.**
   - Settled messages and settled markdown blocks should not re-render on every
     SSE event.
   - Add the smallest `React.memo` / stable key work needed to keep long
     streams usable.

Do not build broad chat chrome polish, rich diff UI, approval UI, or per-tool
custom renderers in this phase. Keep the existing composer/message layout
unless it directly blocks the agent run.

Acceptance:

- A live run shows narration, plan progress, compact tool rows, artifacts, and
  the final answer in one understandable stream.
- A settled run shows an honest wall-clock duration and can expand to the full
  run trace.
- No fake thinking words appear in the agent run path.
- Unknown step kinds still render generically because Phase 0.5 handled the
  tolerant reader.
- DB/search/sql/viz/skill/error rows have safe receipts where the backend sent
  safe detail.
- During a stream, settled messages and settled markdown blocks do not re-render
  per event.
- The live E2E reviewer can watch the run without opening backend logs for
  basic understanding of what the agent is doing.

### Phase 7: Verify The Agent Loop End To End

Goal: Prove the new architecture works with existing tools before adding new
workspace/write tools. This is the final whole-system verification, but it
does not replace the per-phase live E2E gates above.

Backend verification:

- unit tests for planning tool
- unit tests for step mapper receipts
- unit tests for `render_viz` structured result
- skill lint (D15 Rule 3): every backticked tool reference in each `SKILL.md`
  exists in the ToolSpec registry; frontmatter has non-empty
  `name`/`description`; no skill body exceeds the size budget
- fix `skills/dossier-assembly/SKILL.md` while wiring the lint: it documents
  a `not_in_db` flag that does not exist — rewrite Step 1 to branch on
  `resolve_school`'s `status` union and stop restating the schema (the
  docstring owns it)
- existing routine test suite

Frontend verification:

- AgentRunView tests: DB/sql/viz/skill receipt rows, plan checklist
  in-place updates, narration interleaving, settle summary line
- tolerant-reader tests (D16 Contract 1): an unknown event type is skipped,
  an unknown step kind renders generically, a malformed known event still
  fails loudly
- `KIND_PRESENTATION` completeness: every StepKind the backend can emit has
  an entry or falls through to the default (no silent blank rows)
- wall-clock duration test: turn duration derives from meta→terminal arrival
  times, not summed `detail.duration_ms`
- chat stream reducer tests still pass
- typecheck

Manual/local verification:

- Start backend and frontend.
- Run a school comparison prompt.
- Confirm the run log shows:
  - plan update
  - DB tools
  - search tools if used
  - viz tool
  - final answer
  - sources
- Confirm no "Couldn't load this conversation" regression.
- Watch one long multi-tool run live end to end: it should read like a
  Claude Code / Codex session — narration interleaved with compact action
  lines, the plan checklist updating in place, an honest live timer, and a
  settle summary whose duration matches the wall clock.
- Explicitly verify delta-vs-thinking routing on a long multi-tool run: the
  `EmissionRouter` final-answer gating was designed for the chat rhythm
  (short narration, one final answer). With hours of interleaved text and
  tool calls, `FinalResultEvent`-based gating is the most likely thing to
  misroute — narration leaking as final `delta`, or final prose stuck in
  `thinking`. Do not redesign it; watch it.
- Run the final two-reviewer wave:
  - Reviewer A: code/runtime correctness.
  - Reviewer B: live E2E agent behavior and transparency.
  - Both must approve in the same wave before Agent V1 is considered done.

Suggested prompts:

```text
Compare Vanderbilt, Duke, and Rice for CS, cost, and admissions difficulty.
```

```text
Build me an application planning answer for Northeastern and Vanderbilt.
Use current official deadlines if the database may be stale.
```

```text
Show me a comparison table for Duke and Rice admissions and cost.
```

Acceptance:

- The answer works as an agent run, not a hidden chat turn.
- The final answer still cites factual claims.
- The visualization appears where the agent placed it.
- The run log is understandable without custom frontend work per tool.
- Final reviewer wave has two same-wave approvals with evidence from live E2E
  runs.

## Future Work After V1

Do later, after existing tools work cleanly:

1. Workspace read tools
   - read schools
   - read tasks
   - read essays
   - read activities

2. Workspace write tools
   - create/update tasks
   - update essay metadata
   - maybe draft comments
   - write through existing workspace services with `actor="counselle"`

3. Approval model
   - only after write tools prove useful
   - can start as raw text confirmation
   - rich diff UI later

4. Subagents
   - one `delegate_task(agent_name, task)` tool
   - nested run groups in UI
   - separate budgets/timeouts per subagent

5. Step persistence / crash recovery
   - append-only run events
   - provider-valid continuable snapshots
   - tool-effect ledger
   - needed before side-effectful long jobs become serious

6. Clarify without replay
   - bring back user questions only after they do not replay the whole run
   - likely built on StepPersistence/job-runner semantics
   - until then, Agent V1 makes assumptions, states them, and keeps working

7. Context management (the FULL version — V1 ships the minimal hygiene in
   Phase 3: production-time overflow with read-back + token budget)
   - summarize only when needed
   - a limit-warner that tells the MODEL it is approaching its budget so it
     can wrap up gracefully instead of getting cut off (harness
     `compaction/_limit_warner.py` is the pattern)
   - phase-boundary compaction rather than random truncation (harness
     `_clear_tool_results.py` / sliding-window compaction are the patterns)

8. Pydantic-ai v2 migration (its own task, deliberately decoupled from V1)
   - the entire pydantic-ai-harness batteries ecosystem is v2-only
     (capabilities API); upgrading makes Planning, Overflow, Compaction,
     SubAgents, and StepPersistence pip-installable instead of vendored
   - natural on-ramp for future-work items 4 (subagents) and 5 (step
     persistence) — evaluate right after V1 ships
   - also unlocks the Planning cache-reminder trick (ephemeral plan tail
     behind a CachePoint)

9. CodeMode-like batching
   - only if DB/search fanout latency becomes a real bottleneck
   - likely not needed before V1 proves value

## Risks And Mitigations

Risk: We accidentally build a custom framework.

Mitigation: Keep PydanticAI as the inner loop and LangGraph as lifecycle shell.
No custom ReAct loop in Python.

Risk: Tool outputs stay inconsistent.

Mitigation: Clean existing tools before adding workspace tools. Add receipt
tests per kind. The D14 ToolSpec registry makes drift a test failure instead
of a silent "?" label.

Risk: The frontend becomes tool-specific spaghetti.

Mitigation: Generic receipt renderer first. Rich renderers only for artifacts
and high-value known receipts.

Risk: Long runs time out too early.

Mitigation: Tune agent-run settings. Keep cancel and per-tool timeouts.

Risk: Long runs die from context growth, not timeouts — history re-sent on
every model request grows quadratically in cost and eventually overflows the
model context mid-run.

Mitigation: Phase 3 hygiene — oversized tool results are reduced once at
production time (spill to a per-run store + `read_tool_result` read-back,
truncation fallback), so the reduced form is what persists in history; a
total-token budget is the run's cost ceiling. Full compaction stays deferred.

Risk: Process death kills active run.

Mitigation: Accept for MVP. Persist partials on normal terminal paths. Add
StepPersistence-like design later.

Risk: Dropping clarify makes the agent assume wrong when the prompt is vague.

Mitigation: This is better than replaying a long run. The prompt tells the
agent to state assumptions clearly and continue. Clarify comes back only after
we can pause without replaying the whole agent run.

Risk: Agent receives too much context from tool results.

Mitigation: Return compact structured summaries, not giant payloads, enforced
by the Phase 3 hard size cap. Add overflow/compaction later when needed.

Risk: Citations get confused with constraints again.

Mitigation: Keep citations. Remove only programmatic constraints that block the
agent from seeing data it needs.

Risk: Automated tests pass but the agent feels broken in the product.

Mitigation: Automated tests are not the gate. Every phase requires a live E2E
agent run, trace inspection, artifacts under `artifacts/`, and two same-wave
reviewer approvals before commit.

Risk: Subagents produce conflicting or overlapping changes.

Mitigation: The orchestrator owns decomposition and integration. Implementers
get disjoint write scopes, reviewers do not implement, and fixers receive
specific rejected findings rather than broad authority to rewrite the phase.

## Acceptance Criteria For Agent V1

Agent V1 is done when:

- Old counselor/chat behavior is replaced by one agent behavior.
- `ask_student` is not mounted in Agent V1.
- The agent can create and update a visible plan.
- Existing DB/search/skill/viz tools appear in the run log.
- Tool failures produce visible, recoverable receipts.
- `render_viz` returns structured values to the agent and still streams
  artifacts through placement markers.
- Frontend shows safe receipts for all existing step kinds.
- Adding a tool means filling in one ToolSpec, not editing four files —
  verified by the registry-completeness tests.
- A long multi-tool run does not grow history unboundedly: oversized tool
  results overflow to the store with read-back, and a token budget bounds
  run cost.
- Final answers remain cited and useful.
- No permissions/approval/new workspace tools were added prematurely.
- Each phase was shipped through the orchestrator loop: implementer wave, live
  E2E run, two-reviewer wave, fixer loop if needed, and same-wave approval.
- Final artifacts include the live prompts used, screenshots/traces/logs when
  useful, and reviewer approval notes.
- Routine backend and frontend tests pass.

## One-Line Summary

Build Counselle Agent V1 by strengthening the existing PydanticAI plus
LangGraph plus TurnRegistry runtime: one transparent agent mode, a small
planning tool, longer supervised runs with token budgets and history-growth
hygiene, cleaned existing tool contracts, agent-visible visualization data,
and a minimal Codex-style run log, shipped through an orchestrated live E2E
feedback loop before any workspace writes, approvals, or product subagents.
