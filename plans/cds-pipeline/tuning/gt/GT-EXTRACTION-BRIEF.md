# Ground-truth extraction brief (read this first, in full)

You are producing **ground truth** for a CDS extraction-tuning harness. Ground truth
is the yardstick every future experiment is measured against. A wrong GT value is
worse than a missing one: it permanently charges the engine with an error it did not
make, or credits it for one it did. **When you are unsure, say so — never guess.**

Repo root: `/home/saifuddin/Projects/counselle/.worktrees/cds-pipeline`
Run all Python with `uv run`. Bare `python3 -c` is BLOCKED by hooks.

## Where things are

- PDFs: `artifacts/cds-corpus/<doc>.pdf`
- Rendered page images: `plans/cds-pipeline/tuning/scratch-gt/<doc>/pNN.png` (zero-padded)
- Page index (which CDS section is on which page): `plans/cds-pipeline/tuning/gt/<doc>_pageindex.json`
  — **read this first**, it tells you which pages you need and warns about layout hazards.
- Your metric list: `plans/cds-pipeline/tuning/gt/_specs/<domain>.json` — one entry per
  metric with `key`, `label`, `unit`, `type`, `source_hints`, `instructions`, `description`.
  **Every key in your assigned spec files must appear in your output. No omissions.**

## READ FROM PAGE IMAGES, NOT THE TEXT LAYER

Extract every value by reading the rendered page image. The text layer is for
cross-checking only, and on some documents it is actively dangerous:

- **Caltech**: digits are corrupted, *inside individual numbers* — `"Fall 202\x17"` is a
  visible `Fall 2024`. Standalone `9` characters are Wingdings checkmark bullets that
  decode to the digit nine, NOT data. Caltech is image-only with **zero** text fallback.
- **Cornell**: three different years appear in running headers (pages 1-2 "2022-2023",
  pages 3-27 a stale "2021-2022", glossary pages 28-32 "2019-2020"). The document is the
  **2022-2023** cycle. Never take the edition year from a running header.
- **Column-position encoding** (C7, D5, C15/C16, E1/E3, F2/F4, H12/H13 across several
  documents): the mark is a bare identical `X` or checkmark and **the meaning is carried
  entirely by which column it sits in**. Reading order cannot recover this. Read the grid
  from the image, column by column.

## Status semantics — these are exact, get them right

Each metric gets one `status`:

| status | meaning |
|---|---|
| `present` | The document states a value. Record it in `value`. |
| `blank` | The question/cell **exists** in this document but the institution left it empty. `value` = `null`. |
| `absent` | The question **does not exist** in this document's template edition at all. `value` = `null`. |
| `unreadable` | The value exists but genuinely cannot be read (damaged render, illegible). `value` = `null`. Use sparingly and explain in `evidence`. |

Refinements that have already cost us:
**A metric's own `instructions` field OVERRIDE every general rule on this page.** If the
spec entry for a metric tells you how to treat an empty cell, follow it and say so in
`evidence`. This has already produced a real disagreement: `transfer.transfer_rolling_admission_fall`
carries `"A blank/empty mark cell remains not_reported or unresolved"`, which makes an
unmarked D9 rolling-admission cell **`blank`**, not the `present`/`false` the general
checkbox rule below would give. The metric-specific instruction wins.

- An **unticked standalone checkbox** is `present` with value `false` — the empty box *is*
  the institution's answer ("we don't offer this"). Unless that metric's `instructions`
  say otherwise (see above).
- An **unselected radio/enum group** (a Yes/No pair with neither marked, an exam-choice
  group with nothing chosen) is `blank` — the institution did not answer.
- `blank` is never used for a standalone checkbox.
- A question printed with an explicit "Has been removed from the CDS" notice is `absent`.
- Record the **rendered** value, not a hidden/raw one. The engine can only see the page.

## Output format

Write ONE JSON file per assignment (path given in your task). Object keyed by the exact
metric key from the spec file:

```json
{
  "identity.institution_name": {
    "status": "present",
    "value": "Dartmouth College",
    "page": 1,
    "evidence": "A1 heading block, first line under 'Name of College/University'."
  },
  "identity.some_missing_item": {
    "status": "absent",
    "value": null,
    "page": null,
    "evidence": "No such item anywhere in this document's Section A; template edition omits it."
  }
}
```

- `page` = one-indexed **physical** page number where you read it.
- `evidence` = where on the page, precisely enough that an adjudicator can re-find it
  without hunting. Name the row label and column header for table cells.
- Values: numbers as numbers (`1234`, `12.5`), booleans as booleans, text as text.
  Percentages: record the number as printed (`43` for "43%", `0.88` for "0.88") and say
  which form in `evidence`. Do not convert, round, or normalise. Do not compute a value
  the document does not print — if a total is not printed, it is `blank`, not a sum you
  derived.
- If two candidate cells could plausibly match one metric, pick the better one AND add
  `"ambiguous": true` with both candidates described in `evidence`. This is the single
  most valuable thing you can flag.

## Working rules

- **Write incrementally.** Rewrite your JSON file after every ~15 metrics. Agents have
  stalled at the 600s watchdog and lost everything held in memory. Partial work on disk
  is worth far more than a perfect answer you never wrote.
- Read at most ~8 page images per batch, then write, then continue.
- You are ONE of TWO independent passes over this material. Do **not** look for, read, or
  reconcile against the other pass's output file. Disagreement between the passes is the
  signal the adjudication step needs; if you converge by peeking, you destroy it.
- Do not modify anything outside your assigned output file. No git commands. No docker.

## When you finish

Reply with: total metrics written, the count by status, every key you marked `ambiguous`,
and any metric you could not confidently resolve and why.
