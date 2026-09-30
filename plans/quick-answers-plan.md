# Focused Answer: fast, short, bounded

Owner ask (2026-09-29): Focused Answer takes far too long and writes a wall of
text. Long, researched answers are Deep Research's job. Make Focused Answer fast
and concise, cap its searching, and keep it accurate.

## Baseline (DeepSeek V4.1 Flash, Quick `low`, eval run 2026-09-30 UTC)

- 29/37 attempted cases passed.
- All cases: median 24.4s and 176 words; the 8 slowest took 96–200s.
- Comparison cases: median 32.6s against Gemini's 17.1s. Output tokens were
  about 2x Gemini's, and up to 14,985 output tokens for a 431-word answer.
- Up to 19 tool calls per turn.

## Where the time goes (measured)

1. **Every `get_facts` read overflows, and a model round is spent reading it back.**
   - One section of annotated facts is about 72,000 characters (~18k tokens)
     against an 8,000-character inline limit.
   - Each row carries the whole citation object, the raw value dict, unit,
     section, state, `observed_at` and `source_label`. The model uses only key,
     label, display, vintage and marker.
   - In the focused-direct case: `get_facts` → overflow → `read_tool_result` →
     `get_facts` by key → overflow again → read again. That is four rounds for
     two schools' facts.
2. **Nothing in code bounds a Focused Answer's work.**
   - Quick and Think share one 80-request budget.
   - When it binds, the turn ends with an apology and no answer.
3. **The base prompt is a research doctrine.** `counselor.md` (40KB, resent on
   every request) mandates, for every mode:
   - multi-source rounds;
   - a "mandatory multi-query Reddit sweep";
   - a discovery round plus a verification round;
   - web checks of stored statistics;
   - loading `counselor-research` and a playbook;
   - uncapped length for any "hard task".

   The 31-line `focused-answer` skill cannot outweigh that.
4. **The eval default differs from the product default.** The UI always sends
   `focused-answer`. With no mode selected, the server falls back to
   "automatic depth", which is the research doctrine.

## Changes

1. **Compact `get_facts` for the model** (`app/tool_middleware.py`).
   - A pipeline stage after citation annotation rewrites each row to
     `{key, label, display, vintage, marker}`, and the school's citation appears
     once at top level.
   - `unavailable`, `truncated`, `school` and `status` are kept.
   - `render_viz` does its own read, so charts are unaffected.
2. **Raise the inline tool-result limit** from 8,000 to 20,000 characters, so a
   compact section read comes back inline instead of costing a round.
3. **The server applies the default response mode.** When a turn has no
   response-mode skill selected, `focused-answer` is rendered, as the UI already
   does. The "automatic depth" fallback in `counselor.md` goes.
4. **A tool-round budget for Focused Answer on the chat surface** (not goal
   turns, not the essay panel).
   - New setting `focused_answer_max_tool_rounds` (default 3).
   - After that many model requests, a capability withdraws every function tool
     (`prepare_tools` → `[]`) and adds one instruction: answer now from what you
     have.
   - `ask_student` is an output tool, so it stays.
   - The turn always ends in an answer, never a budget apology.
5. **Prompt split.**
   - Move the research doctrine (multi-source default, routing matrix, Reddit
     sweep, unknown-unknown discovery, playbook and `counselor-research`
     loading, "hard task" depth) out of `counselor.md` into `deep-research`.
   - `counselor.md` keeps the mode-neutral rules: honesty, citations,
     composition laws, workspace, viz and voice.
   - `focused-answer` becomes a tight contract:
     - answer first;
     - about 2–5 sentences or a small table, around 120 words;
     - no headings and no per-axis essay;
     - at most one caveat;
     - plan tool rounds; at most two searches and no sweeps;
     - no playbook loading.
6. **Re-measure.** Run the Quick eval set; if accuracy holds, re-check Quick
   `none` against `low`.

## Targets

- Pass count ≥ 29/37, with no new honesty or coverage failures.
- Median ≤ 12s, p95 ≤ 45s.
- Median answer ≤ 110 words.
- Deep Research cases still pass.

## Risks

- Moving doctrine can drop a rule that the mode-neutral path needed. Every line
  moved is either research routing or depth; honesty and citation rules stay in
  the base prompt.
- A hard round cap can cut a comparison before its table renders. The model then
  answers in prose, which evals may score as a composition miss. Measure it, and
  raise the default only if needed.
- A 20k inline limit raises per-round input when results are large. It is bounded
  by the round cap and by `ClearToolResults` compaction.

## Results (Quick `low`, same 37-case eval set, 2026-09-30)

| Run | Passed | Median | p95 | Median words | p95 words | Tool calls (median / max) | Median output tokens |
|---|---:|---:|---:|---:|---:|---|---:|
| Before | 29 | 24.4s | 145.4s | 177 | 477 | 4 / 19 | 1,289 |
| v3 | 27 | 17.5s | 63.8s | 93 | 217 | 3 / 7 | 759 |
| v4 (same code, re-run) | 28 | 17.0s | 101.1s | 105 | 188 | 3 / 11 | 694 |

- The slowest cases fell the most: 145s → 40s (cross-school SQL), 200s → 96s (most-selective
  ranking), 146s → 54s (best-aid ranking). `read_tool_result` read-backs fell from 46 calls to 4.
- Only one case differs from the baseline in v4: `v3-honesty-score-band-not-a-cutoff`, whose
  answer added an invented "730+ is the zone" heuristic. It passed in v2; single-case flips
  between identical runs are normal for this set.
- `denominator_honesty` is 0/4 in every run, Gemini's included: the eval expects a total of
  2,746 profiled schools, but the `fact_coverage` recipe returns 2,239 (TODOS).
- Two of the slow outliers (120s and 101s for a two- or four-call turn with a few hundred output
  tokens) were provider stalls. Probed directly, Fireworks answers a 15k-token prompt in
  about 2s, and prompt caching hits on repeats.

## Implementation notes (deviations from this plan)

- **The round budget is 4, not 3.** At 3, SQL rankings (`db-recipes` → SQL → `get_facts`
  re-fetch → answer) could not re-fetch their finalists.
- **Output tools are withdrawn too.** With only function tools withdrawn, the model escaped the
  budget through `ask_student` and five answers came back empty.
- **`render_viz` resolves a column by exact official name** when the `unitid` is missing; the
  model often sent names only, and every retry cost a round. Duplicates are rejected. Its
  docstring now states the shape (columns are schools, rows are facts) with an example.
- **Goal turns drop response modes**, since goal mode is its own way of working; the base prompt
  keeps a short research and depth pointer for every mode except Focused Answer.
