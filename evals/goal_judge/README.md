# Goal-judge eval set

**This dataset is SYNTHETIC, hand-constructed, and labeled by a human reviewer
during Phase 2 of the goal-mode plan (`plans/goal-mode-plan.md` §3.8, §6.2) —
it is NOT drawn from real goal runs.** This set was built before the goal
loop (`app/goal_loop.py`) existed and remains synthetic — no labeled
real-trace examples have been added since. Every
case in `cases.yaml` is a hand-built, plausible tool-receipt bundle grounded
in this repo's actual `domain.mutation_receipts.WorkspaceMutationReceipt`
shapes and `domain.events.StepData` wire type — not sampled from production.
**Do not mistake this for real-trace data when re-labeling or extending it.**

Once real goal runs exist, this set should be supplemented (not replaced) with
real-trace examples, particularly for the adversarial cases, which are
currently the reviewer's best guess at what a padding attack looks like
against this repo's own evidence shapes rather than an attack mined from an
actual run.

## What's here

- `cases.yaml` — the judge eval: 42 hand-labeled cases, each a
  `(statement, criteria, receipts, final_text, prior_cited_step_ids)` bundle
  plus a per-criterion ground-truth `met` label. Split `train`/`dev`/`test`
  (dev/train are for prompt calibration only and are never scored; `test` is
  scored once, per Hamel Husain's split discipline cited in the plan). Nine
  cases are tagged `adversarial: true` — long, confident, padded `final_text`
  with little or no supporting receipt, always labeled `not_met` (the R2
  MT-Bench padding-attack case the plan calls out by name).
- `criteria_examples.yaml` — 12 hand-labeled criteria SETS (not judge cases):
  each is a candidate output of `derive_criteria` for a goal statement, with a
  human verdict (`accept`/`reject`) and, when rejected, which of §3.2's three
  constraints it violates. Several are deliberately C11 violations (claiming
  coverage of the Common App portal, transcripts, recommendation letters,
  etc.) — the constraint the plan calls the one that matters most.
- `runner.py` — scores `judge_goal` against `cases.yaml`'s `test` split
  (TPR/TNR reported SEPARATELY, plus the false-positive rate, never raw
  accuracy — raw accuracy is explicitly forbidden as the gate metric by the
  plan, since an always-"met" judge scores ~95% on a system that fails 5% of
  the time while catching nothing) and checks `criteria_examples.yaml`'s
  labels against a small rule-based §3.2 constraint checker (`_audit_criteria`)
  as a sanity check on the hand labels — it does not call the criteria-writer
  model itself (that would require re-running `derive_criteria` against these
  exact goal statements and manually re-labeling the result each time the
  prompt changes, which is out of scope for this harness).

## Running it

```bash
# Cheap sanity check: validates every case parses into real domain/receipt
# types and the harness wiring works, without any model call.
uv run python -m evals.goal_judge.runner --dry-run

# A SMALL smoke subset against the real judge model (few cases, real cost).
uv run python -m evals.goal_judge.runner --smoke 3

# The full test-split gate (NOT run as part of this phase — see the
# accompanying report for exactly what was and was not executed).
uv run python -m evals.goal_judge.runner
```

The judge runs on `model_goal_judge` (empty means `model_cheap`) at
`reasoning_effort_cheap`, with `temperature=0.0`: DeepSeek V4.1 Flash on
Fireworks with reasoning off, by default (ADR 0043). The gate passes recorded
before 2026-09-29 (`REPORT-20260916T160355Z.md` and the ones after it) were
measured on Gemini 2.5 Flash; they say nothing about the current model.

`--dry-run` never calls a model. `--smoke N` calls the real judge on the
first N `test`-split cases only. Omitting both runs the full `test` split —
this is the actual `>90% agreement, TPR/TNR separate, FP rate reported`
Phase 2 gate (§6.2), and it costs real money to run in full.
