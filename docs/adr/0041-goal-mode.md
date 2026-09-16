# ADR 0041 — Goal mode: an independent-judge iteration loop inside the agent node

**Status:** Proposed / Draft — engineering-complete, product-unvalidated (see Consequences)

## Context

Counselle's counselor agent stops when the model decides it is done — the same pattern
Claude Code, Codex, and OpenCode all use, gated on the model's own claim, a prompt
convention, or a provider `finish` reason. That is acceptable for a coding agent whose
user reads a diff before trusting it. It is not acceptable for a student who asks
Counselle to *keep working on something* — "make sure every school on my list has a
deadline and a why-this-school note" — and would otherwise have no way to know whether
"done" meant done or meant the model got tired.

This repo has already been burned by exactly this failure mode: the essay AI panel
shipped an agent caught "claiming 'I have proposed a suggestion' on a turn where it made
no tool call" (`AGENTS.md` Status). Goal mode is that failure mode with a budget
attached — an agent repeatedly asked "are you done yet?", with an obvious escape hatch —
so the design question was never "should there be a loop" but "what stops the agent from
grading its own homework".

`plans/goal-mode-plan.md` is the full design record (ten parts, a five-lens adversarial
review that found sixteen defects in its own first draft — see its §0.4 — and the
Part 0 corrections C1–C12 that fixed them). This ADR records the decisions that will
outlive that plan once it is either graduated or abandoned.

## Decision

**D1 — the loop lives inside the agent node**, as an outer iteration around
`agent.iter()`, driven by `app/goal_loop.py`. Not an outer orchestrator around
`TurnRegistry.start` (would produce N assistant messages for one goal, breaking "the run
is the message" — ADR 0028), not a new LangGraph node (four subsystems assume one agent
execution per turn), not a `check_goal` tool the model calls (a gate the model can
decline to call is not a gate). `app/graph.py` stays `prepare → agent → END`, zero diff.

**D2 — one goal run = one turn = one assistant message = one SSE stream**, with one
`meta`, one `done`, one turn record — consistent with ADR 0028's turn model.

