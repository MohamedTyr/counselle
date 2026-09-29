# Goal Mode (`/goal`) — implementation plan

Date: 2026-09-16
Status: **draft, revision 2** — implementation not started
Branch to cut: `feat/goal-mode`

Revision 2 follows a five-lens adversarial review (backend correctness, honesty,
product, design, red team). That review found **sixteen defects in revision 1** — logged with severity in §0.4 — **five of which were
load-bearing claims that turned out to be false on contact with the code.** They are fixed here, and §0.4 lists them explicitly rather than
quietly correcting them — an implementer deserves to know which parts of this design
were wrong once, because those are the parts most worth re-checking.

This document has ten parts (Part 0 through Part 9).

- **Part 0 — the binding contract.** The product, the locked decisions, the corrections
  that override everything later, and the revision-1 defect log. **Part 0 wins every
  conflict.**
- **Part 1 — what we are cloning, and the evidence.** Prior art (Claude Code, Codex,
  OpenCode, pydantic-ai-harness, published harness guidance) and the mechanisms verified
  live against this repo's own interpreter.
- **Part 2 — backend architecture.**
- **Part 3 — the judge.**
- **Part 4 — compaction.**
- **Part 5 — UI/UX.**
- **Part 6 — the phased build, with a per-phase file manifest.**
- **Part 7 — risks, honesty gates, and the live acceptance script.**
- **Part 8 — non-goals.**
- **Part 9 — the open decisions the owner must make before Phase 2.**

Every claim about the existing tree is `file:line`-anchored. Every claim about an
external system carries a URL. Every claim marked **VERIFIED** was executed against
`/home/saifuddin/Projects/counselle/.venv` and its output is quoted.

---

# Part 0 — the binding contract

## 0.1 The product, in one paragraph

A student types `/goal` in the composer, states an outcome, and sends it. Counselle then
**works until the goal is actually met** rather than until the model feels like stopping:
it plans in the open, uses its tools, and at each stopping point an **independent judge**
— a separate model call that sees tool receipts, not the agent's claims of success —
decides whether frozen, binary acceptance criteria are met. Unmet criteria come back to
the agent by name. As the conversation grows, history is **compacted** so the run can
keep going. The run is bounded by a cumulative budget (cost first, then requests, tokens,
wall clock, and judge rounds) and by a no-progress detector. It ends in exactly one of
six honest states — **Achieved**, **Partial**, **Stopped (budget)** (which the student
sees as *"Partial — budget reached"*, because a run that hit a limit may still have done
real work and a bare "Stopped" would undersell it), **Stopped (no progress)**,
**Stopped (you)**, or **Stopped (check failed)** — and the closing card
names, per criterion, what was and was not done, **and what was never checked at all**.
The whole run is **one assistant message** in the existing chat, obeying the already
approved "the run is the message" contract.

## 0.2 The locked decisions

| # | Decision | Where argued |
|---|---|---|
| **D1** | The loop lives **inside the agent node**, as an outer iteration around `agent.iter()`, driven by a new `app/goal_loop.py`. Not an outer orchestrator, not a new LangGraph node, not a tool. | §2.2 |
| **D2** | One goal run = **one turn = one assistant message = one SSE stream**, with one `meta`, one `done`, one turn record. | §2.3 |
| **D3** | Compaction is **`pydantic-ai-harness==0.4.0`**, a pinned dependency — not hand-rolled, not ported. **Verified by live `uv add` in a worktree of this repo: resolves in 16 lines, does not move `pydantic-ai` off 1.107.0.** | §4.1 |
| **D4** | The judge is a **separate agent, separate prompt, cheap model, typed output**, blind to the agent's self-report. | §3 |
| **D5** | The judge is a **loop-control gate, never an answer validator.** | §3.5 |
| **D6** | Budget is enforced by carrying **one shared `RunUsage`** into every `agent.iter(usage=...)`, so `UsageLimits` applies cumulatively. **The judge and criteria calls share that same `RunUsage`** so their spend is inside the ledger, not invisible to it. | §2.5, §2.10 |
| **D7** | **No new event type and no protocol bump.** Goal and compaction beats ride `step` as two new `StepKind`s, with a `phase` discriminator on the detail payload. | §2.6 |
| **D8** | **No new table and no migration.** | §2.8 |
| **D9** | **No approval gate in v1**, but the criteria are shown before the first tool call and the run is Stop-able from that instant. | §5.6, §7.2 |
| **D10** | Goal mode is a **harness mode**, not a skill and not a `response_mode`. Wire field `goal_mode: bool`. | §2.4 |
| **D11** | The cheap compaction tier is mounted for **every** turn; only the summarizing tier is goal-only. | §4.4 |
| **D12** | **NEW.** The goal statement and criteria are pinned in the agent's **`instructions`**, frozen once at `Agent(...)` construction — not protected by message position. `instructions` live outside `messages`, are re-sent every request, and are structurally immune to compaction. **VERIFIED §1.6.7.** | §2.9, C2 |
| **D13** | **NEW.** `ask_student` is **not mounted on a goal turn**: `output_type=[str]`, as continuation turns already do. A goal run never parks on a clarify. | §2.8, C8 |
| **D14** | **NEW.** Cost is the **primary** budget, checked *before* each iteration against a projection, not only after. Token and request caps are derived from it, not set independently. | §2.10 |
| **D15** | **NEW.** Goal turns run on the **cheap model tier** by default (`model_cheap`), not the counselor tier. This is a quality/cost decision, made explicitly rather than inherited by accident. | §2.10, §9 |

## 0.3 Corrections that override the rest of this document

**C1 — `write_plan` is not re-implemented or forked.** `app/plan_tool.py` is already a
faithful TodoWrite. Goal mode uses it as-is. The only change is that it is always mounted
on a goal turn — bypassing **both** clauses of the existing gate at
`app/agent_node.py:860-863`, which suppresses `write_plan` when the text forbids planning
**and also** when work-narration was requested without an explicit plan request.

**C2 — REPLACED. The goal statement is pinned in the instructions, not by position.**
Revision 1 claimed the statement "is literally `messages[0]`", protected by
`preserve_first_user_message`. **That was false.** `TurnState["messages"]` is the entire
session's accumulated history (`thread_id = session_id`), and `_split_user_message`
(`app/agent_node.py:296-310`) returns `messages[:-1]` as history — so for `/goal` sent
mid-conversation, which is the common case, index 0 is an unrelated older message.
The fix (D12): `render_goal_mode()` renders the statement **and** the frozen criteria into
the agent's `instructions`, computed **once** at `Agent(...)` construction — there is
nothing to rebuild per round, and an implementer must **not** construct a new `Agent` per
iteration (§2.9). Instructions are not part of `messages` and no compaction strategy
touches them —
**VERIFIED §1.6.7: 40 messages compacted to 3, instructions returned byte-identical.**
`preserve_first_user_message=True` stays on as defence in depth, but it is no longer the
guarantee.

**C3 — "budget reached" is never reported as "achieved."** The six terminal states are
computed in `domain/goal.py` from the judge verdict plus the code-owned ledger, never
from model prose. A run that exhausts its budget with three of four criteria met is
**Partial**, and the card names the fourth.

**C4 — compaction is disclosed to the student** as a stream beat; the model never
mentions it in prose (§1.9.3).

**C5 — the judge's critique is shown, not hidden.** A failed criterion's reason renders
outside any collapsed region.

**C6 — REVISED. This plan does not refactor `app/agent_node.py`, but Phase 3 is not a
"~40-line extraction" either.** Revision 1's line budget was fiction: the real run block
is `app/agent_node.py:1002-1101` (~100 lines) and it is entangled with turn-scoped
objects. Phase 3's honest budget is **~150–250 net new lines across
`app/agent_node.py` and `app/steps.py`**, including the iteration lifecycle in C7. It
still moves nothing unrelated; splitting the file remains its own branch.

**C7 — NEW, and it is bigger than one latch. `EmissionRouter` and
`_FinalContentPlacementWriter` are one-shot per turn and must gain an explicit
per-iteration lifecycle.** D1's whole "nothing downstream changes" argument assumed these
were iteration-agnostic. They are not, and a first pass at this correction under-counted
the state — so the full inventory is written out here rather than described.

**The cadence, stated once.** Each iteration ends with `router.close(reason)` — which
already drains and clears `_open`, synthesizing honest terminal steps for anything still in
flight (`app/steps.py:~1002,~1036`) — and the next iteration begins with
`begin_iteration()` on both objects. Closing per iteration is correct, not a workaround: an
`agent.iter()` run that ended genuinely has no live tool calls, and anything still open
deserves its `unknown` outcome now rather than at turn end. Without a per-iteration
`close()`, resetting `_closed` would be a no-op fixing nothing.

**What repeats, and what does not.** `close()` only (a) flushes the thinking buffer,
(b) flushes the pending text buffer as final-answer or narration, and (c) synthesizes
terminal `unknown` receipts for genuinely still-open tool calls. All three are intended per
iteration. The turn-level events — `ev_sources`, `ev_usage`, `ev_done` — are emitted in
`app/run_turn.py` (`:737-761`, `:1070-1089`), entirely outside `run_agent_node`, **once per
graph invocation**, and are unaffected by how many times the router closes inside the node.
No turn-level event is duplicated by this cadence.

**`EmissionRouter.begin_iteration()` — reset exactly these:** `_closed`,
`final_answer_started`, `_final_candidate`, `_text_buf`, `_thinking_buf`,
`_narration_streamed_len` (`app/steps.py:944-952`). `_open` needs no reset because
`close()` already cleared it.
**Do NOT reset:** `_counter` (`app/steps.py:1180-1182`), nor the accumulating
step/narration records. Monotonic `step_id`s are what keep the D7 promise honest —
`build_segments` (`app/records.py:141-149`) replaces in place on a repeated `step_id`, so a
per-iteration counter reset would silently overwrite iteration 1's steps with iteration
2's. Monotonic ids mean `app/records.py` genuinely needs **zero diff**.

**`_FinalContentPlacementWriter` carries more state than its name suggests**
(`app/agent_node.py:469-520`): **two** latches, `_final_started` (`:477`) and `_flushed`
(`:478`) — `start_final()` is a permanent no-op if either is set — plus **two nested
parsers that are themselves stateful**: `_StreamingVizMarkerPlacer` (`_pending`,
`_emitted_indexes`, `app/agent_node.py:389-392`) and `StreamingVizMarkerStripper`
(`_prefix`, `_inside_marker`, `_saw_closing_bracket`, `_swallowing_closing_junk`,
`app/viz_placement.py:15-18`). All are built once at `app/agent_node.py:819-821`, before
the loop. A `_stripper` left mid-parse at an iteration boundary would leak a dangling
`[[viz:` fragment into the next iteration's prose, or swallow the start of one.

**The writer's `begin_iteration()` mutates the instance; it must NOT be reconstructed.**
This distinction is load-bearing and is therefore written as code rather than prose.
`EmissionRouter` captures **bound methods** of this exact instance at construction —
`writer=final_writer.write` and `on_final_start=final_writer.start_final`
(`app/agent_node.py:821,984ff`) — and neither is in the router's reset list. Rebinding a
fresh `_FinalContentPlacementWriter` would leave the router pointed at iteration 0's
orphaned object forever, whose `_flushed` latch is already `True`: viz placement and
marker-stripping would silently die from iteration 2 on. So:

```python
# _FinalContentPlacementWriter
def begin_iteration(self) -> None:
    self._final_started = False
    self._flushed = False
    # The two nested parsers are REPLACED (they carry mid-parse state); the writer
    # object itself is NOT, because EmissionRouter holds bound methods on it.
    # `emitted_indexes` is CARRIED FORWARD -- see below, it is not optional.
    self._placer = _StreamingVizMarkerPlacer(
        self._staged_specs, self._writer, emitted_indexes=self._placer.emitted_indexes
    )
    self._stripper = StreamingVizMarkerStripper()
```

**Why the carried set is not optional.** `_staged_specs` **is** `viz_list`, created once per
turn (`app/agent_node.py:819`) and **never cleared** — `render_viz` only appends to it. The
placer's fallback path emits *every* index not in its own `_emitted_indexes`
(`app/agent_node.py:400-407`). So a naively fresh placer starts with an empty set against a
list that already holds iteration 1's specs, and iteration 2's flush **re-emits every card
the student already saw**. Carrying `emitted_indexes` across the rebuild is what makes the
replacement safe; it needs one optional constructor argument on
`_StreamingVizMarkerPlacer` plus a read accessor for its index set — the only change this
feature makes to that class.

Replacing the two parsers rather than hand-resetting their six private fields is what keeps
this correct the first time either gains a field. Replacing the *outer* object, or dropping
the carried set, is what breaks it.

### C7's general rule: the carried-vs-reset ledger

