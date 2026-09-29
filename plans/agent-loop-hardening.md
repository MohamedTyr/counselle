# Agent Loop Hardening — audit findings (2026-07-08)

Source: audit of our agent loop against the published Claude Code / Codex / Anthropic
long-running-harness playbook ([effective harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents),
[Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/),
[12-factor agents](https://github.com/humanlayer/12-factor-agents)).

**Verdict:** the architecture is correct — single-threaded PydanticAI tool loop
(`prepare → agent → END`), `write_plan` for attention steering, narration as
simulated thinking for non-thinking models, tool-result overflow spilling
(observation masking / JIT retrieval), graceful budget cutoff, structured
msgpack-plain state, on-demand skills, verification in code (citation envelope +
evals). No re-architecture needed. The gaps are all about **unbounded growth
across turns**.

---

## 1. Conversation compaction (the one that hurts quality) — HIGH — CLOSED (2026-09-16)

**Closed by goal-mode Phase 1.** `pydantic-ai-harness==0.4.0`'s `ClearToolResults` is now
mounted in the `capabilities=[...]` list `app/agent_node.py` builds for **every** turn,
goal or not (`plans/goal-mode-plan.md` D11) — not the hand-rolled `history_processors`
hook this finding originally sketched, but the same fix in substance: old tool-call/
tool-return pairs are blanked in place below a token floor
(`compaction_min_clear_tokens`) before every turn's history is re-sent. Goal turns
additionally escalate to `TieredCompaction`/`SummarizingCompaction` when history exceeds
`goal_compaction_target_tokens`, but that tier is goal-only — the fix for *this* finding
(unbounded growth in every session) is the unconditional `ClearToolResults` mount alone.
See `docs/ARCHITECTURE.md` §42.5 and ADR 0041.



**Problem:** `app/agent_node.py:347` feeds the entire serialized session history
into every run; `messages_out = result.all_messages()` appends forever. No
trimming, no compaction anywhere (`history_processors` unused). Long sessions:

- degrade into the "dumb zone" (model recall drops in the middle of a stuffed context),
- grow cost quadratically over the session (each turn re-sends everything;
  Gemini implicit caching only helps while the prefix is byte-identical),
- eventually hit the context limit.

Per-item damage is bounded (overflow caps tool results at 8k chars via
`agent_tool_result_max_chars`) but the item count is not.

**Fix (KISS-sized):** a PydanticAI `history_processors` hook that strips
tool-call/tool-return parts from turns older than the last N, keeping only
user/assistant prose. Old tool payloads are the bulk of the tokens and the
model almost never needs them — this is the standard "compaction preserves
decisions, discards stale tool output" rule. No summarization LLM call needed
for v1.

**Where:** `app/agent_node.py` (Agent construction), new helper module
(e.g. `app/history.py`), knob in `config/settings.py` (e.g.
`agent_history_keep_tool_turns: int`).

## 2. `tool_result_store` never evicts (storage leak) — MEDIUM — STILL OPEN

**Explicitly left open by goal-mode.** `plans/goal-mode-plan.md` §2.12/§8 names this
finding by number, records that a goal turn "compresses many turns' worth of that growth
into one" and is "the feature most likely to surface it first in production," and states
plainly that fixing it is out of that plan's scope. Nothing in Phases 0–5 touches it.
This finding stays open.



**Problem:** `app/agent_node.py:503` dumps the *whole* spill store back into
state every turn and nothing ever removes entries. Every spilled payload from
every past turn rides every future checkpoint row — checkpoint DB bloat that
compounds per turn per session.

**Fix:** evict all but the current turn's spills when the turn completes
(`read_tool_result` is realistically only useful within the turn that spilled).
Roughly: track which handles were created this run and dump only those.

**Where:** `app/tool_overflow.py` (`ToolResultStore`), `app/agent_node.py`
(the `overflow_store.dump()` at return).

## 3. Explicit persistence bias in the prompt — LOW, one sentence — CLOSED (2026-09-16)

**Closed by goal-mode Phase 3.** Goal mode's own prompt block (`render_goal_mode()`,
appended to `instructions` per `plans/goal-mode-plan.md` §2.9) states the persistence
rule explicitly for goal turns — "Persistence, in Codex's words... plus OpenCode's
anti-hand-wave clause" — folding this finding's one-sentence fix into goal mode's own
prompt work rather than editing `counselor.md` separately. The general counselor prompt
is unchanged; the explicit persistence instruction is scoped to goal turns, where it
matters most given the budget attached to the loop.



**Problem:** the persistence bias in `config/assets/prompts/counselor.md` is
implicit ("recover from gaps", "don't stop to clarify — assume and continue").
Codex's prompt makes it explicit ("keep working until the task is done").
Weaker / non-thinking models are the ones that quit early on multi-step work.

**Fix:** add one sentence to the Planning And Tool Loop section, e.g.
"Keep working until the task is fully done — do not stop after partial
progress or hand the task back half-finished unless you hit a hard budget."

## Explicitly NOT doing (recorded so we don't re-litigate)

- **Private `think` scratchpad tool.** Narration + `write_plan` already cover
  externalized reasoning; build only if a weak non-thinking model measurably
  underperforms. YAGNI.
- **Multi-agent / graph orchestration.** The single loop is the correct shape;
  the deep-research node stays a deferred additive seam (`specs/deep-research/plan.md`).
- **Lowering the 80-request / 2M-token budget.** Generous but harmless; the
  token cap backstops it.