**D3 — compaction is a pinned dependency, `pydantic-ai-harness==0.4.0`**, not
hand-rolled or ported. It is the same MIT harness `app/plan_tool.py` and
`app/tool_overflow.py` are already ports from (Principle 2, "never reinvent the
wheel"), the pair-safety logic (tool-call/tool-return survival across every edit) is the
hard part and it is already correct there, and `0.4.0` is the last release running on
PydanticAI 1.x — the version this repo is pinned to. No wrapper module: per ADR 0017
("use the stack's native seams, never wrap them"), the capabilities are constructed
directly in the agent node's capability list from Settings values.

**D4 — the judge is a separate agent: separate prompt, cheap model by default, typed
output, blind to the agent's self-report.** It never reads the agent's narration as a
claim of success.

**D5 — the judge is a loop-control gate, and it is explicitly NOT an output
validator.** `AGENTS.md` is unambiguous that this repo "removed its programmatic
answer-validation layers on purpose" and that "**No output validator was added and none
may be**." The judge does not violate that line, and the distinction is load-bearing
enough that it is stated in three places so nobody later "improves" it into one: in
`app/goal_judge.py`'s own module docstring, in the prompt asset
(`config/assets/prompts/goal_judge.md`), and here. Concretely: the judge's *only*
effects are the loop's stop/continue decision and the rendered verdict card. It never
rewrites, blocks, suppresses, re-generates, or gates the agent's prose — every word the
agent streamed stays on screen regardless of the verdict, exactly as if the judge did
not exist. It is the same category of thing as `UsageLimits`: a control over whether to
keep spending, never a censor between the model and the student.

**D6 — one shared `RunUsage`** is threaded into every `agent.iter(usage=...)` call in a
goal turn, *and into `derive_criteria`/`judge_goal`*, so the judge's and the criteria
call's spend counts against the run's ledger instead of being invisible to it.

**D7 — no new event type, no protocol bump.** Goal and compaction beats ride the
existing `step` event as new `StepKind`s (`"goal"`, `"compaction"`), with a `phase`
discriminator (`criteria` | `check` | `final`) on the detail payload.
`domain/events.py`'s `PROTOCOL_VERSION` stays `1`; this is additive, and `ev_step`
already drops `None` detail fields, so old clients ignore the new payload.

**D8 — no new table, no migration.** Nothing about a goal run is persisted anywhere
`turn_records` doesn't already reach.

**D9 — no approval gate in v1**, but the derived criteria are shown to the student
before the first tool call, and the run is Stop-able from that instant. Whether this is
right is Part 9's open decision (a) — see Consequences.

**D10 — goal mode is a harness mode, not a skill and not a `response_mode`.** Wire field
`goal_mode: bool` on `MessageBody`. It changes budgets, mounts the judge, and enables the
summarizing compaction tier — a skill does none of those (`app/skills.py`), and
`response_mode` only ever picks a model/skill pairing (ADR 0034).

**D11 — the cheap compaction tier (`ClearToolResults`) is mounted on every turn**,
goal or not; only the escalating summarizing tier is goal-only. This closes
`plans/agent-loop-hardening.md` §1 (rated HIGH independently of this feature) as a side
effect rather than a special case — see Consequences.

The goal-only tier is a `TieredCompaction` over the cheap pass and a
`SummarizingCompaction` with `model=None`, so the summary **inherits the running agent's
model** — already the cheap tier on a goal turn (D15) — rather than re-resolving a model
setting, which would bypass the Vertex client that is ADR 0011's only seam. Its usage
folds into the turn's shared `RunUsage`, so summary tokens are priced in the agent's slice
and its request counts against `goal_max_model_requests`: a summary is a real request and
the ledger reports it. Both tiers emit a `kind:"compaction"` beat under distinct labels
(C4) — a model-written summary of earlier turns is disclosed as that, not as blanked tool
results. A summarization **failure degrades rather than aborts**: it is logged, the
un-summarized history is used, and no beat is emitted, because a long unattended run must
not die over an optional cost optimisation and a compaction that did not happen must never
be claimed. There is one headroom knob, `goal_compaction_target_tokens`; the plan's
mooted `goal_compaction_reserve_tokens` had no binding in the library and was only ever
equivalent to lowering that number, so it does not ship.

**D12 — the goal statement and frozen criteria are pinned in the agent's
`instructions`**, computed once at `Agent(...)` construction, never rebuilt per
iteration. This is a correction (C2) of the plan's own first draft, which claimed the
statement was "literally `messages[0]`" and therefore protected by
`preserve_first_user_message` — false, because `TurnState["messages"]` is the whole
session's history and, for a `/goal` sent mid-conversation, index 0 is an unrelated
older message. `instructions` lives outside `messages`, is re-sent with every request,
and no compaction strategy can touch it — verified live in the plan's Phase 0 spike (a
40-message history compacted to 3 messages, instructions returned byte-identical).
`preserve_first_user_message=True` stays on as defence in depth, but it is no longer the
guarantee.