This same defect — an object built once per turn whose state is wrong to carry, or wrong to
drop, across an iteration boundary — was found **three separate times** during review
(`EmissionRouter`'s latches, the writer's two latches, the placer's emitted set). Each time
it was found by enumerating one more object. So the ledger is written out in full, and
**an implementer adding anything to `run_agent_node`'s per-turn construction block must add
a row to it.** Every object below is built once, before the loop (`app/agent_node.py:795-870`).

| Object | Iteration boundary | Why |
|---|---|---|
| `emissions` (`:798`) | **carry** | It *is* the turn record. Resetting loses the run. |
| `recording_writer` (`:799`) | **carry** | Closure over `emissions`. |
| `registry` — `SourceRegistry` (`:815`) | **carry** | Citation markers `[1]`, `[2]`… are numbered per message. A reset restarts at `[1]` and collides with iteration 1's own citations inside the same assistant message. Same bug class as `_counter`. |
| `viz_list` (`:819`) | **carry** | Never cleared today; the placer's carried `emitted_indexes` is what makes that safe. |
| `viz_signature_indexes` (`:820`) | **carry** | The viz dedupe map. A reset lets iteration 2 re-render a card iteration 1 already showed. |
| `final_writer` (`:821`) | **mutate in place** via `begin_iteration()` — never rebind | `EmissionRouter` holds bound methods on it (`:822`, `:988`). |
| ↳ its `_final_started`, `_flushed` | **reset** | One-way latches. |
| ↳ its `_placer` | **replace, carrying `emitted_indexes`** | Holds mid-parse `_pending`; the index set must survive. |
| ↳ its `_stripper` | **replace** | Holds mid-parse marker state; nothing to carry. |
| `overflow_store` (`:824`) | **carry** | Spill handles must stay readable by `read_tool_result` later in the run. (Its lack of eviction is R19, out of scope.) |
| `tool_overflow` (`:825`) | **carry** | Wraps the two above. |
| `plan_state` (`:848`) | **carry** | The plan persisting across rounds is the entire point (C1). |
| `EmissionRouter` (`:984ff`) | **mutate in place** via `begin_iteration()` | See the field lists above: reset the six transient fields, carry `_counter` and the record accumulators. |
| `handle` / `handle_store` (`:1035-1039`) | **carry** | The steering queue and replay snapshot span the whole turn. See §2.8 for which of its three helpers run per-iteration and which run once. |
| `TurnDeps` | **rebuilt per `agent.iter()` call, harmlessly** | Stateless; assembled from `registry`/`tool_overflow`/`surface`, all of which are carried. Listed only because this table's rule is that everything gets a row. |
| `parked_store` (`:806`) | n/a | Clarify parking is unreachable on a goal turn (C8). |

**The rule of thumb behind the table:** anything that *numbers or dedupes* across the
assistant message (`_counter`, citation indexes, viz signatures, emitted viz indexes) is
carried; anything that tracks *"where am I in this one model response"* (latches, text
buffers, mid-parse state) is reset.

### The lifecycle lives in `_run_once`, not at the call sites

The table above is necessary but not sufficient, because it only covers objects built
*before* the loop. Review found the same omission a fourth time one level up: the §2.7
wrap-up runs on a **second** `Agent` constructed **after** the loop has already called its
final `router.close(...)`, so streaming it through the closed router would hit
`if self._closed: return` (`app/steps.py:952-953`) and the wrap-up's entire report — the
thing that makes a **Partial** honest — would vanish from the stream.

Rather than add a fifth "remember to call `begin_iteration()` here" bullet, **`_run_once`
owns the whole cycle**:

```python
async def _run_once(agent, prompt, history, *, usage, limits, router, final_writer, ...):
    router.begin_iteration()          # <-- the ONLY new lines; everything below is
    final_writer.begin_iteration()    #     app/agent_node.py:1002-1101 moved verbatim
    try:
        ...walk agent.iter(...) nodes, feeding router...
        result = run.result
    except UsageLimitExceeded:
        _close_router_and_flush_final_safely(router, final_writer, "budget")
        ...budget message...
    except asyncio.CancelledError:
        _close_router_and_flush_final_safely(router, final_writer, "interrupt"); raise
    except Exception:
        _close_router_and_flush_final_safely(router, final_writer, "error"); raise
    else:
        router.close("complete")      # deliberately NOT guarded -- see below
        final_writer.flush_final()
    return result
```

**A `finally: router.close(...)` would be wrong**, and the first draft of this section had
one. The existing code distinguishes four `CloseReason`s (`app/steps.py:101`) and closes
differently per path: failures go through `_close_router_and_flush_final_safely`
(`app/agent_node.py:126-133`), which **swallows** a `close()` error so it can never mask
the original exception, while the happy path calls `router.close("complete")` **unguarded**
on purpose — the code's own comment (`app/agent_node.py:1059-1061`) says *"Deliberately NOT
guarded: a close() failure on the happy path is a real turn failure (the final flush/steps
never reached the student)."* A single `finally` flattens both distinctions. So the
extraction moves that structure **verbatim**, with exactly two additions and **one
removal**:

- **Add** the two `begin_iteration()` calls at the top.
- **Remove** both calls to `_record_uninjected_steers(handle, emissions)` —
  `app/agent_node.py:1040` (inside the `try`) and `:1101` (after the block). Neither may
  live inside `_run_once`, because that function now runs once per iteration and this
  helper **drains** the steer queue (§2.8). They are replaced by a **single call in
  `app/goal_loop.py`, after the loop and after the §2.7 wrap-up run**, i.e. at the one
  point where "still queued" genuinely means "never delivered":

  ```python
  # app/goal_loop.py, after the loop has broken and any wrap-up run has completed
  _record_uninjected_steers(handle, emissions)
  ```

  On the **non-goal** path `_run_once` is called exactly once, so the same helper is
  invoked by its single caller immediately afterwards — identical behaviour to today, with
  the call site moved out by one frame rather than changed.

Every model round in a goal turn — the first, each continuation, **and the wrap-up** —
goes through this one function, so there is exactly one place the lifecycle can be wrong
instead of five. The wrap-up differs only in the `agent` it is handed (tool-less) and the
prompt; it is an ordinary iteration to the emitters. **This is the structural answer to a
bug class that recurred four times during review, and it is why `_run_once` is an
extraction worth doing rather than a cosmetic one (C6).**

**C8 — NEW. A goal turn does not mount `ask_student`.** `app/agent_node.py:950` sets
`output_type = [str] if is_continuation else ask_student_output_type()`, so today a goal
run could emit a `ClarifyDraftV2` on any iteration, park the turn, and require a *second*
HTTP turn to resume — which is exactly seam (A) that §2.2 rejects, arriving through the
back door. Goal turns therefore take `output_type=[str]` (D13). Genuine ambiguity becomes
a **stated assumption recorded as a criterion caveat**, which is already what
`specs/agent-mode/plan/agent-mode-architecture-plan.md` D2 asks the agent to do
("make reasonable assumptions, state them, and continue"). A goal turn is additionally
**never resumable as a clarify continuation**: `start_continuation` must reject one.

**C9 — NEW. Absence of evidence is not met.** Revision 1 wrote the rule for
`mutation.outcome == "unknown"` and never wrote it for a criterion with **no receipt at
all**. Both default to `met=False`. The closing card distinguishes them: "not done" vs
**"not checked"** — a criterion the run never attempted must not be presented as one the
judge assessed and failed.

**C10 — NEW. The judge's own prose is not evidence either.** Revision 1 protected against
the agent's claims and then rendered the judge's free-text `reason` to the student as
authoritative fact. Same skepticism, one layer up: every `CriterionVerdict` must cite the
`step_id`s it relied on, those ids are validated in code against the evidence bundle
actually sent, and a `reason` citing no valid id renders as an unsupported note, not as a
finding. The evidence bundle is persisted with the verdict so a wrong reason is
detectable after the fact.

**C11 — NEW. Criteria must be inside what Counselle can observe.** Revision 1's flagship
example — "get my UC applications ready to submit" decomposing to four workspace checks
and then rendering a green **Achieved** — is the exact lie-to-a-student failure this repo
exists to avoid. Counselle has no visibility into the UC portal, transcripts, test-score
sends, or recommendation letters, so it cannot know whether anything is "ready to
submit." Two binding consequences: (a) the criteria prompt must reject any criterion not
checkable from workspace state or a produced artifact; (b) the closing card carries a
mandatory **"what this did not check"** line whenever the student's stated goal is
broader than the criteria — and it is *usually* broader. The flagship example throughout
this document is now "make sure every school on my list has a deadline and a
why-this-school note," which is fully inside Counselle's reality.

**C12 — NEW. Judge failure is a terminal state, not an exception.** A 90-minute run makes
many judge calls; timeouts, rate limits, and structured-output validation failures are
expected, not exotic. After `goal_judge_retries`, the run stops in
**Stopped (check failed)** with everything accomplished so far intact and named. Falling
through to the turn's generic `error` path would be less honest than every outcome this
plan is built to produce.

## 0.4 Revision-1 defect log

Recorded because these are the parts most worth re-checking, not to be self-flagellating.

| # | Revision-1 claim | Verdict | Fixed by |
|---|---|---|---|
| 1 | "An outer `while` needs no changes downstream" | **FALSE** — `EmissionRouter`/`_FinalContentPlacementWriter` are one-shot latches | C7 |
| 2 | "`app/records.py` needs zero diff" | **True only if** `step_id`s stay monotonic; a per-iteration router reset would silently overwrite steps | C7 |
| 3 | "`toolsets=[]` disables tools in code" | **FALSE** — `Agent.iter`'s `toolsets` is documented *"Optional **additional** toolsets"* → `additional_toolsets=` | §2.7 |
| 4 | "The goal statement is `messages[0]`, protected for free" | **FALSE** — `messages` is whole-session history | C2 / D12 |
| 5 | `ClarifyDraftV2` mid-loop | **Unhandled**, and it silently reintroduces the rejected multi-message seam | C8 / D13 |
| 6 | `goal_max_total_tokens=6M` with `goal_max_cost_usd=$2` | **Impossible** — 6M tokens floor-costs $9.00 at `gemini-3.5-flash`; 240 requests realistically ~$45 | D14/D15, §2.10 |
| 7 | "~$0.34" in the mockup | **Fantasy** | §5.2 |
| 8 | Judge failure handling | **Absent** | C12 |
| 9 | Judge evidence size | **Unbounded**, and cumulative-vs-per-iteration unspecified | §3.3 |
| 10 | Judge/criteria token spend | **Outside the ledger** | D6 |
| 11 | Goal header badge | Had **no terminal state** — would read "Working" forever, above a card reading "Achieved" | §5.3 |
| 12 | `ToolWidgets.tsx` dispatch | **Omitted from the Phase 5 manifest**; a `goal` step would fall through to `DefaultToolWidget` | §5.4, §6.5 |
| 13 | "suppress goal steps in `turn-reducer.ts`" | **Wrong file** (`ChatMessage.tsx:213`) and **no discriminator existed** to suppress selectively | §2.6, §5.4 |
| 14 | `goal.css` family file | **Unjustified** — there is no `chat.css`; the whole `ai-chat` surface styles inline via `semantic.css` | §5.4 |
| 15 | "`app/usage.py` has a cumulative-usage bug" | **No bug** — a shared `RunUsage` already makes `result.usage()` cumulative; the fix targeted the wrong file | §2.11 |
| 16 | Backend `file:line` citations in Part 2 | **~8 were wrong or drifted** | corrected throughout |

---

# Part 1 — what we are cloning, and the evidence

## 1.1 Claude Code — the loop and the completion gate

Claude Code's baseline turn ends when the model stops requesting tools and emits text.
There is no built-in judge; the model self-reports completion. Anthropic's own
countermeasure is the `TodoWrite` tool contract, which forbids marking a task complete
while tests fail or errors are unresolved and requires a blocked task to stay
`in_progress` and spawn a new task naming the blocker
([tool description, v2.1.84](https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/tool-description-todowrite.md)).
**Counselle already ships this exact contract** in `app/plan_tool.py:138-163`.

The harness-level forcing function is the **`Stop` hook**, which fires when Claude tries
to end its turn and can return `{"decision": "block", "reason": "..."}` to force
continuation, with a `stop_hook_active` flag so a hook can detect it already forced one
and avoid an infinite loop. Anthropic ships a canonical reference implementation as the
official **ralph-wiggum** plugin
([stop-hook.sh](https://github.com/anthropics/claude-code/blob/main/plugins/ralph-wiggum/hooks/stop-hook.sh)):
it reads an `iteration`/`max_iterations` pair from a local state file, exits when the
cap is hit, scans the last assistant message for a `<promise>` string, and otherwise
re-feeds the original prompt. Its own command doc names the failure mode this feature
exists to close:

> CRITICAL RULE: … you may ONLY output [the promise] when the statement is completely
> and unequivocally TRUE. Do not output false promises to escape the loop.

That is a self-attested completion gate with a string match as its only external check.
**We improve on it in exactly one place**: the check is an independent judge over
evidence rather than the same model's word (D4), because a stuck agent under
helpfulness pressure has a standing incentive to over-report success.

Other Claude Code mechanics we mirror: `--max-turns` as a hard circuit breaker
(**print/non-interactive mode only** — not an interactive control, so the Esc analogy below
is about intent, not parity);
`--max-budget-usd` as a dollar ceiling
([costs docs](https://code.claude.com/docs/en/costs)); `Esc` to interrupt (our Stop);
and a status line carrying context-usage percentage, elapsed time, and a token counter
([statusline docs](https://code.claude.com/docs/en/statusline)) — our budget meter.

## 1.2 Claude Code — compaction

Three tiers, per a source-level reverse-engineering of the shipped bundle
([barazany.dev](https://barazany.dev/blog/claude-codes-compaction-engine)):

1. **Pre-request clearing** (no model call): old tool results beyond the most recent
   ~5 are replaced with a `[Old tool result content cleared]` sentinel. This is
   "microcompact", shipped ~v1.0.68 as an always-on background pass
   ([ClaudeLog](https://claudelog.com/faqs/what-is-micro-compact/)).
2. **Server-side clearing** of thinking blocks and tool results by token threshold,
   using Anthropic's Context Editing/Compaction primitives, cache-aware so a surgical
   delete does not invalidate the cached prefix.
3. **Full LLM summarization**, reusing the main conversation's system prompt and cache
   key rather than an isolated call.

Trigger is a percentage of usable context (community-measured ~92–95%, overridable via
`CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`; the exact default is **UNVERIFIED** — not officially
published). A fixed output/safety buffer (~33K tokens) is reserved.

The shipped summarization prompt walks the conversation chronologically and extracts
intent, approach, decisions, concrete details (file names, full code, signatures),
errors and their fixes, and — as a hard requirement — **preserves security-relevant
user constraints verbatim**
([extracted prompt, v2.1.271](https://github.com/Piebald-AI/claude-code-system-prompts/blob/main/system-prompts/agent-prompt-conversation-summarization.md)).
`CLAUDE.md` is deliberately **excluded** from compaction and re-read from disk instead,
so project rules cannot be lost to summarization drift.

**What we take:** the tiered escalation (cheap clearing first, summarize only when
needed) and the "re-read durable rules from source rather than compacting them" idea —
in our case `prepare` already rebuilds `temporal`, `student_context`, and
`data_picture` from source every turn (`app/graph.py:83-98`), so the equivalent
protection already exists and needs no work.

## 1.3 OpenAI Codex

Compaction lives in `codex-rs/core/src/compact.rs` with prompts in
`codex-rs/prompts/templates/compact/` (revision 1 cited `core/templates/`; they moved). It triggers on an absolute token count
(`model_auto_compact_token_limit`) rather than a percentage, with a documented 95%
`effective_context_window_percent` margin. Its prompt frames the task as a
**"CONTEXT CHECKPOINT COMPACTION"** — explicitly "a handoff summary for another LLM
that will resume the task" — and the reinjection is prefixed:

> Another language model started to solve this problem and produced a summary… Use this
> to build on the work already done and avoid duplicating work.

The rebuilt history is **original system context + the last ~20K tokens of raw recent
messages + the summary** — a raw tail on top of a compressed head, not a full replacement.
Codex also warns the user that repeated compaction degrades accuracy, and retries a
failed compaction call with backoff.
([Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/);
cross-tool mechanics corroborated in [this comparison](https://gist.github.com/badlogic/cd2ef65b0697c4dbe2d13fbecb0a0a5f).
The often-quoted ~167K figure is **UNVERIFIED** against the primary source.)

Codex has **no code-level completion gate** — "finish line" verification is a prompt
convention (embed the verifying command in `AGENTS.md`, run it, report real output).
That is precisely the gap D4 closes.

**What we take:** the handoff framing (summarize *to the next worker*, not *about the
past*) and the raw-tail-plus-summary shape. Both are already how
`SummarizingCompaction` behaves (§1.6.3).

## 1.4 OpenCode

`packages/opencode/src/session/compaction.ts`. Trigger is `isOverflow()` — tokens used
exceeds `context_limit − output_limit`, a headroom check rather than a percentage. The
summary prompt (`session/prompt/compaction.txt`) asks for what was done, what is in
progress, which files are being modified, what is next, user requests/constraints, and
technical decisions with reasons.

Two mechanics worth copying:

1. **A separate, cheaper `prune` pass** that protects the most recent ~40K tokens of raw
   tool output (`PRUNE_PROTECT`) and only prunes older output when at least ~20K tokens
   are reclaimable (`PRUNE_MINIMUM`) — a model-free trim applied *before* summarization
   is warranted. This is the same idea as `ClearToolResults(min_clear_tokens=...)`,
   which we get for free (§4.2).
2. **The auto-resume nudge.** When compaction is auto-triggered (not manual), OpenCode
   appends a synthetic user turn — *"Continue if you have next steps, or stop and ask for
clarification if you are unsure how to proceed."* — so the loop
   self-resumes without waiting on a human. **This is the exact shape of our
   continuation nudge** (§2.5).

OpenCode's permission layer also ships first-class **doom-loop detection**
([DeepWiki](https://deepwiki.com/sst/opencode/5.2-permission-system)) — the harness, not
the model, watches for runaway repetition. The exact heuristic is **CONFIRMED** and directly reusable: `doom_loop` fires "when the
same tool call repeats 3 times with identical input"
([permissions docs](https://opencode.ai/docs/permissions/)) — the same shape as §2.5's
consecutive-error counter. Our equivalent is §2.8.

## 1.5 Published guidance we are obeying

**Anthropic, [Effective harnesses for long-running agents](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents):**
the SDK's built-in compaction alone "isn't sufficient" for quality across many context
windows — durable external artifacts (progress file, feature checklist, git history) are
what make multi-session work coherent. Work on **one feature at a time**, verified
end-to-end, before moving on. Verify by *actually driving the thing*, not only by unit
tests. **Our mapping:** `write_plan` is the checklist, the judge's per-criterion verdict
is the end-to-end verification, and the one-criterion-at-a-time discipline goes in the
prompt block (§2.9).

**Anthropic, [Effective context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents):**
context is a finite attention budget; compaction should "preserve architectural
decisions, unresolved bugs, and implementation details while discarding redundant tool
outputs"; **tool-result clearing is the lowest-risk first move**; and the named risk is
that "overly aggressive compaction can result in the loss of subtle but critical context
whose importance only becomes apparent later." Compaction prompts should be iterated
recall-first, then precision. **Our mapping:** D11 (clearing everywhere, summarizing
only when needed) is exactly this ordering.

**[12-factor-agents](https://github.com/humanlayer/12-factor-agents):** Factor 8 — the
deterministic code around the model owns the decision to loop or break, and is the right
place to bolt on "LLM-as-judge on structured output [and] context window compaction."
Factor 9 — append tool errors to context so the model can self-heal, but bound it with a
consecutive-error counter (~3) and escalate. Factor 10 — keep agents to "3-10, maybe 20 steps max" (revision 1's flat "3–20" rounded away the distinction: 3–10 is the guidance, ~20 the ceiling).
**Our mapping:** §2.2 (the loop is ours, not the model's), §2.8 (error counter),
`goal_max_iterations` default 6 (§2.5).

**LLM-as-judge.** Binary pass/fail with a written critique beats a 1–5 scale, because
"people don't know what to do with a 3 or 4"
([Hamel Husain](https://hamel.dev/blog/posts/llm-judge/)); score a judge on true-positive
and true-negative rate separately, never raw accuracy, since an always-pass judge scores
95% on a system that fails 5% of the time while catching nothing. Decomposed,
task-specific criteria agree with humans better than one holistic question
([Eugene Yan](https://eugeneyan.com/writing/llm-evaluators/)). Judges carry measurable
**self-enhancement bias** — GPT-4 favored its own outputs by ~10%, Claude-v1 by ~25%,
though the paper itself hedges that "our study cannot determine whether the models exhibit
a self-enhancement bias" on its data — and **verbosity bias**, where the finding is
sharper and cuts against a cheap judge: the repetitive-list attack fooled **Claude-v1 and
GPT-3.5 91.3%** of the time but **GPT-4 only 8.7%**
([MT-Bench, arXiv:2306.05685](https://arxiv.org/abs/2306.05685)). **The weaker the judge,
the more a padded, content-free answer passes** — a live risk for this plan's cheap-tier
judge default, carried into R2 and §9(b) rather than buried here. **Our mapping:** §3 is
binary-per-criterion plus critique; the judge is instructed to ignore length as a quality
signal; and it never sees the agent's self-assessment, which is the structural fix for
self-enhancement bias in this setting.

## 1.6 Seven mechanisms VERIFIED live against this repo

Every one of these was executed with `/home/saifuddin/Projects/counselle/.venv` and
`PYTHONPATH` pointed at an unpacked `pydantic_ai_harness-0.4.0` wheel. Output is quoted.
**Phase 0 re-runs all seven and records them under `artifacts/goal-mode/`.**

### 1.6.1 The harness is version-compatible with this repo — and only at 0.4.0

`pyproject.toml:18` pins `pydantic-ai>=1.107.0`; the installed version is `1.107.0`.
Published harness releases pin `pydantic-ai-slim` as follows:

```
0.1.1 -> >=1.80.0     0.4.0 -> >=1.105.0   <-- the only 1.x release WITH compaction
0.3.0 -> >=1.95.1     0.5.0 -> >=2.1.0
0.9.0 -> >=2.14.1     0.31.0 (latest) -> >=2.40.0
```

`0.3.0`'s wheel ships only `code_mode`; **`0.4.0` is the first release containing
`experimental/compaction/`, and the last one that runs on PydanticAI 1.x.** That is why
D3 pins `==0.4.0` exactly and not a range.

### 1.6.2 It imports cleanly on PydanticAI 1.107.0

```
pydantic_ai: 1.107.0
compaction exports: ['ClampOversizedMessages', 'ClearToolResults', 'CompactionStrategy',
 'DeduplicateFileReads', 'LimitWarner', 'SlidingWindow', 'SummarizingCompaction',
 'TieredCompaction', 'WarningKind', 'estimate_token_count', 'warn_experimental']
```

0.4.0 also ships `experimental/step_persistence` and `experimental/subagents` — the two
prerequisites `specs/agent-mode/plan/agent-mode-architecture-plan.md` names as blockers
for durable long jobs and delegation. **Out of scope here** (§8), but recorded: they are
now reachable without the PydanticAI 2.x upgrade that plan assumed was required.

### 1.6.3 Compaction persists into `all_messages()` — so it shrinks the checkpoint

This is the pivotal fact. `app/agent_node.py` writes `result.all_messages()` back into
`state["messages"]`, which the Postgres checkpointer persists. If compaction only edited
the outgoing request, the checkpoint would still grow without bound and the feature
would be worthless across turns.

24 messages in, `SlidingWindow(max_messages=6, keep_messages=4)`:

```
history in: 24
all_messages out: 6
first kept: UserPromptPart(content='user msg 0', ...)
```

And with `SummarizingCompaction(max_messages=8, keep_messages=4)`, 24 in:

```
out count: 7
ModelRequest  [('SystemPromptPart', 'Summary of previous conversation:\n\n## Intent\nSUMMARY BODY')]
ModelRequest  [('UserPromptPart',  'GOAL CONTEXT user msg 0 xxxxxxx...')]
ModelResponse [('TextPart',        'assistant reply 10 yyyyyyy...')]
```

Three things this proves at once: the edit reaches `all_messages()` (so the checkpoint
shrinks with **zero changes to Counselle's persistence path**); the summary is spliced in
as a `SystemPromptPart` prefixed `Summary of previous conversation:`; and
**`user msg 0` — the goal statement — survives**, which is C2.

### 1.6.4 Tool-call/return pairing survives compaction

A provider rejects an orphaned tool call, so this is a hard-failure risk, not a soft one.
Six forced tool calls under `ClearToolResults(max_messages=4, keep_pairs=2)`:

```
tool calls: 6 tool returns: 6
orphans: set()
cleared count: 4 of 6
```

Zero orphans; the four oldest payloads blanked in place, both sides of every pair
retained. This matches the library's documented guarantee ("All strategies preserve
tool-call / tool-return **pairing** — core does not validate this, and a provider rejects
an orphaned pair") and the safe-cutoff walk in its `_shared.py`.

### 1.6.5 A shared `RunUsage` makes `UsageLimits` cumulative across iterations

`Agent.iter()` accepts `usage: RunUsage | None = None` alongside `usage_limits`. Carrying
one `RunUsage` across calls accumulates, and the limit fires at the boundary:

```
after iter 0: requests=1 ...   iter 0 ok, requests= 1
after iter 1: requests=2 ...   iter 1 ok, requests= 2
after iter 2: requests=3 ...   iter 2 ok, requests= 3
                               iter 3 BLOCKED -> The next request would exceed the request_limit of 3
```

This is D6: the whole goal run's budget is enforced by the library, with no manual
arithmetic and no way for an implementer to get the accounting subtly wrong.

### 1.6.6 The exact 0.4.0 API surface (reference, not a verified behaviour)

```
SummarizingCompaction(model=None, max_messages=None, max_tokens=None,
    keep_messages=20, keep_tokens=None, summary_prompt=<default>, tokenizer=None,
    preserve_first_user_message=True, incremental=True, id=None, description=None,
    defer_loading=False)

ClearToolResults(max_messages=None, max_tokens=None, keep_pairs=3,
    placeholder='[tool result cleared]', exclude_tools=frozenset(),
    clear_tool_inputs=False, min_clear_tokens=None, tokenizer=None, ...)

TieredCompaction(tiers, target_tokens, tokenizer=None, ...)

SlidingWindow(max_messages=None, max_tokens=None, keep_messages=40, keep_tokens=None,
    tokenizer=None, preserve_first_user_message=True, ...)
```

`ClearToolResults` raises `ValueError('At least one of max_messages or max_tokens must
be set.')` if neither trigger is given — so both must come from Settings, never a default.

The default `summary_prompt` already asks for the six sections we want, and is worth
quoting because §4.3 decides whether to override it:

> `## Intent` — the user's overall goal and any standing constraints or preferences.
> `## Key decisions` — choices made and the reasoning, so they are not relitigated.
> `## Artifacts` — files, paths, identifiers, commands, and APIs touched — quote exact names.
> `## Current state` — what is done and what is in progress right now.
> `## Next steps` — the immediate actions still required to finish the task.
> `## Open questions` — unresolved questions or blockers.
> Focus on results, not a replay of completed actions.

`incremental=True` feeds the prior summary back as an anchor so successive compactions
update in place rather than summarizing a summary — the decay mitigation Codex and
OpenCode both needed and neither published as cleanly.

### 1.6.7 Agent `instructions` survive compaction — the C2/D12 fix

This is what makes the goal statement structurally un-loseable (C2). Compaction rewrites
`request_context.messages`; `instructions` are not part of that list and are re-sent on
every request. Forty messages, `SlidingWindow(max_messages=4, keep_messages=2)`, with a
pinned instruction block:

```
messages after compaction: 3
instructions survived: 'GOAL PIN: the student wants X. Criteria: c1,c2.'
```

The history collapsed by more than an order of magnitude and the instruction block came
back byte-identical. Revision 1 tried to protect the statement by its position in
`messages` (`preserve_first_user_message`), which fails the moment `/goal` is sent
mid-conversation — see C2. Pinning it in `instructions` cannot fail that way, because no
compaction strategy in the menu touches instructions at all.

## 1.7 What already exists in Counselle (do not rebuild any of it)

| Need | Already shipped | Anchor |
|---|---|---|
| TodoWrite-equivalent + ephemeral re-injection | `write_plan` + `PlanReminder` | `app/plan_tool.py` |
| Todo list UI with progress meter | `PlanChecklist` | `AgentRunView.tsx:56-127` |
| Pinned-once-above-the-stream plan derivation | `latestPlanStep()` | `activity-trace-helpers.ts:18-31` |
| Stop = suspend (nothing is lost) | `TurnRegistry.cancel` → `_cancel_active` | `app/turns.py:632,1060` |
| Mid-run steering (redirect without killing) | `POST /sessions/{id}/steer` | `api/routes/sessions.py:601` |
| Detached run + reattach + `Last-Event-ID` replay | `_Turn.task`, `attach`, `_follow` | `app/turns.py:475,592,1004` |
| Per-tool observation masking / JIT re-read | `ToolResultStore` + `read_tool_result` | `app/tool_overflow.py`, `app/agent_node.py:365` |
| Cost estimation | `estimate_cost` | `app/usage.py` |
| Wall-clock watchdog | `asyncio.timeout(agent_turn_timeout_s)` | `app/turns.py:766` |
| Typed, honesty-gated write receipts | `WorkspaceMutationReceipt` | `domain/mutation_receipts.py` |
| Inline trigger→popover→token-replace picker | `useSkillPicker` (`@`) | `features/skill-picker/` |
| Chronological beat stream, three-shape status | `ToolBeat`, `StepDot` | `ToolBeat.tsx`, `ToolWidgets.tsx:107-120` |

**The genuinely new code in this feature is: the iteration control, the judge, the
compaction configuration, two step kinds, a slash-command trigger, and three UI
components.** Everything else is wiring.

## 1.8 One stale document to fix in passing

`specs/README.md:31` still describes `agent-mode/` as "Scoped; implementation not
started". That is false: `write_plan`, the chronological run surface, the
narration/thinking split, and `plans/agent-interactivity-parity.md` ("completed;
implementation landed") all shipped. Phase 6 corrects that line. This matters because an
implementer reading `specs/README.md` first would otherwise conclude none of §1.7 exists.

## 1.9 Verbatim upstream artifacts worth copying

These were pulled from the actual upstream trees (`sst/opencode`, `openai/codex`,
default branches) and cross-checked against the compiled binaries installed on this
machine. They are quoted because the plan copies their *shape*, and an implementer
should copy from the source rather than from a paraphrase.

### 1.9.1 OpenCode's `MAX_STEPS_PROMPT` — the forced wrap-up (we clone this)

When OpenCode exhausts its per-agent step budget it injects a synthetic assistant-role
message on the final allowed step, which turns tools off and forces a report
(`packages/core/src/session/runner/max-steps.ts`):

> **CRITICAL - MAXIMUM STEPS REACHED**
> The maximum number of steps allowed for this task has been reached. Tools are disabled
> until next user input. Respond with text only.
> STRICT REQUIREMENTS: 1. Do NOT make any tool calls … 2. MUST provide a text response
> summarizing work done so far 3. This constraint overrides ALL other instructions…
> Response must include: Statement that maximum steps for this agent have been reached ·
> Summary of what has been accomplished so far · List of any remaining tasks that were not
> completed · Recommendations for what should be done next

**This is exactly the right behavior for a budget-exhausted goal run and it is now a
requirement of this plan** (§2.7). Today, Counselle's budget path just emits a canned
message (`app/agent_node.py:1039-1043`). A goal run that dies on budget must instead
spend its last model call telling the student what got done and what is left — which is
also what makes the **Partial** terminal state honest rather than a shrug.

### 1.9.2 Codex's persistence language (the model for our prompt block)

`codex-rs/core/gpt_5_1_prompt.md`, `## Autonomy and Persistence`:

> Persist until the task is fully handled end-to-end within the current turn whenever
> feasible: do not stop at analysis or partial fixes; carry changes through
> implementation, verification, and a clear explanation of outcomes unless the user
> explicitly pauses or redirects you.

And the stronger variant in `gpt_5_2_prompt.md`:

> You must keep going until the query or task is completely resolved, before ending your
> turn and yielding back to the user. Persist until the task is fully handled end-to-end
> within the current turn whenever feasible and persevere even when function calls fail.
> Only terminate your turn when you are sure that the problem is solved.

OpenCode's max-autonomy persona adds the anti-hand-wave clause we also want:

> …when you say you are going to make a tool call, make sure you ACTUALLY make the tool
> call, instead of ending your turn. … When you say "Next I will do X" … you MUST actually
> do X … instead of just saying that you will do it.

`plans/agent-loop-hardening.md` §3 already recommended adding one such sentence and
scoped it as LOW. Goal mode is where it belongs, scoped to goal turns (§2.9).

### 1.9.3 OpenCode's summary template (the structure to compare ours against)

`SUMMARY_TEMPLATE` in `packages/core/src/session/compaction.ts` asks for
`## Objective`, `## Important Details`, `## Work State` (`### Completed` / `### Active` /
`### Blocked`), `## Next Move` (numbered), `## Relevant Files`, with:

> Rules: Keep every section, even when empty. Use terse bullets, not prose paragraphs.
> Preserve exact file paths, symbols, commands, error strings, URLs, and identifiers when
> known. **Do not mention the summary process or that context was compacted.**

That last rule is important and is **not** in tension with C4. The split is:
**the model never mentions compaction in its prose** (it would be noise to a student);
**the UI discloses it as a beat** (it is a fact about the run the student is entitled to).
State both in the prompt block and the UI spec so an implementer does not "fix" one by
breaking the other.

Its re-summarization instructions (`SUMMARY_UPDATE_INSTRUCTIONS`) name the decay risk
better than anything else found:

> The `<prior-summary>` summarizes everything that happened before the `<conversation>`.
> Construct a new summary that combines both. **The `<prior-summary>` is discarded after
> this: anything you do not carry into the new summary is lost.** … Where they conflict,
> the conversation wins … Move completed work from "Active" to "Completed".

`SummarizingCompaction(incremental=True)` — our default — implements precisely this
anchored-update behavior, which is why §4.3 does **not** override the default prompt.

### 1.9.4 Concrete numbers from the two upstreams (our defaults are derived from these)

| Constant | OpenCode | Codex | Ours (§2.10) |
|---|---|---|---|
| Reserve-before-compaction buffer | `DEFAULT_BUFFER = 20_000` | model-declared `token_budget` threshold (`INPUT_TOKEN_MARGIN = 256` is a *hard input-size guard*, not an analogous reserve — do not read the two as equivalent) | `goal_compaction_reserve_tokens`, default `20_000` |
| Raw tail kept verbatim | `DEFAULT_KEEP_TOKENS = 8_000` | `COMPACT_USER_MESSAGE_MAX_TOKENS = 20_000` | `goal_compaction_keep_tokens`, default `8_000` |
| Per-tool-output clamp | `TOOL_OUTPUT_MAX_CHARS = 2_000` | — | already ours: `agent_tool_result_max_chars = 8_000` |
| Trigger | `estimate(request) > context − max(output, buffer)` | model-declared `token_budget` threshold | `target_tokens` on `TieredCompaction` |
| Step cap | per-agent `agent.steps`, default ∞ | none (relies on compaction) | `goal_max_iterations = 6` + cumulative `UsageLimits` |

Neither upstream uses a hardcoded percentage. Both compute headroom against the model's
declared context window. §2.10 follows that.

### 1.9.5 One divergence we accept, recorded

Both upstreams re-inject the summary as a **user**-role message: OpenCode wraps it in
`<conversation-checkpoint><summary>…</summary><recent-context>…</recent-context></conversation-checkpoint>`
inside a user message; Codex builds `initial_context + trailing_user_messages + SUMMARY_PREFIX + summary`
and detects prior summaries by that literal prefix. Harness 0.4.0's
`SummarizingCompaction` instead splices a **`SystemPromptPart`** prefixed
`Summary of previous conversation:` (VERIFIED, §1.6.3).

We accept the harness behavior rather than fighting it. Rationale: the role difference is
a provider-ergonomics choice, not a correctness one; our provider is Vertex/Gemini, which
handles system parts natively; and overriding the splice point would mean forking the
library, which is the thing D3 exists to avoid. **Recorded so a future reader does not
mistake it for an oversight.** If summaries ever measurably underperform, the first thing
to try is the documented `summary_prompt` override (§4.3), not a role change.

---

# Part 2 — backend architecture

## 2.1 The loop, in one page

```
POST /v1/sessions/{id}/messages   { text: "<the goal>", goal_mode: true, ... }
  └─ TurnRegistry.start(..., goal_mode=True)        # single-flight, detached task
      └─ asyncio.timeout(goal_turn_timeout_s)       # selected in BOTH _drive and
          │                                         #   _drive_continuation
          └─ graph: prepare → agent → END           # UNCHANGED
              └─ run_agent_node
                   criteria = await derive_criteria(statement)   # cheap model, shared usage
                   instructions = base + render_goal_mode(statement, criteria)   # D12/C2
                   agent   = Agent(..., instructions=instructions,
                                   output_type=[str],            # D13/C8: no ask_student
                                   capabilities=[PlanReminder, *compaction_tiers])
                   usage   = RunUsage()              # shared by agent AND judge (D6)
                   limits  = UsageLimits(cumulative, minus a wrap-up reserve)

                   async with agent:                 # ONE outer context
                     ┌──── iteration loop (app/goal_loop.py owns every decision) ────┐
                     │  result  = await _run_once(agent, prompt, history, usage, …)   │
                     │            # _run_once owns begin_iteration()/close() — C7      │
                     │  verdict = await judge_goal(statement, criteria, evidence)     │
                     │            → emit step(goal, phase="check")                    │
                     │  decision = controller.decide(verdict, usage, plan, cost)      │
                     │  if decision.stop: break                                       │
                     │  history = result.all_messages()   # already compacted         │
                     │  prompt  = controller.nudge_text(verdict)                      │
                     └────────────────────────────────────────────────────────────────┘

                   wrap-up run on a SECOND, tool-less Agent (§2.7)
                   emit step(goal, phase="final", detail.goal.status=<terminal>)
                   build_turn_record(...)            # UNCHANGED (step ids monotonic)
          └─ exactly one terminal `done` / `error`   # UNCHANGED
```

## 2.2 Why the loop lives inside the agent node — and what that actually costs

Four seams were considered.

**(A) An outer orchestrator around `TurnRegistry.start`.** Each iteration its own physical
turn. Rejected: `start()` returns an `AsyncIterator[Event]` for *one* turn wrapped in a
single `EventSourceResponse`, and single-flight (`app/turns.py:415-416`) plus the
one-terminal-event contract would all have to be restructured. Worse, the student would
see **N assistant messages for one goal**, violating "the run is the message"
(`specs/agent-mode/plan/agent-experience-spec.md` §1).

**(B) A new LangGraph node with a conditional edge back to `agent`.** Rejected: `turn_records`
is an overwrite channel with no reducer (`app/state.py:74-79`), `build_turn_record`
assumes one agent execution per turn, `run_turn`'s `meta`/`done` timing assumes the same,
and the watchdog times the whole `_drive` call (`app/turns.py:762`). Four subsystems
re-audited to buy nothing (D) does not.

**(C) A `check_goal` tool the model calls.** Rejected on honesty: the model can decline to
call it or ignore the result. A gate the model can route around is not a gate (§3.1).

**(D) Inside the agent node — chosen.** One turn, one stream, one record, one watchdog,
one cancel path, one reattach.

**The honest cost of (D), which revision 1 got wrong.** `run_agent_node`'s internals are
**not** iteration-agnostic. Three objects are one-shot per node execution:

| Object | Latch | Anchor |
|---|---|---|
| `EmissionRouter` | `final_answer_started`, `_closed` (set once; `close()` returns early if already closed) | `app/steps.py:944,952,991` |
| `_FinalContentPlacementWriter` | `_final_started` **and** `_flushed`, plus two stateful nested parsers | `app/agent_node.py:477-480`, `:389-392`, `app/viz_placement.py:15-18` |
| `Agent.output_type` | `ask_student_output_type()` on non-continuation turns | `app/agent_node.py:950` |

So (D) requires real new code, not "a `while`":

1. **`begin_iteration()` on both emitters** (C7) — resets `_closed`, `final_answer_started`,
   `_final_candidate`, and the text buffers; **deliberately does not reset `_counter`**
   (`app/steps.py:1180-1182`). Monotonic `step_id`s are what keep `app/records.py`'s
   in-place-replace-on-repeated-id behavior (`app/records.py:141-149`) correct, and
   therefore what keeps D7's zero-diff promise true.
2. **`output_type=[str]` on goal turns** (C8/D13).
3. **Restructuring `async with (agent, agent.iter(...) as run)`**
   (`app/agent_node.py:1006-1014`) into one outer `async with agent:` and N inner
   `agent.iter()` contexts. *(Note: the comment at `app/agent_node.py:1005` says this
   context "enters the MCP toolset for the run" — that is **stale**; the counselle-db MCP
   server was deleted in school-data-v3. Correct the comment while restructuring so the
   next reader is not misled.)*
4. **A second, tool-less `Agent` for the wrap-up** (§2.7).

This is still the cheapest of the four seams — (A) and (B) need all of the above *plus*
their own restructuring — but the plan states it plainly rather than claiming the loop is
free. C6's revised budget (~150–250 net new lines across `app/agent_node.py` and
`app/steps.py`) reflects it.

## 2.3 What must not change

- `app/graph.py` — stays `prepare → agent → END`. **Zero diff.**
- `domain/events.py` `PROTOCOL_VERSION` — stays `1`; additive only.
- `app/records.py` — **zero diff, conditional on C7's monotonic step ids.** The persistence
  path is genuinely generic over `kind` (`build_parts`/`build_segments`/`derive_receipt`
  have an "other" fallback), so new `StepKind`s persist and replay without changes. A
  per-iteration counter reset would silently overwrite earlier segments — which is why C7
  forbids it. If an implementer finds themselves editing `app/records.py`, the step-id
  decision has drifted.
- `app/checkpointer.py`, `migrations/` — **zero diff** (D8).
- `app/plan_tool.py` — **zero diff** (C1).

## 2.4 The wire contract (D10)

`MessageBody` (`api/routes/sessions.py:95-116`) takes loosely-typed `Any` fields
re-validated below the route. Add one:

```python
    goal_mode: Any = None   # harness mode: changes budgets, mounts the judge,
                            # enables the summarizing compaction tier. A skill may do
                            # none of those (app/skills.py:396-422); response_mode is
                            # quick|think.
```

Threading, **every hop enumerated** (revision 1 undercounted these):

1. `api/routes/sessions.py::post_message` → `TurnRegistry.start(..., goal_mode=bool)`.
   `start()` has an explicit typed keyword signature (`app/turns.py:353-367`), so this is
   a real signature change, not a kwargs passthrough.
2. `_Turn` gains `goal_mode: bool`.
3. **Both** drive loops select the timeout: `_drive` (`app/turns.py:762`) **and**
   `_drive_continuation` (`app/turns.py:840`) read `agent_turn_timeout_s` today.
4. `app/run_turn.py` builds `turn_ids` at **two** sites, with `surface`/`essay_id`
   reassigned again in the inherited/continuation branch and the fresh-turn branch
   (`app/run_turn.py:894-895`). `goal_mode` needs the same treatment at every one.
5. `run_agent_node` reads `turn_ids["goal_mode"]`.

**The goal statement is the turn's user text** — no separate wire field, because
duplication is how the two drift. Its durability is handled by D12, not by position.

## 2.5 The iteration controller

`app/goal_loop.py` — decides; no I/O beyond delegating to the judge.

```python
@dataclass(frozen=True)
class GoalLimits:
    max_iterations: int
    max_wall_clock_s: float
    max_cost_usd: float | None
    judge_retries: int

@dataclass
class GoalLoopController:
    statement: str
    criteria: tuple[GoalCriterion, ...]
    limits: GoalLimits
    started_monotonic: float
    iteration: int = 0
    consecutive_tool_errors: int = 0
    _prev_met: frozenset[str] | None = None
    _prev_plan_signature: str | None = None

    def decide(self, verdict, usage, plan_signature, cost_usd) -> GoalDecision: ...
    def nudge_text(self, verdict) -> str: ...
```

`decide` returns `GoalDecision(stop, status, reason)` and stops on the first of:

1. `verdict.met` → **achieved**.
2. `iteration >= max_iterations` → **stopped_budget**.
3. wall clock exceeded → **stopped_budget**.
4. **projected** cost of one more iteration exceeds `max_cost_usd` → **stopped_budget**
   (D14 — the check is *before* spending, not after).
5. stalled for `goal_stall_iterations` → **stopped_no_progress**.
6. `consecutive_tool_errors >= goal_max_consecutive_tool_errors` → **partial**, escalate.
7. judge failed after `judge_retries` → **stopped_check_failed** (C12).

Token/request exhaustion is **not** in this list: it arrives as `UsageLimitExceeded` from
the library (D6), is handled by §2.7, and also lands **stopped_budget**.

**`partial` vs `stopped_budget` — the rule, stated once.** They are distinct values, not
two names for one thing. **`stopped_budget` means a limit stopped the run** (iterations,
wall clock, cost, tokens, or requests); **`partial` means the run stopped for a reason
that was not a limit** — today only the consecutive-tool-error escalation. Both render the
same way to the student (a `warning` badge and the per-criterion breakdown); they differ
in the headline's reason clause and in what the wrap-up says to do next. `achieved` is the
only status that requires every criterion `met` **and** `checked`.

**Stall detection** (`domain/goal.py::is_stalled`, pure, unit-tested): stalled when the met
criterion-id set is identical to the previous iteration's **and** the rendered plan is
byte-identical. Requiring both separates "genuinely stuck" from "still working a long
criterion". Plan signature is `render_plan(plan_state.items)` (`app/plan_tool.py:61-71`).

**The nudge** clones OpenCode's auto-resume beat but carries the judge's finding:

```
<goal-check>
Not done yet. Met: 2 of 4.
Still outstanding:
  - [c3] Every school on the list has an application deadline recorded.
  - [c4] Every school on the list has a why-this-school note of at least 3 sentences.
Judge note: two schools have empty notes.
Keep working on the outstanding criteria. Do not restate what is already done.
</goal-check>
```

## 2.6 Goal and compaction beats ride `step` (D7)

```python
StepKind = Literal[..., "write_plan", "workspace", "memory", "goal", "compaction"]

GoalPhase = Literal["criteria", "check", "final"]

# THE single source of truth for the six terminal states (§0.1, §2.5, §5.3).
# Lives in domain/goal.py and is imported here; written out once, nowhere else.
GoalStatus = Literal[
    "achieved",              # every criterion met AND checked
    "partial",               # stopped for a non-limit reason (tool-error escalation)
    "stopped_budget",        # a limit stopped it: iterations, wall clock, cost, tokens, requests
    "stopped_no_progress",   # stalled for goal_stall_iterations
    "stopped_user",          # the student pressed Stop
    "stopped_check_failed",  # the judge itself failed after its retries (C12)
]

class GoalCriterionView(BaseModel):
    id: str
    text: str
    met: bool | None          # None = not yet judged
    checked: bool             # False = never attempted (C9 "not checked")
    reason: str | None
    evidence_step_ids: tuple[str, ...] = ()   # C10 — validated in code

class GoalStepDetail(BaseModel):
    phase: GoalPhase          # THE discriminator the frontend suppresses/renders on
    statement: str
    status: GoalStatus | None # populated on phase="final" (and only there)
    iteration: int
    max_iterations: int
    criteria: list[GoalCriterionView]
    critique: str | None = None
    met_count: int
    total_count: int
    unchecked_count: int
    not_checked_note: str                 # C11 — REQUIRED, never None. See §3.2.
    # Code-owned ledger. Never model-authored.
    requests_used: int; requests_limit: int
    tokens_used: int;   tokens_limit: int
    est_cost_usd: float | None; cost_limit_usd: float | None
    elapsed_s: float

class StepDetail(BaseModel):
    ...
    goal: GoalStepDetail | None = None
```

`ev_step` already drops `None` fields from `detail` before the wire
(`domain/events.py:356-372`), so this is additive; old clients ignore it.

**Step-id discipline (load-bearing for the UI, §5.4):** the `criteria` beat and each
`check` beat get **distinct** `step_id`s, because `mergeToolSegment`
(`frontend/src/features/ai-chat/turn-reducer.ts:118-137`) merges by `step_id` — sharing
one id would collapse every check into a single ever-updating segment and there would be
exactly one in-stream beat for the whole run instead of one per round.

**Why `step` and not a new event type.** A new type needs an `EventType` member, an
`ev_goal`, a branch in `TurnRegistry._observe` (`app/turns.py:884`), a new `Emission`
variant, a new segment kind, a new persisted/replay path, and a frontend parser case.
Riding `step` needs none of them.

## 2.7 Budget exhaustion is a report, not a shrug — on a second Agent

Revision 1 said the wrap-up would pass `toolsets=[]`. **That is false.** `Agent.iter`'s
parameter is documented *"Optional **additional** toolsets for this run"* and flows
internally to `Agent._get_toolset(additional_toolsets=...)`; it is additive and removes
nothing. (The public keyword remains `toolsets=` — `agent.iter(additional_toolsets=[])`
would raise `TypeError`. Neither matters for the chosen fix, which never passes the
parameter at all.) The correct mechanism:

- A reserve is held back: the loop runs under
  `request_limit = goal_max_model_requests − goal_wrapup_reserve_requests`; the wrap-up
  uses the full limit, so there is always room.
- On `UsageLimitExceeded` (or any §2.5 stop that warrants a report), a **second `Agent`
  is constructed with no tools at all** and run once with the wrap-up prompt. Building an
  `Agent` is already a per-turn operation here, so this is cheap and it makes "no tool
  calls" structural rather than requested.
- The wrap-up states: the budget/limit reached, what was accomplished, which criteria
  remain, **which were never checked** (C9), and what to do next — the four items
  OpenCode's `MAX_STEPS_PROMPT` requires (§1.9.1).
- Terminal status is **partial** / **stopped_budget** / **stopped_no_progress** /
  **stopped_check_failed**, never achieved (C3).

## 2.8 Cancellation, steering, clarify, and failure

- **Stop** already means suspend (`app/turns.py:632,1060`). The loop needs a `try/finally`
  so the ledger and last verdict reach the turn record before `CancelledError` propagates
  → **stopped_user**.
- **Steering** works mid-run (`POST /sessions/{id}/steer`) and is the right redirect
  primitive. **Criteria are not re-derived mid-run**: a steer refines *how*, not *what* is
  judged. Recorded as a deliberate limitation (§8).

  **Its three helpers split across the loop boundary, and getting that wrong loses a
  student's message.** `_emit_injected_steers` and `record_replayable_snapshot`
  (`app/agent_node.py:668-678`, `:640-666`) are bound to a specific `run`, so they stay
  **inside `_run_once`**, per iteration — `record_replayable_snapshot` keeps working
  because `run.all_messages()` on iteration N already contains the carried history, and
  `emissions_len` indexes the accumulator that is carried anyway.

  `_record_uninjected_steers` (`:680-689`) is different and must run **exactly once, after
  the final iteration and after the §2.7 wrap-up** — never inside `_run_once`. Its single
  call site is given in the `_run_once` section of C7, along with the two existing calls it
  replaces. It **drains** the steer queue and
  reports each message as `injected=False`. Called per iteration, a steer the student sent
  during round 2 would be drained and shown as *never delivered* at the end of round 2,
  while round 3 — which was about to inject it — gets nothing. That is simultaneously a
  lost message and a false receipt. A queued steer at an iteration boundary is not
  uninjected; it is *about to be injected*, and the loop is what makes that true.
- **Clarify is not available on a goal turn** (C8/D13). `output_type=[str]`, so the model
  cannot park the run. Genuine ambiguity becomes a stated assumption recorded against the
  criterion, matching `agent-mode-architecture-plan.md` D2's "make reasonable assumptions,
  state them, and continue". `start_continuation` also rejects a goal turn —
  **belt-and-braces, not a live hole**: `accept_clarification` only fires on a record with
  `status == "awaiting_input"`, which is only set when the output is a `ClarifyDraftV2`
  (`app/agent_node.py:1112,1165`), which `output_type=[str]` makes structurally impossible.
  The rejection exists so a future change to `output_type` cannot silently resurrect the
  path.
- **Consecutive tool errors** → stop at 3 and escalate (12-factor Factor 9).
- **Crash mid-run** loses the run, exactly as any turn does today. Documented, never
  contradicted by UI copy (§7.3 gate 12), and covered by the acceptance script (§7.4-I).

## 2.9 The prompt block, and pinning the goal (D12/C2)

`counselor.md` actively suppresses what goal mode needs — *"Keep visible planning
minimal"* (`config/assets/prompts/counselor.md:321-322`) and *"Never narrate your plan as
a 3–6-step list unless the student explicitly asks"* (`:309-310`). Goal mode therefore
**appends** a versioned block rather than forking the prompt: `render_goal_mode()` joins
into `instructions` alongside `render_source_availability` / `render_selected_skills`
(`app/agent_node.py:933-942`).

**The block carries the goal statement and the frozen criteria verbatim.** This is the C2
fix, and the mechanism is worth stating precisely rather than loosely: `instructions` is a
plain string computed **once**, at `Agent(...)` construction (`app/agent_node.py:900-942`,
`:951`) — the criteria are frozen at derivation, so nothing is rebuilt per round and an
implementer should **not** construct a new `Agent` per iteration. What protects it is simply
that `instructions` lives **outside `messages`** and is re-sent with every request, so
**no compaction strategy can touch it** — VERIFIED §1.6.7, where a 40-message history
compacted to 3 and the instructions came back byte-identical.

Contents, and nothing more:

1. **An explicit override** naming *Visible Tool Work* and *Planning And Tool Loop*.
2. **The goal statement and criteria**, verbatim.
3. **`write_plan` first**, then one criterion at a time, verified before moving on.
4. **Persistence**, in Codex's words (§1.9.2), plus OpenCode's anti-hand-wave clause.
5. **Completion honesty**: a criterion is met only when a tool receipt or a produced
   artifact shows it; an independent check sees receipts, not claims.
6. **Assumptions, not questions** (C8): state the assumption and continue.
7. **Never mention compaction** in prose (§1.9.3).
8. **No tool is named that the turn does not have** (ADR 0013).

## 2.10 Budgets — rebuilt (D14/D15)

Revision 1's numbers were impossible: `goal_max_total_tokens = 6_000_000` at
`model_counselor = gemini-3.5-flash` (`config/settings.py:133`), priced
`input_per_1m=1.50, output_per_1m=9.00` (`config/settings.py:638`), floor-costs **$9.00**
against a stated **$2.00** cap — and a 240-request run at a realistic context size is
**~$45**. Measured on this repo's own price table:

| model | requests × avg context | input tokens | est. cost |
|---|---|---|---|
| `gemini-3.5-flash` | 60 × 60k | 3.6M | **$5.83** |
| `gemini-3.5-flash` | 240 × 120k | 28.8M | **$44.93** |
| `gemini-2.5-flash` | 90 × 55k | 4.95M in + ~72k out | **$1.67** = $1.485 input + $0.18 output |

Two consequences.

**D15 — goal turns run on `model_cheap`** (`gemini-2.5-flash`, `config/settings.py:144`,
`$0.30/$2.50`) by default. Cost in a goal run is dominated by re-sent context × request
count, and the counselor tier is 5× the input price. This is a real quality/cost tradeoff
and it is an **open owner decision** (§9), not something to inherit by accident.

**A hard price cliff to stay clear of.** `model_counselor_think` is
`gemini-3.1-pro-preview`, whose price *doubles* above a 200k-token context
(`long_context_input_per_1m=4.00`, `long_context_threshold_tokens=200_000`,
`config/settings.py:639-645`). Revision 1's `goal_compaction_target_tokens = 240_000`
would have parked every Think-mode goal run permanently on the far side of it.
**`goal_compaction_target_tokens` must stay below 200,000 for this reason alone**,
independent of any context-window calculation.

```python
# --- Goal mode ---
goal_model: str = ""                    # "" => model_cheap (D15). Resolved through
                                        # app/model_selection.py, the SAME ADR 0011 seam as
                                        # model_goal_judge/model_goal_criteria — not inline
                                        # in agent_node, so all three stay consistent.
goal_max_cost_usd: float = 3.00         # THE primary budget (D14), but a SOFT one: see
                                        # the honesty note below the block.
goal_max_model_requests: int = 90       # DERIVED: at model_cheap and a ~55k average
                                        # context, 90 requests ~ 4.95M input + ~72k output
                                        # ~ $1.67 - about 44% headroom under the $3.00 cap
                                        # for the judge, criteria and wrap-up calls.
                                        # Re-derive whenever goal_model or the cap moves.
goal_max_total_tokens: int = 10_000_000 # backstop ONLY. Sized so cost genuinely binds
                                        # first: $3.00 at model_cheap's $0.30/1M input is
                                        # ~10M input-equivalent tokens. A lower backstop
                                        # (5M was considered and rejected) fires BEFORE the
                                        # cost cap on any run averaging over ~55k tokens a
                                        # request, which would make D14 false in practice.
goal_max_iterations: int = 6            # judge rounds
goal_wrapup_reserve_requests: int = 3
goal_max_wall_clock_s: float = 3600.0   # 60 min, inside goal_turn_timeout_s
goal_turn_timeout_s: int = 5400         # 90 min watchdog (vs 3600 normal)
goal_stall_iterations: int = 2
goal_max_consecutive_tool_errors: int = 3
goal_judge_retries: int = 2             # then stopped_check_failed (C12)
model_goal_judge: str = ""              # "" => model_cheap
model_goal_criteria: str = ""           # "" => model_cheap
goal_max_criteria: int = 6
goal_judge_evidence_max_chars: int = 30_000   # §3.3 — bounded, was unbounded

# --- Compaction (also closes plans/agent-loop-hardening.md §1) ---
compaction_clear_tool_results_after_messages: int = 40
compaction_clear_tool_keep_pairs: int = 3
compaction_min_clear_tokens: int = 20_000        # OpenCode's PRUNE_MINIMUM
goal_compaction_target_tokens: int = 100_000     # MUST stay < 200_000 (price cliff)
goal_compaction_keep_tokens: int = 8_000         # OpenCode's DEFAULT_KEEP_TOKENS
goal_compaction_reserve_tokens: int = 20_000     # OpenCode's DEFAULT_BUFFER
```

**The cost cap is soft, and the plan says so rather than implying a hard guarantee.**
`UsageLimits` understands requests and tokens, not dollars, so `goal_max_cost_usd` is
enforced as a **projection checked before each iteration** — which means a single
unusually expensive iteration (many internal tool round-trips before that `agent.iter()`
reaches `End`) can overshoot it before the next checkpoint fires. The only *hard*,
library-enforced ceilings are `goal_max_model_requests` and `goal_max_total_tokens`. The
10M token backstop is also a thinner margin than "backstop" suggests: at the $1.67 run's
blended rate, $3.00 corresponds to ~9.05M tokens, so the backstop sits only ~10% above
where cost would already have bitten, and which one fires first is sensitive to the
input/output mix. Phase 0's S8 measurement exists to replace these estimates with numbers.

**Which phase ships which knob:** the `compaction_*` and `goal_compaction_*` knobs ship in
**Phase 1**; every other `goal_*`/`model_goal_*` knob ships in **Phase 2**;
`goal_max_concurrent_turns` (§2.12) ships in **Phase 3**. This block is the single source
of truth — if a phase manifest and this block disagree, this block wins.

**These defaults are provisional until Phase 0 measures a real run** (S8). The rule that
is *not* provisional: whatever the numbers become, they must satisfy
`projected_cost(requests × avg_context) ≤ goal_max_cost_usd` on the configured model, and
`goal_compaction_target_tokens < 200_000`.

**The judge's spend is inside the ledger** (D6): `judge_goal` and `derive_criteria` are
passed the **same shared `RunUsage`**, so their tokens count against
`goal_max_total_tokens` and against the cost projection. Revision 1 left them invisible
to it.

## 2.11 Usage accounting — corrected

Revision 1 claimed `app/usage.py` needed a fix. **It does not, and there is no bug.**
`app/usage.py`'s `enrich_usage_event`/`log_turn_complete` never touch PydanticAI types;
they operate on plain dicts of ints. The single read is `app/agent_node.py:1089-1094`
(`result.usage`, an **attribute**, not a call), and because D6 threads one shared
`RunUsage` through every `agent.iter(usage=...)`, that snapshot is **already cumulative** —
VERIFIED §1.6.5. Phase 3 therefore adds a **regression test asserting the existing
cumulative behavior**, and `app/usage.py` is **removed** from Phase 3's modified-file list.

## 2.12 Capacity and growth — the risks revision 1 omitted

**Process-wide, cross-tenant blast radius.** `stream_buffer_bytes = 256 MiB`
(`config/settings.py:441`) is explicitly *"a process-wide byte budget shared across EVERY
live turn's ring buffer"*, and a consumer that falls off the evicted head is terminated
with an honest `error`. `max_concurrent_turns = 50` (`config/settings.py:456`) is a
global cap enforced synchronously in `start()` (`app/turns.py:415-416`). Both were sized
for turns that finish in seconds-to-minutes. A goal turn can hold a slot and a
disproportionate share of that shared byte pool for up to `goal_turn_timeout_s`, so a
handful of concurrent goal runs can evict **other students'** ring-buffer heads and
shrink the global slot pool for an hour. Mitigation (Phase 3): a separate
`goal_max_concurrent_turns` ceiling (default 5) checked in `start()` alongside the
existing cap. Mechanically: `_Turn` already gains `goal_mode` (§2.4) and the current check
is a flat `len(self._turns) >= max_turns` (`app/turns.py:415-416`), so the goal cap is a
filtered count over the same dict inside the same synchronous claim window — at n ≤ 50
that needs no maintained counter and no new decrement paths to get wrong. Recorded as
**R10**.

**Turn-record growth is not solved by compaction.** Compaction edits `state["messages"]`
only. `turn_records`' `segments[]`/`steps[]` are untouched and a 90-request goal run
plausibly writes hundreds of step entries into one JSONB blob. Phase 0 (S8) measures a
real turn-record size; if it is alarming, the fix is a cap on persisted step segments per
turn, not more compaction. Recorded as **R14**.

**`tool_result_store` non-eviction is amplified here.** `plans/agent-loop-hardening.md` §2
already reports that the spill store never evicts. A goal turn compresses many turns'
worth of that growth into one. Still out of scope (§8), but goal mode is the feature most
likely to surface it first in production — stated, not dismissed in a clause.
---

# Part 3 — the judge

## 3.1 Why there is a judge at all

Neither upstream has one. Claude Code gates completion on the model's own `<promise>`
string plus a `TodoWrite` honesty rule; Codex gates it on a prompt convention; OpenCode
gates it on the provider's `finish` reason. All three are the same pattern: **the agent
decides it is done.**

That is acceptable for a coding agent whose user reads a diff before accepting it. It is
not acceptable here, for a reason this repo has already been burned by: the essay panel
shipped an agent that "was caught claiming 'I have proposed a suggestion' on a turn where
it made no tool call" (AGENTS.md). The sanctioned fix was prompt hardening **plus a
code-owned readout sourced from the server's record**. A goal loop is that failure mode
with a budget attached — an agent repeatedly asked "are you done yet?", with an obvious
escape hatch. The literature names the bias: judges favour their own outputs by a
measurable margin ([MT-Bench](https://arxiv.org/abs/2306.05685)).

So the gate is a separate call that does not see the agent's self-assessment.

## 3.2 Criteria, derived once, and bounded by what Counselle can observe (C11)

At goal start, one cheap-model call turns the statement into **2–6 binary acceptance
criteria** (`goal_max_criteria`). Decomposed, task-specific criteria agree with human
annotators better than one holistic question
([Eugene Yan](https://eugeneyan.com/writing/llm-evaluators/)).

```python
class GoalCriterion(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str        # "c1".."c6" — stable for the run
    text: str      # one binary, checkable sentence
```

Derived **once** and frozen (§2.8). The criteria are rendered into the agent's
instructions (D12) and shown to the student immediately (§5.2) — they are the contract
the run will be graded against.

**Three hard constraints on a criterion**, enforced by the criteria prompt and graded in
Phase 2's eval:

1. **Binary.** It is met or not; no scale.
2. **Checkable from workspace state or a produced artifact** — something a tool receipt
   can evidence.
3. **Inside Counselle's reality.** This is C11 and it is the one that matters most.
   Counselle cannot see the Common App or UC portal, transcripts, test-score sends, or
   recommendation letters. A criterion like *"my applications are ready to submit"* is
   unjudgeable and must be rejected at derivation, not quietly proxied down to four
   workspace checks and then reported as **Achieved** — which is exactly what revision 1's
   flagship example did, and it is the lie-to-a-student failure in miniature.

**The scope gap is surfaced, not hidden — and it cannot be silently omitted.** When the
student's stated goal is broader than what the criteria cover — which is *usually* — the
card carries a `not_checked_note` naming what is outside Counselle's view.

Revision 2's first draft made this a nullable, model-authored field, which reintroduced the
very failure C11 exists to prevent: a cheap model that simply omits it produces a green
**Achieved** card with no caveat. So:

1. `not_checked_note` is **required** in the criteria call's typed output, so an omission
   is a pydantic validation error and is retried like any other malformed output.
2. If it is still absent after retries, the loop substitutes a **code-owned default**:
   *"Counselle only checked the criteria above. Anything outside your Counselle workspace —
   application portals, transcripts, test scores, recommendation letters — was not
   checked."*
3. The field is therefore **never `None`**, and the card has no branch that can skip the
   line. Honest at zero as loudly as at N, the `PendingChangesReadout` precedent.

"Achieved" then means *these criteria are met*, in the student's sight, never *your
applications are fine*.

## 3.3 What the judge sees — bounded, and scoped

**Evidence:**
1. The goal statement, verbatim.
2. The frozen criteria.
3. **Tool receipts** — the public `StepData`/`StepDetail` payloads already emitted,
   including typed `WorkspaceMutationReceipt`s whose `outcome` is already honesty-gated
   (`success`/`no_change`/`partial`/`failed`/`unknown`, `docs/ARCHITECTURE.md` §27.8).
4. The final assistant text of the iteration — it is the deliverable, so it is judged.

**Not evidence, and the judge is told so:** the agent's narration and any sentence
asserting an action; length, fluency, or confidence (verbosity bias is the largest
measured judge bias — padded responses were preferred >90% of the time in MT-Bench); and
any prior verdict.

**Scope and bound — revision 1 specified neither.**

*(These two rules govern which **older** receipts survive into the bundle as it grows.
They are a separate mechanism from how `checked` is computed — that depends only on the
judge's citations against the bundle actually sent this round, §3.4. Neither depends on
the other.)*

- **Scope is cumulative from goal start**, not per-iteration. Per-iteration evidence would
  mark a criterion satisfied in round 1 as unmet in round 4 simply because its receipt was
  not re-emitted, causing pointless rework and a false Partial.
- **Size is bounded** by `goal_judge_evidence_max_chars` (30,000). Receipts are selected
  newest-first, **plus every receipt whose `step_id` a prior verdict cited** — so a
  criterion that has already been evidenced keeps that evidence as the bundle grows.

  **The honest limit of that rule: it is retrospective.** On the *first* judge call no
  verdict exists yet, so nothing has been cited against any `criterion_id` and selection
  degrades to plain newest-first with no per-criterion protection. That is tolerable
  because round 1's receipt set is small and rarely near the bound — but it is stated
  rather than papered over, because the alternative (tagging every receipt with a
  `criterion_id` at emission time) would need a new field on `StepData` and
  `WorkspaceMutationReceipt`, which neither has today and which this plan does not add.
  If receipts are dropped the judge is told **how many**. Note that the bound cannot
  silently turn a real result into a false negative: `checked` is computed from the
  judge's *citations* against the bundle actually sent (§3.4), so a criterion whose
  evidence was dropped simply has nothing valid to cite and lands `checked=False` —
  reported as **"not checked"**, never as a failure.

**Three rules — and note which are enforced where.** The first two are applied **by the
loop in code** after the verdict returns (§3.4), so the judge's compliance is a
belt-and-braces nicety rather than the guarantee; the third is what the loop computes:

- `mutation.outcome == "unknown"` is **not met** — §27.8 built that vocabulary for writes
  with no terminal proof, and reading it as success would launder an unproven write into a
  completed criterion.
- **No evidence at all is not met, and it is `checked=False`** (C9). This is the case
  revision 1 missed entirely. "Not done" and "never attempted" are different facts and the
  card shows them differently.
- A criterion whose evidence was dropped by the size bound is `checked=False`, never
  guessed either way.

## 3.4 Output shape, and grounding the judge's own prose (C10)

```python
class CriterionVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    criterion_id: str
    met: bool                              # binary. Not a score.
    reason: str                            # one sentence naming what it relied on
    evidence_step_ids: tuple[str, ...]     # C10 — validated against the bundle sent
    # NOTE: `checked` is NOT here. See below — the loop computes it.

class GoalVerdict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    criteria: tuple[CriterionVerdict, ...]
    critique: str

    @property
    def met(self) -> bool:
        # `checked` is applied by the loop when it builds GoalCriterionViews;
        # a criterion the loop marked unchecked is already forced met=False.
        return bool(self.criteria) and all(c.met for c in self.criteria)
```

**`checked` is computed by the loop from the citations, never self-reported.** Asking the
judge whether it checked something is trusting the thing under test. But the loop does not
need a `criterion_id` on every receipt to answer it — **the citations already carry the
association**. `compute_checked` in `domain/goal.py` is:

```python
valid = {sid for sid in v.evidence_step_ids if sid in bundle_step_ids}
checked = bool(valid)                       # cited nothing the loop actually sent ⇒ unchecked
met     = v.met and checked and not all_unknown(valid, receipts)
```

Three properties fall out, all structural rather than prompt-dependent:

- A criterion the judge could not evidence cites nothing, so `checked=False`, so
  `met=False` — the C9 distinction between **"not done"** and **"never checked"** is
  derived, not declared.
- A judge that fabricates `step_id`s has them filtered by the C10 validation, which drops
  `checked` to `False` too. Hallucinating evidence cannot manufacture a met criterion; it
  can only downgrade the criterion to unchecked.
- If every valid cited receipt has `mutation.outcome == "unknown"`, the loop forces
  `met=False`. §27.8's vocabulary exists precisely because such a write has no terminal
  proof, and honouring it **in code** rather than in the judge's prompt is what makes
  honesty gate 4 structural instead of aspirational.

This also removes the round-1 bootstrap problem §3.3 names: `checked` never depended on a
receipt→criterion index, only on what the judge cited and the loop could verify.

**Binary, with a written reason, and no overall score.** *"If your evaluations consist of
a bunch of metrics that LLMs score on a 1-5 scale… you're doing it wrong"*, because
*"people don't know what to do with a 3 or 4"*
([Hamel Husain](https://hamel.dev/blog/posts/llm-judge/)). The overall verdict is
**derived**, never separately generated, so the model cannot return `met=true` beside a
failing criterion.

**C10 — the judge's prose is not evidence either.** Revision 1 protected against the
agent's claims and then rendered the judge's free-text `reason` to the student as
authoritative fact. A judge can hallucinate a specific-sounding reason as easily as an
agent can. So:

- Every verdict cites `evidence_step_ids`.
- Those ids are **validated in code** against the bundle actually sent. A `reason` citing
  no valid id renders as an unsupported note, not as a finding, and never as the sole
  basis for `met=True`.
- The evidence bundle is persisted alongside the verdict, so a wrong reason is detectable
  after the fact rather than being an unfalsifiable claim on a card.

## 3.5 The judge is a loop gate, never an answer validator (D5)

AGENTS.md is explicit that this repo "removed its programmatic answer-validation layers on
purpose" and that "**No output validator was added and none may be**". The judge does not
violate that, and the distinction must be stated in code comments, in the prompt asset,
and in the ADR so nobody later "improves" it into one:

- Its **only** effects are the loop decision and the rendered verdict card.
- It never rewrites, blocks, suppresses, re-generates, or gates the agent's prose.
- Every word the agent streamed stays on screen regardless of the verdict.

It is the same category of thing as `UsageLimits`: a control that decides whether to keep
spending, not a censor between the model and the student.

## 3.6 Prompt structure (`config/assets/prompts/goal_judge.md`)

Structure only; wording is Phase 2's job, iterated recall-first then tightened.

1. **Role.** "You decide whether stated criteria are met, from evidence. You are not the
   agent that did the work and you do not continue the task."
2. **The goal**, verbatim. 3. **The criteria**, with stable ids.
4. **The evidence**, in labeled blocks: `<tool-receipts>` / `<final-text>`, plus an
   explicit `<dropped-receipts count="N"/>` marker when the bound truncated.
5. **The rules.** Receipts are evidence; prose asserting an action is not. `unknown` is
   not met. No evidence means `checked=false`. Ignore length, fluency, confidence. Judge
   each criterion independently against this evidence only. Cite the `step_id`s you used.
6. **The output contract** — the typed model above.
7. **Calibration anchors**: one worked met and one worked not-met example from Phase 2's
   labeled set.

## 3.7 When the judge itself fails (C12)

A 90-minute run makes many judge calls; timeouts, rate limits, and structured-output
validation failures are expected. The sequence:

1. Retry up to `goal_judge_retries` (2) with backoff — the same discipline Codex applies
   to a failed compaction call.
2. On exhaustion, stop in **Stopped (check failed)**, with everything accomplished so far
   intact, the last successful verdict shown, and the criteria it never got to marked
   `checked=False`.
3. The wrap-up run (§2.7) still executes, so the student gets a real report.

Falling through to the turn's generic `error` path would be less honest than every other
outcome this plan produces, and it would discard work the student paid for.

## 3.8 How we know the judge works

The honesty carve-out makes real evaluation mandatory here rather than optional. Per
`hamel.dev`:

- **30+ hand-labeled examples minimum**, from real goal runs across the workspace families
  (tasks, schools, essays, activities), covering both outcomes.
- Split train/dev/test; train examples become the few-shot anchors; test is scored once.
- **Score true-positive and true-negative rate separately, never raw accuracy.** An
  always-"met" judge scores ~95% accuracy on a system that fails 5% of the time while
  catching nothing — and the false positive (declaring a goal achieved when it is not) is
  the harmful direction, because it is the machine version of lying to the student.
- Target >90% agreement before the judge is trusted in the loop.

**The criteria step is graded too, not just the verdict** — against the three constraints
in §3.2, with a specific check that no criterion claims coverage of something Counselle
cannot observe (C11). Bad criteria make a perfect judge worthless.

**A known residual risk, recorded rather than papered over.** By default the criteria
writer and the judge are the *same* cheap model. A systematically lenient model will both
write lenient criteria and grade them leniently, and those errors compound rather than
cancel. Mitigation options, for §9: run the judge on a different tier than the criteria
writer, or accept and document. The eval in this section is what would *detect* it; it
does not by itself prevent it.

This lands in `evals/`, not `pytest` — brittle string-asserts on model output are worse
than useless (AGENTS.md). What **does** get hard unit tests is everything deterministic:
status derivation, stall detection, the budget ledger, `GoalVerdict.met`'s derivation, the
`evidence_step_ids` validation, and the C9 absent-evidence rule.

---

# Part 4 — compaction

## 4.1 Dependency, not a hand-roll (D3)

```toml
# pyproject.toml
"pydantic-ai-harness==0.4.0",
```

Three reasons, in order of weight.

1. **Precedent.** `app/plan_tool.py` and `app/tool_overflow.py` are both already ports
   from this exact MIT harness, at a named commit. Using the library for the third module
   is the consistent choice; hand-rolling a fourth mechanism it already ships is the
   inconsistent one. Principle 2 ("never reinvent the wheel") and the house rule "lean on
   the dependencies already in the project… Do not assume a library lacks a capability
   without checking" both point the same way.
2. **The hard part is already solved, correctly.** Tool-call/tool-return pairing must
   survive every edit or the provider rejects the next request — a hard 4xx, not a soft
   degradation. The library binary-searches for a cutoff then *walks backward to a
   pair-safe boundary*, blanks tool results in place rather than deleting parts, and keeps
   cleared tool args JSON-valid. VERIFIED in §1.6.4: six calls, six returns, zero orphans.
   Re-deriving that is a week of subtle bugs for no gain.
3. **It is exactly pinnable, and the resolution is verified.** A live `uv add pydantic-ai-harness==0.4.0` in a worktree of this repo resolved in 16 lines across `pyproject.toml`/`uv.lock`, added exactly one package, and did **not** move `pydantic-ai`/`pydantic-ai-slim` off `1.107.0`. `==0.4.0` is the last release supporting PydanticAI 1.x
   (§1.6.1). We are already frozen on PydanticAI 1.x, so the pin costs nothing we had not
   already accepted.

**The honest downsides, recorded:** it is `Development Status :: 3 - Alpha`, it is under
`experimental/` with an API that "may change or be removed in any release, without a
deprecation period", it emits a `HarnessExperimentalWarning` on import, and at `==0.4.0`
we receive no future fixes without a PydanticAI 2.x upgrade. Mitigations: the exact pin;
a single `warnings.filterwarnings` for `HarnessExperimentalWarning` at the app boundary;
and **no wrapper module** — per ADR 0017 ("use the stack's native seams, never wrap
them"), the capabilities are constructed directly in the agent node's capability list
from Settings values. A shallow `app/compaction.py` pass-through would violate 0017 and
buy nothing, since a future swap is a change to one `capabilities=[...]` list either way.

*(Alternative considered and rejected: porting the ~1,000 lines of
`experimental/compaction/` into `app/`. It respects no dependency constraint we actually
have, and it means owning the pair-safety logic forever.)*

## 4.2 The configuration

Every turn, goal or not (D11) — mounted unconditionally in the `capabilities=[...]` list
`app/agent_node.py` already builds for **every** turn, alongside `PlanReminder`, so the
non-goal path gets it with no branch:

```python
ClearToolResults(
    max_messages=settings.compaction_clear_tool_results_after_messages,
    keep_pairs=settings.compaction_clear_tool_keep_pairs,
    min_clear_tokens=settings.compaction_min_clear_tokens,
)
```

Zero-LLM, zero added latency below the trigger, and it is the exact move Anthropic names
as the lowest-risk first step. `min_clear_tokens` is the cache guard: clearing rewrites
message content and invalidates the provider's prompt cache from the clear point onward,
so the library declines to bust the cache to reclaim a trivial amount — the same
reasoning as OpenCode's `PRUNE_MINIMUM`.

Goal turns additionally get the escalating tier:

```python
TieredCompaction(
    tiers=[
        ClearToolResults(...),                       # cheap pass, again, first
        SummarizingCompaction(
            model=cheap_model,                       # ADR 0011 seam, never hardcoded
            keep_tokens=settings.goal_compaction_keep_tokens,
            preserve_first_user_message=True,        # C2 — non-negotiable
            incremental=True,                        # anchored update, no summary decay
        ),
    ],
    target_tokens=settings.goal_compaction_target_tokens,
)
```

**`goal_compaction_target_tokens` must stay below 200,000** — not for context-window
reasons but for a price reason: `model_counselor_think` is `gemini-3.1-pro-preview`, whose
input price doubles above a 200k context (`long_context_input_per_1m=4.00`,
`long_context_threshold_tokens=200_000`, `config/settings.py:639-645`). Revision 1's
`240_000` would have parked every Think-mode goal run permanently on the far side of that
cliff. §2.10 sets `100_000`.

`TieredCompaction` triggers and stops on a single `target_tokens` budget: it runs the
cheap passes first and only pays for a summary if still over. That is the SOTA default the
library documents and the same escalation Claude Code implements as its three tiers.

**Interaction with `PlanReminder`.** Both are capabilities on the same agent and both act
on the outgoing request. `PlanReminder` appends an *ephemeral* tail that never enters
durable history and anchors a `CachePoint` on the last durable user content
(`app/plan_tool.py:80-110`); compaction rewrites *durable* history. They operate on
disjoint material, so they compose — but a compaction that rewrites content before the
cache point does forfeit that cache segment on the next request. That is expected and
priced in (it is why `min_clear_tokens` exists). *(Spike item S2 asserts they coexist on
one agent with a real tool-calling run.)*

**Interaction with `tool_result_store`.** `app/tool_overflow.py` spills oversized single
payloads to a handle the model can re-read via `read_tool_result`. `ClearToolResults`
blanks *old* results in history. These are complementary — per-item versus per-history —
and the ordering is safe because a spilled payload's handle lives in `TurnState`, not in
the message that gets blanked. Note that `plans/agent-loop-hardening.md` §2 separately
reports that `tool_result_store` never evicts and bloats every checkpoint. **That is a
real, related bug and it is explicitly out of scope here** (§8) — flagged so the
implementer does not discover it mid-phase and quietly widen this branch.

## 4.3 We do not override the default summary prompt

The shipped default already asks for `## Intent`, `## Key decisions`, `## Artifacts`,
`## Current state`, `## Next steps`, `## Open questions` (quoted in §1.6.6), which covers
every field Claude Code, Codex, and OpenCode's prompts ask for between them — and
`incremental=True` already implements OpenCode's anchored-update discipline. The one
domain-specific thing worth adding later is an instruction to preserve **school names,
UNITIDs, deadlines, and citation markers verbatim** (the analogue of Codex's "quote exact
names"). Deferred deliberately: per Anthropic, a compaction prompt should be iterated
against real traces recall-first, and we will not have real goal-run traces until Phase 6.
`summary_prompt` is a constructor argument, so this is a one-line change when the traces
exist — recorded in §8 rather than guessed at now.

## 4.4 Why compaction is not goal-only (D11)

`plans/agent-loop-hardening.md` §1 already rates unbounded history growth **HIGH** for
*all* sessions: `app/agent_node.py` feeds the entire serialized history into every run and
`history_processors` is unused, so long sessions "degrade into the dumb zone", "grow cost
quadratically over the session", and "eventually hit the context limit". That finding
predates this feature and is independently true.

Mounting `ClearToolResults` for every turn is roughly three lines and closes it. Mounting
it only for goal turns would mean a conditional capability list, two context-management
behaviors to reason about, and a standing HIGH finding left open next to code that
obviously fixes it. The expensive summarizing tier stays goal-only, because only a goal
run is long enough to justify paying for a summary.

**If a reviewer wants this scoped down**, the cut line is clean: drop the global
`ClearToolResults`, keep the goal-only `TieredCompaction`, and leave the audit finding
open. The plan recommends against it and says so, but the phase boundary (Phase 1 ships
compaction alone, before any goal code exists) is drawn exactly so that this is a
one-decision rollback rather than an unpick.

---

# Part 5 — UI/UX

## 5.1 The governing contract

`specs/agent-mode/plan/agent-experience-spec.md` is marked **"APPROVED target — this is
the contract every implementation plan must satisfy"**. Its thesis:

> **The run is the message, and it never re-renders.** … When the run finishes, that
> stream **freezes exactly as it last appeared**.

Goal mode adds **two pinned elements** and **two inline beat kinds**. Nothing above the
closing card may re-render, reorder, restyle, or reset a toggle when the run ends
(invariant 3). That constraint is what makes this cheap, and it rules out the obvious
wrong design — a separate goal dashboard or route, which would fork the surface and break
invariant 2.

## 5.2 Second by second

**1. Typing `/`.** At caret position 0 of an empty composer, a popover opens above the
textarea. In v1 there is one command:

```
┌──────────────────────────────────────────────┐
│  /goal    Work until a goal is done          │
└──────────────────────────────────────────────┘
  [ /                                       ]
```

Same mechanics as the `@` skill picker: `role="listbox"`, `aria-activedescendant` on the
textarea, ↑/↓ wrap, Enter selects, Esc/Tab close.

**2. Selected.** The `/goal` token is **removed** and a **Goal** chip appears in the
composer's chip row. The chip is removable; removing it sends an ordinary message. The
student types the goal as normal text and presses Enter. (This differs structurally from
the skill picker — see §5.5.)

**3. The run starts.** The user bubble appears, then the goal header — in two states,
because deriving criteria is a real model call that takes time and can fail:

```
┌─ Goal ───────────────────────────────── Working ─┐     ← while criteria derive
│  Make sure every school on my list has a         │
│  deadline and a why-this-school note             │
│  ▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁                              │     ← two staggered Skeleton bars
│  ▁▁▁▁▁▁▁▁▁▁▁                                     │        (DESIGN.md §15.2)
└──────────────────────────────────────────────────┘
```

then, once derived:

```
┌─ Goal ───────────────────────────────── Working ─┐
│  Make sure every school on my list has a         │
│  deadline and a why-this-school note             │
│                                                   │
│  ○ c1  Every school on the list has a deadline    │
│  ○ c2  Every deadline matches the school's own    │
│        published date                             │
│  ○ c3  Every school has a why-this-school note    │
│  ○ c4  Every note is at least three sentences     │
│                                                   │
│  ▓▓▓░░░░░░░░░░░░  0/4 · round 1 of 6 · 4% budget  │
└───────────────────────────────────────────────────┘
```

Note the example. Revision 1's flagship was *"get my UC applications ready to submit"*,
which Counselle **cannot** verify — no portal, transcript, or recommendation-letter
visibility — and which therefore must never earn a green **Achieved** (C11).

**3b. If deriving the criteria fails.** The criteria call is a real model call and can
fail. After its retries the header drops its skeleton and renders:

```
┌─ Goal ─────────────────────────── Stopped — couldn't check ─┐
│  Make sure every school on my list has a deadline and a     │
│  why-this-school note                                        │
│                                                              │
│  Counselle couldn't work out how to check this goal.         │
│  Ask again, or say it as a checklist.                        │
└──────────────────────────────────────────────────────────────┘
```

Status `stopped_check_failed`, `warning` badge — the same terminal state as a judge that
gave out (C12), because it is the same fact: **the run cannot be graded, so it must not
run.** No tool call has happened yet, so nothing was touched. This is the one state where
explanatory copy is warranted, because the student has to do something.

**4. Then the existing surface, unchanged.** `PlanChecklist` pins below the header; below
that the ordinary chronological stream of thinking rows, response text, and tool beats.
All existing code.

**5. A goal check**, one compact beat per round, in stream order:

```
  ◆  Checked against the goal — 2 of 4 done · continuing
     └ Still outstanding: c3 note missing on 2 schools, c4 not reached
```

The header's criteria flip their marks and the counters advance at the same moment. The
header is **derived from the latest `goal` step**, the same way `PlanChecklist` derives
from the latest `write_plan` step — so it cannot drift from what streamed, and it is
invariant-3-safe because by the time `done` fires the header already shows the last
streamed value. That property depends on the terminal `phase="final"` step being emitted
**before** the loop exits and before `done` — see §5.3.

**6. A compaction.** One line, the quietest beat on the surface (C4):

```
  ·  Compacted the conversation to keep working
```

**7. Completion.** The cursor stops and the closing card fades in **below** the stream, in
the slot where sources and the action row already appear. Everything above is
byte-identical to the last streamed frame.

```
┌─ Goal ──────────────────────────────────── Achieved ─┐
│  ✓ c1  Every school on the list has a deadline        │
│        6 deadlines recorded                           │
│  ✓ c2  Every deadline matches the published date      │
│  ✓ c3  Every school has a why-this-school note        │
│  ✓ c4  Every note is at least three sentences         │
│                                                        │
│  Not checked: whether you have actually submitted      │
│  anything, or your transcript and recommendation       │
│  status — Counselle can't see those.                   │
│                                                        │
│  6 rounds · 71 requests · ~$1.20 · 11m 04s            │
└────────────────────────────────────────────────────────┘
```

Two things revision 1 got wrong are fixed here. The **"Not checked"** line is mandatory
whenever the stated goal is broader than the criteria (C11) — "Achieved" means *these
criteria are met*, never *your applications are fine*. And the cost figure is real:
revision 1's "~$0.34" was fantasy (§2.10).

Partial is the same card with a `warning` badge and unmet reasons visible **without a
click** (C5):

```
┌─ Goal ───────────────────────── Partial — budget reached ─┐
│  ✓ c1 …   ✓ c2 …                                          │
│  ✗ c3  Every school has a why-this-school note            │
│        2 of 6 schools still have an empty note.           │
│  ◌ c4  Every note is at least three sentences             │
│        Not checked — c3 was never finished.               │
│                                                            │
│  Stopped at the cost limit after 5 rounds · ~$3.00         │
│  Send a message to keep going from here.                   │
└────────────────────────────────────────────────────────────┘
```

`◌` is the **not checked** mark (C9) — distinct from `✗` "checked and not met". Presenting
a never-attempted criterion as a failure would be its own small dishonesty.

**8. Stop, any time.** The existing Send↔Stop toggle. Every beat stays; the card reads
*Stopped — you stopped it* with a neutral badge; the next message continues with all the
tool work in context.

**9. Reload.** Identical stream, header, and card — all derived from persisted `step`
events (D7).

## 5.3 The six terminal states, and the header that must show them

**The defect revision 1 shipped:** the header's badge vocabulary had exactly one row
("Working") and the terminal states belonged only to the card. On reload, a student
scrolling up would see a header reading **"Goal — Working"** sitting directly above a card
reading **"Goal — Achieved"** — two contradictory claims about the same run, permanently.

**The fix:** `GoalHeader` and `GoalVerdictCard` render the **same** status, from the same
source — the latest `goal` step's `detail.goal.status`. That field is populated only on
the `phase="final"` step, which the loop **must emit before it exits**, so the last
streamed frame already carries the terminal status and invariant 3 holds.

| Status | Headline | Badge |
|---|---|---|
| running | `Working` | neutral (`secondary`) |
| `achieved` | `Achieved` | `success` |
| `partial` | `Partial — <reason>` | `warning` |
| `stopped_budget` | `Partial — budget reached` | `warning` |
| `stopped_no_progress` | `Stopped — no progress` | `warning` |
| `stopped_user` | `Stopped — you stopped it` | neutral (`secondary`) |
| `stopped_check_failed` | `Stopped — couldn't check` | `warning` |
| *no `phase="final"` step* | `Stopped — interrupted` | neutral (`secondary`) |

**The last row is the crash rule, and it is load-bearing.** A hard process kill cannot run
"emit the final step before exiting" — no `phase="final"` step is ever written. Without an
explicit rule the header would render **"Working"** forever on reload, which is precisely
the stuck spinner §7.4-I forbids. So the rule is: **a settled turn (the stream reached a
terminal event, or the client reattached and found no active turn) whose latest `goal` step
has `status == None` renders `Stopped — interrupted`.** The frontend already knows the
turn's own state, so this needs no backend mechanism — it is a derivation, not a
heartbeat. **But it must not be derived from a `turnStatus` allowlist**, and getting this
wrong is easy: there are *three* different ways a goal run reaches a client without a
`phase="final"` step, and they land on three different statuses.

| Path | resulting `turnStatus` | caught by `settled`? |
|---|---|---|
| stream died mid-run | `"error"` (`useTurnEngine.ts:502`) | **no** — `settled` is `complete \|\| cancelled` (`ChatMessage.tsx:374-375`) |
| reattach finds no active turn (204) | unchanged from replay | **no** |
| fresh page load, replayed from the persisted transcript with no terminal event | `"idle"` — `initialTurnState()` (`turn-reducer.ts:72`), and `isLiveStatus` counts `"idle"` as **live** | **no** |

An allowlist of terminal statuses catches the first and misses the other two, leaving a
stuck "Working" spinner on exactly the reload path a student is most likely to hit. So the
rule is stated as the **inverse**, which covers all three without enumerating them:

> **A goal message that is not the turn this client is actively streaming, and whose latest
> `goal` step has `status == null`, renders `Stopped — interrupted`.**

The engine already knows which `messageId` is live, so this is one comparison. Phase 5
introduces it as a named helper (`isInterruptedGoal`) rather than reusing or widening
`settled`, whose narrower meaning is correct for the copy/feedback action row it already
gates. It is honest: the run did
stop, Counselle does not know its outcome, and the card says exactly that rather than
implying either success or ongoing work.

`error`/`destructive` is reserved for the run actually failing, not for a goal that came
up short. Status is **never colour alone**: every state carries its word and its criterion
marks. `DESIGN.md` allows exactly five badge variants and **no `info` variant ever**; this
table uses three of them — `success`, `warning`, and `secondary`.

## 5.4 Components, and the dispatch edit revision 1 forgot

**New — four small files:**

| File | What it is |
|---|---|
| `features/ai-chat/components/GoalHeader.tsx` | Pinned header, incl. the skeleton state. Reuses `Meter`/`MeterTrack`/`MeterIndicator` and the `{n}/{m}` pill from `PlanChecklist` (`AgentRunView.tsx:88-105`) and `Badge`. |
| `features/ai-chat/components/GoalVerdictCard.tsx` | Closing card. Same criterion-row anatomy as the header so the two read as one object. |
| `features/ai-chat/components/GoalBeat.tsx` | **New in Phase 1** (compaction row), **extended in Phase 5** (goal check beat). The in-stream `goal` check beat and the `compaction` beat, on `ToolBeatRow`/`ToolBeatIcon`/`ToolBeatLabel`/`ToolBeatSubtitle`. |
| `features/slash-command/` | `slash-query.ts`, `useSlashCommand.ts`, `SlashCommandMenu.tsx`. |

**Where the branch goes.** Every predicate in the cascade below keys off `step.tool` or
`step.kind` values a goal/compaction step never sets, so the new branch is safe **anywhere
above the final `TOOL_WIDGETS`/`DefaultToolWidget` fallback** — order is not the subtlety.
The subtlety that *does* matter: because `ChatMessage.tsx:213` suppresses
`phase="criteria"` and `phase="final"` **before** `ToolStepBeat` is called, this branch
only ever receives `phase="check"` goal steps and `compaction` steps. **It needs no phase
check of its own.**

**The edit that was missing.** `ToolStepBeat` (`frontend/src/features/ai-chat/components/ToolWidgets.tsx:367-424`)
is a hardcoded predicate cascade — `isHistoricalOverflowStep` → `schoolDataToolPresentation`
→ `isSearchKind` → `isWorkspaceReadTool` → `isOtherReadTool` → `isWriteTool` → a
`TOOL_WIDGETS` registry keyed on `step.ui?.widget` → `DefaultToolWidget`. **There is no
dispatch by `step.kind`.** Without an explicit branch, a `goal` step falls through to
`DefaultToolWidget`, which reads generic fields none of which exist on `GoalStepDetail`,
and the check beat renders empty or garbled. Revision 1 listed this edit for `compaction`
in Phase 1 and then omitted it for `goal` in Phase 5. **`ToolWidgets.tsx` is in both
manifests now.**

**Suppression: the right file, and the discriminator that makes it possible.** Revision 1
said "suppress in `turn-reducer.ts`". Wrong file — `turn-reducer.ts` only merges and
appends; the `write_plan` precedent is a conditional inside `SegmentBeat` in
`ChatMessage.tsx:213`. And revision 1 wanted to suppress *some* goal steps but not others
with no field to distinguish them. `GoalStepDetail.phase` (§2.6) is that field:

- `phase="criteria"` → suppressed from the stream; feeds the header only.
- `phase="check"` → **rendered** in the stream as a beat, and feeds the header.
- `phase="final"` → suppressed from the stream; feeds the header and the card.

Each gets a **distinct `step_id`**, because `mergeToolSegment`
(`turn-reducer.ts:118-137`) merges by `step_id` — a shared id would collapse every round
into one segment and produce exactly one beat for the whole run.

`latestGoalStep()` mirrors `latestPlanStep()` (`activity-trace-helpers.ts:18-31`) including
its guard. `latestPlanStep` checks **both** halves — `entry.step.kind === "write_plan" &&
(entry.step.detail?.items?.length ?? 0) > 0` — because the start event carries
`detail=None` and the checklist would otherwise flicker empty. Copy both halves:
`entry.step.kind === "goal" && entry.step.detail?.goal != null`. Dropping the `kind` check
happens to be harmless today (nothing else populates `detail.goal`) and is still wrong —
it loses the type narrowing the precedent gets for free.

**Reused unchanged:** `PlanChecklist`, `ToolBeat*`, `StepDot`'s three-shape status
vocabulary, `Meter`, `Badge`, `Collapsible`, `Skeleton`, the Send↔Stop toggle, `Empty`,
and the whole `turn-reducer`/segment pipeline.

**Explicitly not used:** `components/ai-elements/task.tsx` and `chain-of-thought.tsx` —
both vendored with **zero importers anywhere**, and `DESIGN.md` says extend
`ToolBeat`/`AgentRunView` instead. An implementer will find `task.tsx` and think it fits.
It does not.

**No `goal.css`.** Revision 1 proposed one. There is no `chat.css` or `ai-chat.css` in
`frontend/src/styles/` (the family files are `shell`, `workspace`, `task`, `onboarding`,
`activity`, `essay`, `profile`, `schools`, `shadcn`), and **every** component this feature
builds on — `PlanChecklist`, `ToolBeatRow`, `Badge` — resolves tokens **inline** through
`semantic.css` with no family-tier indirection. Goal mode introduces no new colour or
role. A family file here is unjustified indirection against the local convention and
against YAGNI. If a genuinely reusable role appears later, it goes in `semantic.css`.

**Styling:** header and card are `--surface-raised`; the criteria block inside them is
`--surface-inset`; no card inside a card. `rounded-xl` card, `rounded-md` chips,
`tabular-nums` on every counter. Motion 200ms panel enter, `transform`/`opacity` only, and
**`motion-safe:` on every animated class** — the gap DESIGN.md already flags at
`AgentRunView.tsx:42,179` and `ChatMessage.tsx:67` is not to be repeated here.

## 5.5 The slash trigger — a partial mirror, not a clone

`useSlashCommand` mirrors **only the trigger-detection half** of `useSkillPicker`: caret
scanning, the `role="listbox"` popover, `aria-activedescendant`, ↑/↓ wrap, Enter/Esc/Tab,
and first refusal in `handleKeyDown` (chained before the skill picker, which is chained
before Enter-to-submit — `AiComposer.tsx:117-119`).

It **diverges completely on the selection consequence**, and revision 1's "mirroring
file-for-file" invited an implementer to build the wrong thing:

| | skill picker (`@`) | slash command (`/`) |
|---|---|---|
| Trigger | `/(?:^|\s)@([A-Za-z0-9-]*)$/` — anywhere | `/^\/([a-z-]*)$/` — position 0 only |
| On select | **replaces** the token with a persistent `@mention` that stays in the text | **removes** the token entirely |
| State lives in | the message text, re-scanned every change (`hasSelectedSkillMention`) | composer state, a boolean |
| Deselect | delete the `@mention` from the text | click the chip's remove affordance |
| Overlay | `InlineSkillMentionLayer` highlights the mention | **none needed — do not build one** |

Because there is no textual anchor, the self-cleaning behaviour the skill picker gets free
must be specified explicitly:

- **Clearing the composer to empty clears the Goal chip.** Otherwise an orphaned chip
  silently arms goal mode on an unrelated later message.
- **Sending clears it**, like every other per-message composer control.
- **Typing `/goal` and never selecting it from the menu does not arm goal mode.** The
  literal text is sent as an ordinary message. Only an explicit selection (Enter or click)
  arms it. This is the conservative reading and it must be stated, because a student who
  types past the popover is an entirely plausible path.

Both composers are wired — `ChatComposer.tsx` (in-session) and `AiComposer.tsx` (landing)
— and this plan **does not merge them**; that merge is its own change (DESIGN.md debt #9).

## 5.6 Why there is no approval gate in v1 (D9)

1. **It is not Claude Code's default.** Plan mode is opt-in; the default is "you ask, it
   works".
2. **A lighter escape hatch already exists.** The criteria render before the first tool
   call and Stop is one click that loses nothing.
3. **The mechanism is not free.** The natural reuse is the v2 clarify lifecycle, which
   restricts `output_type=[str]` and encodes clarify semantics — a parallel
   `PreparedGoalContinuation` for a v1 gate. And C8 has just removed clarify from goal
   turns entirely, so this would be reintroducing the machinery goal mode deliberately
   turns off.

**The counter-argument, recorded**, because it is the strongest objection to this plan:
an autonomous run has 29 workspace mutation tools and a large budget, and it can churn a
student's workspace unattended. §7.2 addresses it and §9 puts it to the owner.

## 5.7 Accessibility

- The header is a labeled region. Criterion state is icon **and** `sr-only` text, spelled
  out rather than delegated, since a binary criterion's vocabulary does not map onto
  `PlanChecklist`'s four-state one: **`met:`**, **`not met:`**, **`not checked:`**,
  **`not yet checked:`** (running).
- Check beats announce via the existing `aria-live="polite"` on `ToolBeatRow`. **The header
  is not a live region** — it updates every round and would spam a screen reader. The beat
  is the announcement; the header is the current state.
- The slash menu mirrors the skill picker's listbox pattern.
- `jest-axe` coverage in `goal-a11y.test.tsx`.
- jsdom cannot verify contrast or layout. §7.4's live pass is not optional — every recent
  surface in this repo that skipped it shipped a defect several waves of jsdom review
  passed (AGENTS.md, essay AI panel).

## 5.8 Density, small screens, and the long run

Revision 1 specified none of this, and six criteria plus reasons is a lot of pinned
vertical content.

- **Criterion text wraps; it never truncates.** C5 forbids hiding a failure reason, so
  truncation is not available.
- **On a 390px viewport the header collapses to a summary row** — statement, badge,
  `{n}/{m}`, meter — with the criteria behind a disclosure that is **open by default while
  running and on the card**, closed only when the student closes it. The card never
  collapses an unmet reason.
- **One meter, not two.** `PlanChecklist` renders its own `Meter` directly below the
  header. On a narrow viewport the two would stack as near-identical progress bars
  measuring different things. So the collapsed header keeps the `{n}/{m}` pill and
  **drops its meter**, leaving `PlanChecklist`'s as the only bar on screen; the expanded
  header keeps both, where the vertical separation makes them legible as distinct.
- **The composer during a run** keeps the Stop button and stays usable for steering
  (§2.8). It does **not** show the Goal chip for the running turn — the chip is a
  per-message control, and leaving it armed would silently make the steer message a new
  goal.
- **Scroll.** `useQuestionAnchoredScroll` forces position only on session-open and on-send
  (DESIGN.md §15.1). A steer is neither, so **a steer must not re-anchor**; the student
  stays where they are reading. A 90-minute run producing far more beats than any turn
  this mechanism was designed around is exactly why §7.4-J is a scale check, not a
  six-fixture gallery check.

## 5.9 Copy rules

`AGENTS.md`: *"Do not add subtitles, helper text, or descriptive copy beneath headings,
labels, cards, or settings by default."*

- The header is `Goal` + the statement. No "Counselle is working toward your goal…" line.
- Criterion rows are the criterion text alone. A `reason` renders only when the criterion
  is unmet or unchecked — where it is load-bearing rather than restating.
- The ledger is one line of facts, not a sentence about them.
- The **"Not checked"** line is the one mandatory piece of explanatory copy in the feature,
  and it exists because omitting it would overclaim (C11).
- Sentence case, second person, say the noun (DESIGN.md §13).
---

# Part 6 — the phased build

Nine phases (0-8). **Each ships something independently useful**, and Phase 8 is
explicitly optional and not required for "done". Phase 1 is valuable even if
goal mode is cancelled outright. Pre-phase: `git checkout -b feat/goal-mode`. All scratch
output goes in `artifacts/goal-mode/` (gitignored) — never the repo root, `docs/`, or
`specs/`.

## 6.0 Phase 0 — spike (one day, no product code)

Record raw output under `artifacts/goal-mode/<ts>-spike/`.

| Id | Question | Status |
|---|---|---|
| S1 | `pydantic-ai-harness==0.4.0` installs and imports on PydanticAI 1.107.0 | **VERIFIED** §1.6.2; independently re-verified by live `uv add` in a worktree — resolves in 16 lines, does not move `pydantic-ai` |
| S2 | `PlanReminder` + `ClearToolResults` + `SummarizingCompaction` coexist on one agent across a **real tool-calling** run with zero orphaned pairs | Partly verified (§1.6.4, `ClearToolResults` alone). **Run all three together.** |
| S3 | ~~`toolsets=[]` disables tools~~ | **CLOSED — FALSE.** `Agent.iter`'s `toolsets` is *"Optional **additional** toolsets"* → `additional_toolsets=`. §2.7 now builds a second tool-less `Agent`. **Spike the replacement instead.** |
| S4 | Is the model's context window readable programmatically on the Vertex/Gemini seam? | **OPEN** — but no longer blocking: `goal_compaction_target_tokens` is now bounded by the 200k price cliff (§2.10), which is a harder constraint than the window. |
| S5 | Shared `RunUsage` enforces a cumulative `UsageLimits` | **VERIFIED** §1.6.5 |
| S6 | Compaction reaches `all_messages()` and therefore the checkpoint | **VERIFIED** §1.6.3 |
| S7 | **NEW — BLOCKING.** `EmissionRouter.begin_iteration()` / `_FinalContentPlacementWriter` reset: build the methods, run two `agent.iter()` calls on one agent, with a `close()` between, and assert: (a) narration/final classification still works in iteration 2; (b) viz staged in iteration 2 flushes **and no card staged in iteration 1 is emitted twice** (the carried `emitted_indexes`); (c) a `[[viz:` marker split across the iteration boundary neither leaks nor truncates (the `_stripper` rebuild); (d) `step_id`s are monotonic across iterations; (e) `build_segments` produces N segments, not overwrites; (f) a tool left open at the boundary terminalizes honestly via `close()` rather than vanishing; (g) **a third run issued after the loop's final `close()` — the §2.7 wrap-up shape — still streams its text**, which is the case a closed router silently swallows. | **OPEN — blocks Phase 3** |
| S8 | **NEW.** Measure real cost, wall clock, turn-record JSONB size, and `tool_result_store` size for one realistic goal run. Lock §2.10's defaults against it. | **OPEN — blocks Phase 3 sign-off** |
| S9 | **NEW.** Instructions survive compaction (the C2/D12 fix) | **VERIFIED** §1.6.7 |

**Gate:** S2, S7, S8 answered; S3's replacement spiked. If S7 shows the emitters cannot be
made iteration-safe cheaply, **stop and re-open the seam decision in §2.2** — do not
proceed to Phase 3 on hope.

## 6.1 Phase 1 — compaction, on its own

Ships the fix for `plans/agent-loop-hardening.md` §1 (HIGH) with no goal code in the tree.

**Modified:** `pyproject.toml` (+`pydantic-ai-harness==0.4.0`, `uv lock`); `api/main.py`
(one `warnings.filterwarnings` for `HarnessExperimentalWarning`); `config/settings.py`
(the three `compaction_*` knobs); `app/agent_node.py` (add `ClearToolResults(...)` to the
existing `capabilities=[PlanReminder(plan_state)]`, ~3 lines); `domain/events.py`
(`StepKind += "compaction"`); frontend `api/chat/types.ts` and `api/chat/sse.ts` (**the `"compaction"` StepKind only** —
the goal wire types land in Phase 4), **`ToolWidgets.tsx` (dispatch branch)**,
`GoalBeat.tsx` (the compaction row, built here).

**One test that earns its place:** a long synthetic history shrinks across a real
tool-calling run with **zero orphaned `tool_call_id`s**. That is the provider-4xx risk and
exactly the "gnarly enough that a test is the fastest way to trust it" case.

**Gate:** routine pytest, `ruff`/`mypy`, and one live session long enough to trip the
trigger with the beat visible.

## 6.2 Phase 2 — `domain/goal.py` + the judge

**New:** `domain/goal.py` (<200 lines, stdlib+pydantic only per ADR 0017) —
`GoalCriterion`, `CriterionVerdict`, `GoalVerdict`, `GoalStatus` (the §2.6 literal),
`GoalLedger`, `decide_terminal_status`, `is_stalled`, `validate_evidence_ids`,
`compute_checked`.

- **`GoalStepDetail` is NOT here** — it is a wire payload and ships with `domain/events.py`
  in Phase 3, beside `StepKind`/`GoalPhase`/`GoalCriterionView`.
- **`GoalLedger`** is the mutable spend record `GoalLoopController` carries (requests,
  tokens, cost, elapsed). `GoalStepDetail`'s flat ledger fields are populated *from* it at
  emit time — one source of truth, flattened only at the wire boundary because
  `GoalStepDetail` must stay msgpack-plain.
- **`decide_terminal_status` vs `GoalLoopController.decide`**: the pure function in
  `domain/` maps *(verdict, ledger, limits, stalled, cancelled)* → `GoalStatus`, and is what
  every terminal-state test in this phase targets. `decide()` in `app/goal_loop.py`
  (Phase 3) is the stateful wrapper that tracks iteration/stall/error counts and calls it.
  **There is no second copy of the decision logic.**
`app/goal_judge.py` (<250 lines) — `derive_criteria()`, `judge_goal()`, bounded evidence
assembly (§3.3), retry/`stopped_check_failed` handling (§3.7).
`config/assets/prompts/goal_judge.md`, `goal_criteria.md`. `evals/goal_judge/` (30+ labeled).

**Modified:** `config/settings.py` (goal knobs), `app/model_selection.py` (judge/criteria
model through the ADR 0011 seam), `config/assets/prompts/README.md`.

**Tests — hard, honesty-critical:** all six terminal states (§2.6's `GoalStatus`), including
budget-exhausted-with-all-met (**achieved** — a limit that fires after every criterion
is met is still an achievement) and budget-exhausted-with-one-unmet (**stopped_budget**,
never achieved — C3); judge-failure → **stopped_check_failed**; `is_stalled` including criteria-repeat-but-plan-changed
(not stalled); `GoalVerdict.met` derived and not settable; `unknown` outcome is not met;
**no evidence is not met and is `checked=False`** (C9); a `reason` citing invalid
`step_id`s does not support `met=True` (C10); evidence bounding never starves a criterion
of evidence a prior verdict had already cited.

**Eval gate — the one that matters most:** judge TPR and TNR scored **separately** on the
held-out split, >90% agreement, false-positive rate reported explicitly; **and** the
criteria step graded against §3.2's three constraints, with a specific check that no
criterion claims coverage Counselle cannot observe (C11). A rubber-stamping judge makes
every other honesty guarantee in this document decorative.

## 6.3 Phase 3 — the loop

**New:** `app/goal_loop.py` (<250 lines), `config/assets/prompts/goal_mode.md`.

**Modified:**
- `app/steps.py` — `EmissionRouter.begin_iteration()` (C7). **Counter NOT reset.**
- `app/agent_node.py` — `_FinalContentPlacementWriter.begin_iteration()`; extract
  `_run_once(...)` from `:1002-1101` **minus both `_record_uninjected_steers` calls**
  (`:1040`, `:1101`), which move to their single post-loop call site (§2.8); restructure `async with (agent, agent.iter(...))`
  into one outer + N inner; the iteration loop; shared `RunUsage`; goal-mode limits,
  capabilities, model (D15), and `output_type=[str]` (C8/D13); `write_plan` always mounted
  (both clauses of `:860-863`); goal step emission; the second tool-less wrap-up `Agent`;
  `try/finally` for cancellation. Also correct the stale MCP comment at `:1005`.
- `domain/events.py` — `StepKind += "goal"`, `GoalPhase`, `GoalCriterionView`,
  `GoalStepDetail`, `StepDetail.goal`.
- `app/prompt.py` — `render_goal_mode(statement, criteria)`.
- `app/turns.py` — `goal_mode` on `_Turn`; `start()` signature (`:353-367`); timeout
  selection in **both** `_drive` (`:762`) and `_drive_continuation` (`:840`);
  `goal_max_concurrent_turns` alongside the existing cap (`:415-416`);
  `start_continuation` rejects a goal turn (C8).
- `app/run_turn.py` — `goal_mode` into `turn_ids` at **both** construction sites and both
  branch reassignments (`:894-895`).
- `api/routes/sessions.py` — `MessageBody.goal_mode`.
- `config/settings.py` — `goal_max_concurrent_turns`.

**`app/usage.py` is NOT modified** (§2.11 — there is no bug).

**Honest budget (C6):** ~150–250 net new lines across `app/agent_node.py` and
`app/steps.py`. If it materially exceeds that, stop and split the file in its own branch
rather than absorbing it here.

**Tests:** cumulative usage regression (asserting existing behavior, §2.11); a cancelled
goal turn persists its ledger and lands `stopped_user`; two iterations produce monotonic,
non-colliding `step_id`s through `build_segments` (the C7 corruption guard); **the ledger
renders at zero** — a goal run that made no workspace changes still emits its ledger line
rather than omitting it (§7.3 gate 3).

**Gate:** a goal turn runs end to end against a live model; `curl` on the SSE stream shows
`step` events of `kind:"goal"` with all three `phase` values and the ledger. S8's
measurements recorded and §2.10's defaults locked against them. No frontend yet.

## 6.4 Phase 4 — frontend wire types + slash trigger

*(The backend field `MessageBody.goal_mode` ships in Phase 3; this phase is the client half.)*

**New:** `features/slash-command/{slash-query.ts,useSlashCommand.ts,SlashCommandMenu.tsx}`
+ colocated tests.
**Modified:** `api/chat/types.ts` and `api/chat/sse.ts` (**the goal types** — `GoalPhase`,
`GoalCriterionView`, `GoalStepDetail`, the `"goal"` StepKind; the compaction kind already
landed in Phase 1), `api/chat/transport.ts`,
`ChatComposer.tsx`, `AiComposer.tsx`, `useComposerStartTurn.ts`.

**Tests:** trigger fires at position 0 only; does not fire on `and/or`; keydown ordering
(slash → skill → submit); token removal; **chip clears on empty composer and on send**;
**typing `/goal` without selecting does not arm goal mode** (§5.5).

**Gate:** `npm run typecheck && npm test`. A `/goal` message reaches the backend with
`goal_mode: true` and streams — rendering as ordinary beats, which is already honest.

## 6.5 Phase 5 — goal rendering

**New:** `GoalHeader.tsx`, `GoalVerdictCard.tsx`, `goal-a11y.test.tsx`.
**Modified:** `GoalBeat.tsx` (extend from Phase 1), `activity-trace-helpers.ts`
(`latestGoalStep()` with the `kind === "goal" && detail.goal != null` guard, **and an
`isInterruptedGoal(message, liveMessageId)` helper** — §5.3's crash rule gates on "not the
actively-streaming turn", not on a `turnStatus` allowlist, because a persisted replay of a
crashed run lands on `"idle"` and would otherwise render a live spinner forever), **`ToolWidgets.tsx` (the `goal`
dispatch branch — the edit revision 1 omitted)**, `ChatMessage.tsx` (phase-based
suppression at the `SegmentBeat` site, `:213`; header above `PlanChecklist`; card in the
settled slot), `features/dev-tool-call-gallery/` (nine fixtures: the six `GoalStatus` values, `running`,
the criteria-loading skeleton, and the **no-`phase="final"` "Stopped — interrupted"** state
from §5.3. Criteria-derivation failure is the `stopped_check_failed` fixture, not a tenth).

**Gate:** the dev gallery renders all nine fixtures **at 1440px and at 390px**; typecheck
and tests green.

## 6.6 Phase 6 — live verification and docs

Run §7.4's acceptance script in a **real browser**. Then:

- `docs/ARCHITECTURE.md` — goal mode, the judge, compaction.
- `docs/adr/00XX-goal-mode.md` — **required.** Records D1–D15, the ADR 0013 posture, the
  explicit statement that the judge is **not** an output validator (D5), the C11 scope
  rule, and the note that PydanticAI 2.x would unlock the rest of the harness (§1.6.2).
- `docs/adr/README.md`; `AGENTS.md` (status, tool inventory, settings); `DESIGN.md` (the
  goal status vocabulary).
- `plans/agent-loop-hardening.md` — mark §1 closed by Phase 1, §3 closed by Phase 3, and
  leave §2 (`tool_result_store` eviction) **explicitly open**.
- `specs/README.md:31` — fix the stale "implementation not started" line (§1.8).
- `TODOS.md` — §8's deferred items.

**Graduation:** `plans/goal-mode-plan.md` → `specs/goal-mode/` **only after owner
acceptance**, per the planning-workflow rule. Not on merge, not on "tests pass".

## 6.7 Phase 7 — dogfood before hardening (NEW, and it may end the project)

The product review's sharpest finding is that this plan is engineering-complete and
product-unvalidated: no real student's raw goal statement appears anywhere in it. Before
any further investment, run **10 real goal statements collected from actual students**
(not written by us) through the shipped Phases 1–6 and record, per statement: did the
criteria step produce something the student recognizes as their goal; what did it have to
mark "not checked"; the real cost; and whether the student would use it again.

**This is a real gate.** If most statements decompose into vacuous or out-of-scope
criteria, the right answer is §9's option (c) — a fast read-only "what's incomplete across
my workspace" pass — not more judge tuning.

## 6.8 Phase 8 — bulk-undo follow-up (optional, own branch)

Every workspace change a goal run makes is already in that turn's emitted mutation
receipts, so "show me everything this goal changed" needs **no schema change**. Bulk
*undo* would. Deferred, recorded so Phase 3 does not foreclose it.
---

# Part 7 — risks, honesty gates, and acceptance

## 7.1 Risk register

| # | Risk | Severity | Mitigation |
|---|---|---|---|
| R1 | **The judge rubber-stamps** — declares a goal achieved that is not. | **CRITICAL** | Separate call, evidence-only, no self-report (§3.3); binary per-criterion with cited `step_id`s validated in code (C10); derived overall verdict; TPR/TNR scored separately with the false-positive rate reported (§3.8); >90% agreement gate. |
| R2 | **A cheap-tier judge is the kind most vulnerable to verbosity gaming.** MT-Bench's repetitive-list attack fooled Claude-v1 and GPT-3.5 **91.3%** of the time but GPT-4 only **8.7%** — i.e. the weaker the judge, the more a padded, content-free answer passes. D15 puts the judge on `model_cheap`. | **CRITICAL** | The judge prompt explicitly instructs ignoring length/fluency/confidence; **Phase 2's eval must include padded-but-empty adversarial cases specifically**; and §9(b) puts "judge on a stronger tier than the agent" to the owner as a live decision. This is the one place where the cheap-tier default is actively argued against by the research. |
| R3 | **Cost.** Revision 1's numbers were off by ~20×. | **HIGH** | Cost is now the primary budget, checked on a projection before each iteration (D14); the agent runs on the cheap tier by default (D15); `goal_compaction_target_tokens` is held below the 200k price cliff; judge/criteria spend is inside the ledger (D6); Phase 0 S8 measures a real run and locks the defaults; Phase 6 reports three measured runs. |
| R4 | **Unattended workspace writes.** 29 mutation tools, no approval gate. | **HIGH** | Receipts on every write; the closing card enumerates them; criteria visible from second one; Stop loses nothing. **§7.2 — the plan's weakest point, and §9(a) puts it to the owner.** |
| R5 | **Compaction loses the thread.** | HIGH | Cheap tiers first; the goal statement and criteria live in `instructions`, which compaction cannot touch (D12, VERIFIED §1.6.7); `incremental=True`; an 8k raw tail; and `prepare` rebuilds temporal/student/data context from source every turn regardless. |
| R6 | **An orphaned tool pair** → provider 4xx mid-run. | HIGH | Library-owned pair-safe cutoff, VERIFIED §1.6.4; Phase 1's zero-orphans test. |
| R7 | **Bad criteria** make the gate meaningless, or worse, overclaim real-world readiness. | **HIGH** | §3.2's three constraints incl. the C11 observability rule; criteria graded in Phase 2's eval; the mandatory "Not checked" line; criteria shown to the student before the first tool call. |
| R8 | **The emitters are one-shot** and the loop corrupts the stream or the record. | **HIGH** | C7's `begin_iteration()` with a deliberately non-reset counter; Phase 0 S7 is a **blocking** spike; Phase 3 pins it with a `build_segments` test. |
| R9 | **Judge failure mid-run** leaves the run in the generic error path. | HIGH | C12 / §3.7 — retries, then `stopped_check_failed` with a real wrap-up. |
| R10 | **Process-wide capacity.** A 90-minute turn holds one of 50 global slots and a share of the 256 MiB shared ring-buffer budget, able to evict *other students'* turns. | **HIGH** | §2.12 — `goal_max_concurrent_turns` (default 5) checked alongside the existing cap. |
| R11 | `pydantic-ai-harness` is Alpha/experimental. | MEDIUM | Exact `==0.4.0` pin; no wrapper (ADR 0017); usage confined to one `capabilities=[...]` list; Phase 1's test catches a behavior change. **Dependency resolution independently verified by live `uv add`.** |
| R12 | Pinned at 0.4.0 without a PydanticAI 2.x upgrade. | MEDIUM | Accepted, recorded in the ADR; we are already frozen on 1.x. |
| R13 | `app/agent_node.py` grows past its already-over-limit 1,191 lines. | MEDIUM | C6's revised ~150–250-line budget, with the decision logic in `goal_loop.py`/`domain/goal.py`; overrun means splitting the file in its own branch. |
| R14 | **Turn-record growth.** Compaction bounds `messages`, not `turn_records`' step arrays. | MEDIUM | §2.12; Phase 0 S8 measures a real JSONB size; the fix if needed is a persisted-step cap, not more compaction. |
| R15 | **Monthly cost per student**, not just per run. A student plausibly runs `/goal` at each application round. | MEDIUM | Phase 7's dogfood records runs-per-student; §9(d) sets a per-user monthly ceiling if needed. Revision 1 measured only per-run cost, which is not the number that decides viability. |
| R16 | Goal mode fights `counselor.md`'s planning minimalism. | MEDIUM | The prompt block names the overridden sections (§2.9); acceptance checks a visible plan appears. |
| R17 | A goal turn holds the session's single-flight slot. | MEDIUM | True of any long turn; steering exists; Stop is immediate. Documented. |
| R18 | **jsdom passes, the browser fails** — this repo's documented recurring failure mode. | MEDIUM | §7.4 is a real-browser gate, non-optional, and now includes a scale check. |
| R19 | `tool_result_store` non-eviction, amplified within one goal turn. | MEDIUM | Out of scope (§8) but named as the feature most likely to surface it first; S8 measures it. |

## 7.2 R4, stated plainly

A goal run can call any of the 29 workspace mutation tools, repeatedly, for up to an hour,
without a human approving anything. Defences: criteria on screen within seconds; a typed
receipt per write; the closing card enumerates every change; Stop is one click and
suspends without losing anything; tasks already have an undo path. What does **not** exist
is a single "undo this entire goal run".

Three options:

1. **Ship as planned.** Blast radius is the student's own workspace; changes are
   individually visible and reversible; Counselle cannot submit an application or contact
   anyone. Annoying, not destructive.
2. **Read-only goal mode in v1.** Safest; guts the feature, since the useful goals are
   writes.
3. **Approval gate** — approve the criteria and a rough action plan once, not every write.

Revision 1 recommended (1) and dismissed (3) as "a real subsystem". The product review
pushed back hard and it is right that for an anxious, high-stakes user, *"an AI touched my
essay list and deadlines for an hour while I wasn't watching"* is a trust problem
independent of whether anything broke. **This is now an explicit owner decision, §9(a)**,
and the honest note is that (3) is a *lighter* touch than revision 1 implied: approving the
already-derived criteria is one confirmation on data the student is already being shown.

## 7.3 The honesty gates — and how each is actually enforced

Revision 2's first draft called these "each testable", which overstated it: a prompt
instruction and a type-level invariant are not the same guarantee, and pretending they are
is its own small dishonesty. Each gate is therefore labelled by its real enforcement:
**[S] structural** (the code or the type makes the bad state unrepresentable),
**[E] eval-enforced** (a model behaviour measured by the Phase 2 eval, not guaranteed), or
**[C] copy discipline** (a rule a reviewer must uphold; no mechanism).

1. **[S]** A budget-exhausted run with any unmet criterion renders **stopped_budget**, never Achieved
   (C3). *Unit-tested.*
2. **[S]** The verdict card renders from the judge's typed output plus the code-owned ledger,
   **never from model prose**. *Structural.*
3. **[S]** The ledger is honest at zero as loudly as at N — a run that made no workspace changes
   says so rather than omitting the line.
4. **[S]** A criterion whose every cited receipt has `mutation.outcome == "unknown"` is forced **not met** by the loop (§3.4), not by the judge's prompt. *Unit-tested.*
5. **[S]** **A criterion with no evidence is `checked=False`** — computed by the loop from the bundle it assembled, never self-reported by the judge (§3.4) — (C9), and the card
   shows `◌ not checked`, not `✗`. *Unit-tested.*
6. **[S]** **A judge `reason` citing no valid `step_id` cannot support `met=True`** (C10).
   *Unit-tested.* The evidence bundle is persisted with the verdict.
7. **[S]** **The "Not checked" line is mandatory** — `not_checked_note` is a required field with a code-owned fallback, so no branch can skip it (§3.2) — whenever the stated goal is broader than the
   criteria (C11). "Achieved" never means "your applications are fine".
8. **[S]** for the disclosure (a distinct `StepKind`, always emitted); **[C]** for "never in the model's prose" — that is a prompt instruction with no code check, and it is labelled as such rather than implied to be enforced.
9. **[S]** The goal statement and criteria survive every compaction — they live in `instructions`, outside `messages` (D12). *VERIFIED §1.6.7.*
10. **[S]** The judge never gates, rewrites, or suppresses agent prose (D5): its output type has no field capable of it, and the loop never routes verdict data back into the agent's messages.
11. **[S] by construction**, not a gate in its own right: `app/plan_tool.py` is zero-diff (C1), so its completion-honesty docstring is untouched. Listed for completeness, not as something Phase 2 tests.
12. **[S]** The run never implies durability it does not have. A crash loses the run (§2.8); the header renders **Stopped — interrupted** rather than a frozen "Working", per §5.3's no-final-step rule. *Acceptance-tested (§7.4-I).*

## 7.4 Live acceptance script

Real build, real browser. Capture to `artifacts/goal-mode/acceptance/`.

**A — happy path.** `/goal make sure every school on my list has a deadline and a
why-this-school note`, on an account with 4+ schools, some incomplete.
1. `/` opens at position 0 only; typing `and/or` mid-sentence does not open it.
2. Typing `/goal` without selecting from the menu sends an ordinary message (§5.5).
3. Selecting shows the Goal chip; the statement sends with `goal_mode: true`.
4. The header appears with its skeleton, then 2–6 binary criteria, **before** the first
   tool beat.
5. `PlanChecklist` appears and its items change state.
6. At least one `goal` check beat lands mid-run, in stream order, naming unmet criteria.
   **Multiple rounds produce multiple stacked beats** (the distinct-`step_id` guarantee).
7. On completion the card fades in **below** the stream and **nothing above it moves** —
   diff the last streaming frame against the settled frame; only permitted deltas are
   cursor gone, remaining text present, card + sources + actions appended.
8. A thinking row expanded mid-run is still expanded after completion.
9. **The header and the card show the same status** — no "Working" above "Achieved".
10. Reload: identical stream, header, and card.
11. The card's change list matches actual workspace state, and the **"Not checked"** line
    is present and accurate.

**B — partial / budget.** Set `goal_max_iterations=2`.
1. Terminal state **Partial**, `warning` badge, headline names the limit.
2. Unmet reasons visible **without a click**; never-attempted criteria show `◌ not checked`,
   not `✗`.
3. The final text is a real wrap-up — done / remaining / never checked / next — not a
   canned string.
4. **No tool call occurs in the wrap-up turn** (the second tool-less `Agent`).

**C — stop.** Every beat stays; card reads *Stopped — you stopped it*, neutral badge; the
next message continues with the tool work in context.

**D — steering.** A mid-run message appears inline and is injected; the run does not
restart; criteria do not change; **scroll does not re-anchor** (§5.8).

**E — compaction.** Force a low target. The beat appears; the run stays coherent; no
completed criterion is redone; the prose never mentions compaction.

**F — no progress.** A goal with an uncheckable criterion → two stalled rounds →
**Stopped — no progress**.

**G — judge failure.** Point `model_goal_judge` at an unreachable model →
**Stopped — couldn't check**, with prior work intact and a real wrap-up. Never the generic
error path.

**H — cost.** Record measured cost and wall clock for A, B, E. **If A exceeds
`goal_max_cost_usd`, §2.10's defaults are wrong and must be retuned before ship.**

**I — crash.** Kill the server mid-run (SIGKILL, so no cleanup runs). On reload the
student sees **Stopped — interrupted** (§5.3's no-final-step rule). Verify **all three**
paths in §5.3's table — stream errored, reattach found nothing, and a **fresh page load**
replaying the persisted transcript — because they land on three different `turnStatus`
values and the reload path is the one a student actually hits. Every beat that streamed is
still present — not a stuck "Working" spinner, and not a false success. The run
itself is genuinely lost (§2.8); this test verifies the *reporting* is honest, not that the
run recovers.

**J — scale.** A run producing 100+ beats: the reducer and `ChatMessage` stay responsive,
scroll behaves, and the turn-record JSONB size is recorded.

**K — accessibility.** Keyboard-only through the slash menu; the screen reader announces
check beats and does **not** spam on header updates; **390px with six criteria and two
unmet reasons** — no overflow, header collapses per §5.8.

**Definition of done:** A–K pass in a real browser, Phase 2's eval gate holds (TPR/TNR
separately, plus the adversarial padded-answer cases from R2), routine tests and
`ruff`/`mypy` clean, the ADR exists, and measured cost is inside budget.

---

# Part 8 — non-goals, recorded so they are not re-litigated

- **Sub-agents / delegation.** `experimental/subagents` is in 0.4.0 and now reachable
  without a PydanticAI 2.x upgrade. Out of scope: the single-threaded loop is the correct
  shape first.
- **Durable, crash-proof goal runs.** `experimental/step_persistence` likewise. §2.8 states
  the current guarantee honestly instead.
- **A goals list page / `counselle.goal_runs` table.** D8.
- **Bulk undo of a goal run.** §6.8.
- **Multiple slash commands.** The trigger layer is general; v1 ships exactly `/goal`.
- **Re-deriving criteria after a steer.** §2.8 — moving goalposts make a verdict meaningless.
- **Clarify inside a goal run.** C8/D13 — assumptions are stated, not asked.
- **A domain-specific `summary_prompt`.** §4.3 — deferred until real traces exist.
- **Fixing `tool_result_store` eviction.** Real, related, out of scope, stays open.
- **Merging the two composers**, **splitting `app/agent_node.py`**. Both are refactors and
  get their own branches (C6).
- **An output validator.** D5. Not deferred — **forbidden.**

---

# Part 9 — open decisions the owner must make

(a), (b), (d) and (e) are needed **before Phase 2**. **(c) is different**: it is the very
question Phase 7 exists to answer empirically, and the plan deliberately places that after
the build — see (c) for why, and for the cheaper way to ask it first.

These are not implementation details and the plan deliberately does not pick for you.

**(a) The approval gate (R4/§7.2).** Ship unattended writes, or add a one-time
"these are the criteria, go ahead" confirmation? The plan ships unattended (D9) but the
product review argues the trust cost is higher than the engineering cost, and the gate is
lighter than revision 1 implied.

**(b) Which model judges (R2).** The plan defaults the judge to `model_cheap` for cost —
but MT-Bench shows exactly that class of model failing the padded-answer attack 91.3% of
the time while a strong model resisted at 8.7%. Running the judge one tier above the agent
inverts the usual cost logic and is probably right for the one component whose failure is
"lie to a student". Decide explicitly.

**(c) Whether `/goal` is the right shape at all (Phase 7).** The product review's position
is that a fast, read-only **"what's incomplete across my workspace"** pass delivers most of
the value at a fraction of the cost and risk, and that no real student's goal statement has
ever been tested against this design. Phase 7 is the cheap way to find out; it is placed
*after* the build deliberately, but it could equally run first against today's chat with a
prompt tweak and no new machinery. **If the answer is (c), most of Parts 2–4 should not be
built.**

**(d) Cost ceiling per student per month (R15)**, not just per run.

**(e) The agent's model tier (D15).** Cheap tier keeps a run near $1.20; the counselor tier
puts the same work near $6–8. This is a quality-for-cost trade on the student-facing work
itself, and it is the single biggest lever on whether this feature is affordable.
