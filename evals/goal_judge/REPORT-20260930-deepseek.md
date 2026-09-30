# Goal judge and criteria writer on DeepSeek V4.1 Flash — 2026-09-30 (UTC)

Model: `fireworks:accounts/fireworks/models/deepseek-v4p1-flash` (ADR 0043).
Judge temperature 0.0 in every run. Runs were made on
`worktree-feat-fireworks-deepseek`; raw logs are local, under
`artifacts/fireworks-deepseek/`.

## Judge gate (`uv run python -m evals.goal_judge.runner`, n=43)

| Run | Judge effort | TP | FP | TN | FN | TPR | TNR | FPR | Missed |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | none | 21 | 0 | 21 | 1 | 0.955 | 1.000 | 0.000 | test-22 |
| 2 | low | 22 | 0 | 21 | 0 | 1.000 | 1.000 | 0.000 | — |
| 3 | low | 21 | 0 | 21 | 1 | 0.955 | 1.000 | 0.000 | test-28 |
| 4 | high | 22 | 0 | 21 | 0 | 1.000 | 1.000 | 0.000 | — |
| 5 | high | 21 | 0 | 21 | 1 | 0.955 | 1.000 | 0.000 | test-28 |

- **No false positive in any run**, including all adversarial padding cases.
  Every miss is the judge refusing a criterion the label calls met.
- **The plan's bar — TPR/TNR 1.000 on two consecutive runs — is not met at any
  effort.** Gemini 2.5 Flash met it on this set (2026-09-18, before this switch).
- Both missed cases have debatable labels, left unchanged for the owner:
  - **test-28** asks that two tasks be "marked done", but its only receipt is an
    *archive* action ("Archived 2 tasks"). In the current tasks model, archiving
    is not completing, so "not met" is defensible.
  - **test-22** asks that "every school on the list" has a deadline, with receipts
    for two schools and nothing showing the list holds only those two.

## Criteria writer spot check (plan §7.5)

Six fixed statements through the real `derive_criteria`. Full outputs:
`artifacts/fireworks-deepseek/criteria-*.md`.

| Statement | Gemini 2.5 Flash | DeepSeek, none | DeepSeek, low | DeepSeek, high |
|---|---|---|---|---|
| Every school has a deadline recorded | 1 criterion | 2 (c2 restates c1) | 2 (c2 restates c1) | 1 |
| Deadlines and why-this-school notes | 2 | 3 (adds "no deadline before today") | 3 (adds "list is not empty") | 3 (adds "list is not empty") |
| UC applications ready to submit | 4, workspace-checkable | 4, workspace-checkable | 3, workspace-checkable | 3, workspace-checkable |
| Personal statement ≥ 500 words | 2 (exists, ≥ 500) | 2 (adds "saved as a complete draft") | 1 | 2 (exists, ≥ 500) |
| Add National Merit as an honor | 1 | 2 (c2 restates c1) | 1 | 1 |
| Add a task to finish the essay | 1 | 2 (adds "not marked complete") | 1 | 1 |

- No run turned "add a task" into "the task is complete", and every run kept
  UC criteria inside what Counselle can see (C11).
- At `none` and `low` the writer padded or restated; at `high` its output
  matches Gemini's shape (the "list is not empty" guard aside, which stops an
  empty list from satisfying "every school").

## Decision

`reasoning_effort_goal` defaults to `high` for both the criteria writer and the
judge. The judge's false-positive rate was 0 at every effort. `high` is the only
effort at which the criteria writer met §7.5. The strict judge bar stays open
for the owner (above).