**D13 — a goal turn does not mount `ask_student`.** `output_type=[str]`, the same as an
existing continuation turn, so a goal run can never emit a `ClarifyDraftV2` and park
itself on a second HTTP turn — which would silently reintroduce the multi-message seam
D1 rejects. Genuine ambiguity becomes a stated assumption recorded against the
criterion, not a question. `start_continuation` also rejects a goal turn as
belt-and-braces (structurally unreachable given `output_type=[str]`, but the rejection
means a future change to `output_type` can't silently resurrect the path).

**D14 — cost is the primary budget, checked as a projection before each iteration**,
not only after the fact via the library's token/request limits. Token and request caps
are *derived* from the cost cap on the configured model, not set independently — the
plan's own first draft set a token cap and a cost cap that were mutually impossible on
this repo's price table (a 6M-token cap floor-costing $9.00 against a stated $2.00 cap).
The cost cap is honestly documented as **soft**: `UsageLimits` understands requests and
tokens, not dollars, so a single unusually expensive iteration can overshoot the
projection before the next checkpoint fires. Only `goal_max_model_requests` and
`goal_max_total_tokens` are hard, library-enforced ceilings.

**D15 — goal turns run on the cheap model tier (`model_cheap`) by default**, not the
counselor tier. This is an explicit, deliberate quality/cost trade — not something
inherited by accident — and it is Part 9's open decision (e); see Consequences.

## The C11 scope rule

The plan's adversarial review found its own flagship example — "get my UC applications
ready to submit" decomposing into four workspace checks and then rendering a green
**Achieved** card — to be the exact lie-to-a-student failure this repo exists to avoid.
Counselle has no visibility into the UC portal, transcripts, test-score sends, or
recommendation letters, so it cannot know whether anything is "ready to submit" in the
sense the student meant.

Binding consequences, enforced in code, not merely in the criteria prompt's wording:

1. A criterion must be **checkable from workspace state or a produced artifact** —
   something a tool receipt can evidence. The criteria prompt rejects anything broader.
2. The closing card always carries a `not_checked_note` — **required** in the criteria
   call's typed output (not nullable), so an omission is a pydantic validation error the
   library retries like any other malformed output, and if it is still absent after
   retries the loop substitutes a code-owned default sentence. The field can never be
   `None`; there is no branch in the card that skips this line. "Achieved" means *these
   criteria are met*, in the student's sight — never *your applications are fine*.

The plan's flagship example is now "make sure every school on my list has a deadline and
a why-this-school note" — fully inside Counselle's observable reality.

Two further honesty corrections are structural, not prompt-level, and belong beside C11:

- **C9 — absence of evidence is not met, and it is `checked=False`.** A criterion the
  judge never got a receipt for is "not checked", never silently scored as failed *or*
  passed. `domain/goal.py::compute_checked` derives this from citations, not from asking
  the judge whether it checked something.
- **C10 — the judge's own prose is not evidence either.** Every verdict cites
  `evidence_step_ids`; those ids are validated in code against the evidence bundle
  actually sent, and a `reason` citing no valid id renders as an unsupported note, never
  as the sole basis for `met=True`. The evidence bundle is persisted with the verdict so
  a wrong reason is detectable after the fact.

## ADR 0013 posture

ADR 0013's rule is "unmounted, not hidden" — gating happens in code at tool-construction
time, never in the prompt. Goal mode adds no exception to this: `output_type=[str]`
(D13) is a construction-time choice, the judge and criteria agents are separate,
tool-less-or-narrowly-tooled `Agent` instances built explicitly for their one call, and
the wrap-up run (§2.7 of the plan) uses a second, genuinely tool-less `Agent` rather than
an empty `toolsets=` argument — the plan's first draft got this wrong too:
`Agent.iter`'s `toolsets` parameter is documented as *additive*
("optional **additional** toolsets"), so passing `toolsets=[]` would not have disabled
anything already mounted. Building a second `Agent` with no tools at all is what makes
"no tool calls" structural rather than merely requested.

Separately, this feature's Phase 3 corrected a comment at `app/agent_node.py` claiming
the per-run context "enters the MCP toolset for the run" — stale since ADR 0038 deleted
the `counselle-db` MCP server entirely; there is no MCP toolset on any surface any more.

## PydanticAI 2.x

`pydantic-ai-harness==0.4.0` also ships `experimental/step_persistence` and
`experimental/subagents` — the two prerequisites
`specs/agent-mode/plan/agent-mode-architecture-plan.md` names as blockers for durable,
crash-proof long jobs and for delegation. Both are explicitly out of scope for goal mode
(Part 8 of the plan: "durable, crash-proof goal runs" and "sub-agents / delegation" are
recorded non-goals), but worth noting here because it corrects an assumption in that
other plan: these are reachable **today**, without the PydanticAI 2.x upgrade that plan
assumed was required, once this repo is already depending on the harness package for
compaction. A future step-persistence or sub-agent feature is a smaller lift than
previously scoped.

## Rationale

Neither Claude Code, Codex, nor OpenCode has an independent judge; all three trust the
agent's own claim of completion, which is fine for a system whose user reviews the
output before acting on it. A goal run here is unattended by design (D9) — the student
is not reading every tool call — so the "agent decides it is done" pattern is exactly
the shape of failure this repo's honesty principle forbids. A separate call that never
sees the agent's self-report, grading structurally-typed evidence rather than prose, is
the smallest change that closes that gap without becoming the output validator this repo
has explicitly forbidden (D5).

Riding the existing `step` event (D7) rather than adding a new `EventType` avoids a
five-subsystem change (a new `Emission` variant, a new segment kind, a new persisted/
replay path, a `TurnRegistry._observe` branch, a frontend parser case) for a beat that is
structurally identical to every other tool-work beat already on the wire.

## Alternatives

See `plans/goal-mode-plan.md` §2.2 for the full four-seam comparison (outer orchestrator,
new LangGraph node, model-callable `check_goal` tool, inside the agent node) and §4.1 for
the compaction alternative (porting ~1,000 lines of `experimental/compaction/` into
`app/`, rejected as owning pair-safety logic forever for no gain over pinning the
library it already lives in).

## Consequences

**This is genuinely proposed, not accepted, and for reasons beyond the usual review
cycle.** Phases 0–5 of the plan are implemented — `domain/goal.py`, `app/goal_judge.py`,
`app/goal_loop.py`, the agent-node integration, the frontend surfaces — but the plan's
own Phase 7 kill-gate has **not** been run: no real student's raw goal statement has been
tested against this design. The plan says plainly that if most real statements
decompose into vacuous or out-of-scope criteria, "the right answer is §9's option (c)" —
a cheap, read-only "what's incomplete across my workspace" pass — "not more judge
tuning." Shipping this ADR as Accepted before that gate runs would be recording a
decision the plan itself says is not yet safe to treat as final. **Status stays
Proposed/Draft until Phase 7 runs and the owner decides `/goal` is the right shape.**

**Four of Part 9's open owner decisions were never made** — they were implemented at the
plan's stated defaults, each exposed as a `Settings` knob so the decision remains
reversible without a code change:

- **(a) the approval gate** — shipped unattended (D9), no confirmation step before the
  first tool call, though the product review in the plan argues the trust cost may be
  higher than the engineering cost of adding one.
- **(b) which model judges** — the judge runs on `model_cheap` (D15's default extended to
  the judge), which MT-Bench research cited in the plan argues against (a cheap-class
  judge failing a padded-answer attack 91.3% of the time in that literature, versus 8.7%
  for a strong model). Our own measured adversarial result did not reproduce that
  failure — see below — but the owner decision to run the judge one tier above the agent
  was never made either way.
- **(d) a cost ceiling per student per month** (as opposed to per run) — not set.
- **(e) the agent's model tier** — shipped on `model_cheap` (D15) rather than the
  counselor tier, a real quality-for-cost trade on the student-facing work itself.

**No real-browser verification happened.** The plan's §7.4 acceptance script calls for a
real-browser run of the full loop; Phase 5's own gate calls for the dev tool-call
gallery's nine goal-status fixtures rendered at 1440px and 390px. Neither happened — no
browser was available during this work. Everything on the frontend side is verified at
the jsdom/unit-test level only.

**The judge eval gate passed, but on thin evidence.** Phase 2's measured gate
(`evals/goal_judge/`, 32 hand-labeled cases / 34 scored criteria, synthetic and hand-
constructed — not drawn from real goal runs, since the loop didn't exist yet to produce
real traces) initially **failed**: TPR 0.882 then 0.824 across two unpinned runs on the
identical 32 cases, both times failing on the same root cause — the judge was
discounting the typed `outcome`/`field_key`/`value` fields on mutation receipts and
wanting free-text summaries to restate the criterion, plus genuine run-to-run
non-determinism from an unpinned sampling temperature. The fix (rewriting
`_receipt_text` to state the receipt's typed fact plainly, plus pinning
`temperature=0.0`) produced **TPR 1.000, TNR 1.000, FPR 0.000** on the same 32 cases,
6/6 correct on the adversarial (padding-attack) subset. That is **one clean run**. A
confirmation re-run under the same pinned settings was launched specifically to rule out
a lucky draw and **did not complete** before the session's time budget ran out — see
`evals/goal_judge/REPORT-20260916T160355Z.md`'s own closing section, which recommends a
second confirmation run before treating TPR=1.000 as a stable result. This is not
demonstrated long-run stability; it is a strong single measurement.

**S8's cost figures are a projection, not a measurement.** The loop did not exist yet
when the plan's Phase 0 cost spike ran, so `goal_max_cost_usd`/`goal_max_model_requests`
and the whole §2.10 budget table are derived from this repo's own price table applied to
hypothetical request/context-size combinations, not from a real goal run's logged spend.

**Every turn now carries `ClearToolResults`** (D11), closing
`plans/agent-loop-hardening.md` §1 (rated HIGH independently of goal mode) as a
side effect. §3 of that same document (an explicit persistence sentence in the
counselor prompt) is folded into goal mode's own prompt block. §2 of that document
(`tool_result_store` never evicting) remains **explicitly open** — goal mode is named in
the plan as the feature most likely to surface it first in production, but fixing it is
out of this scope.

**`app/agent_node.py` grew past its 800-line cap.** The plan's own C6 correction revised
Phase 3's line budget upward from a fictional "~40-line extraction" to an honest
"~150–250 net new lines"; actual net growth was roughly +485 lines against that revised
budget. This is tracked in `TODOS.md` with a concrete four-module split proposed for its
own branch, not attempted here — the plan states plainly that splitting the file is its
own branch, not something to fold into feature work.

**Adding a goal-adjacent capability later is bounded.** A future summarizing compaction
prompt tuned on real traces is a one-line `summary_prompt=` argument change (deferred per
§4.3, since no real goal-run traces existed at build time); a future step-persistence or
sub-agent feature is unlocked by the same `pydantic-ai-harness` dependency already pinned
here, with no further PydanticAI upgrade required.
