# Ground-truth file schema (consumed by `scorer.py`)

Scorer version this schema is pinned to: **`SCORER_VERSION = "1.1.0"`**, `GT_SCHEMA_VERSION = 1`.

`schema_version` is **enforced**: a GT file declaring anything other than `1` is a
hard load error, never a silent load.

One GT file per (school, CDS edition), at
`specs/cds-pipeline/tuning/gt/<school>_<year>.json`. The scorer resolves a run's
GT by the run's `document.name` stem unless `--gt` is passed explicitly, so
**name the GT file after the PDF** (`harvard_2025-26.pdf` → `harvard_2025-26.json`).

GT is only ever read by the offline tuning harness. It is not shipped, not
loaded by the app, and never touches the runtime pipeline.

## File shape

```json
{
  "schema_version": 1,
  "school": "harvard",
  "year": "2025-26",
  "document": { "name": "harvard_2025-26.pdf", "sha256": "…" },
  "manifest_version": "5.0.2",
  "notes": "free text, ignored by the scorer",
  "metrics": {
    "admissions.applicants_total": {
      "status": "present",
      "value": "61220",
      "page": 7,
      "evidence": "C1 — Total first-time, first-year applicants"
    }
  }
}
```

Everything outside `metrics` is metadata: the scorer reads only `metrics`.
(If the top-level object has no `metrics` key, the whole object is treated as
the metric map — convenient for hand-edited scratch files.)

### Metric keys

Keys are **`"<domain>.<metric_id>"`**, byte-identical to the compiled manifest's
own `metric["id"]` (which is already domain-qualified, e.g.
`academics.special_study_double_major`). Internally the scorer normalizes every
key to a `(domain, bare_id)` tuple, because bare ids are only unique *within* a
domain (`applicants_total` exists in both `admissions` and `transfer`).

A nested layout is also accepted:

```json
{ "metrics": { "admissions": { "applicants_total": { "status": "present", "value": "61220" } } } }
```

A bare, unqualified flat key (`"applicants_total": {...}`) is a hard error.

### Entry fields

| Field | Required | Type | Meaning |
|---|---|---|---|
| `status` | yes | `"present"` \| `"blank"` \| `"absent"` \| `"unreadable"` | see below |
| `value` | when `present` | string (preferred) or number/bool | the value **as printed in the PDF** |
| `page` | optional | int | 1-based PDF page. Only feeds the never-gated `citation-mismatch` count |
| `evidence` | optional | string | the row/label a human used; for audit only |

`status` semantics:

- **`present`** — the document states an answer for this metric. `value` is required.
  This includes a **checkbox that is on the form and unticked** → `value: false`.
- **`blank`** — a **fill-in value cell** (text / number / money) exists on this
  document's form and was left empty (or prints `—`, `N/A`). The engine must
  return **nothing**. **Never use `blank` for a checkbox.**
- **`absent`** — the row/question **does not appear at all** in this document's
  template edition (different CDS year, section omitted). The engine must
  return **nothing**.
- **`unreadable`** — you looked and **could not read it**: scan artifacts, a
  cropped table, a genuinely ambiguous multi-column row. Scored into its own
  `unreadable` bucket — never folded into `missed`, `uncovered`, or an
  abstention, and **never charged to the engine**. This keeps "I didn't check"
  (`uncovered`) distinguishable from "I checked and it's illegible".

**Do not create entries for metrics you have not checked.** A manifest metric
with no GT entry is scored `uncovered` — counted and reported separately, never
silently passed or failed. Omission is the honest default; a guessed entry is not.

### Checkboxes: the ruling (read this before authoring any boolean)

85 of the 394 metrics are checkboxes. A present-but-unticked box is the case
that splits GT authors, and the two readings produce **opposite outcomes**, so
there is exactly one correct answer:

| What you see in the PDF | `status` | `value` | Why |
|---|---|---|---|
| The row/question is on the form, box **ticked** | `present` | `true` | The institution answered "yes". |
| The row/question is on the form, box **unticked** | `present` | `false` | **An unticked box present on the form IS the institution's answer.** It means "no", and the engine is expected to say `false`. |
| The row/question **does not appear** in this template edition | `absent` | — | Silence expected. |

Rationale, and why `absent` ≠ `false`: per `specs/cds-pipeline/METRICS-KEEP.md`
trap #1, *"An unchecked box is not a 'no' — the school may have used an older
template edition."* If you record a row that isn't on the form as
`present`/`false`, an engine that correctly stays silent is scored `missed` —
a false negative you will spend the tuning loop chasing. If you record an
unticked box that *is* on the form as `absent` (or `blank`), an engine that
correctly answers `false` is scored `hallucinated`. Same engine behaviour,
inverted verdicts. Check whether the **row exists**, not whether the box is
marked.

Worked examples:

```json
{
  "academics.special_study_double_major":   { "status": "present", "value": "X",   "page": 11,
    "evidence": "Section E, double major row — box ticked" },
  "academics.special_study_teacher_cert":   { "status": "present", "value": false, "page": 11,
    "evidence": "Section E, teacher certification row present on the form, box empty" },
  "academics.special_study_dual_enrollment":{ "status": "absent",
    "evidence": "no dual-enrollment row in the 2019-20 template edition" },
  "cost.tuition_undergraduate":             { "status": "blank",   "page": 12,
    "evidence": "G1 tuition cell exists but is empty" },
  "faculty.minority_faculty_full_time":     { "status": "unreadable", "page": 24,
    "evidence": "I-1 table cropped mid-column in this scan" }
}
```

`blank`, `absent`, and `unreadable` all expect the engine to stay silent, but
they are scored differently: `blank`/`absent` produce
`correct_abstention` / `hallucinated`, while `unreadable` is not scored at all.

### GT values that are unwinnable (hard authoring error)

A `present` entry whose `value` is one of the *"nothing here"* tokens below —
`"None"`, `"N/A"`, `"-"`, `""`, JSON `null`, … — **can never be matched**: the
token normalizes to *absent* on both sides, so the metric would score `wrong`
no matter what the engine emitted. Real CDS free-text rows do print a literal
`None`, so this trap is live. The scorer detects it at load time, reports it in
its own `gt_error` bucket (**not** charged to the engine), and exits non-zero.

If the cell is empty use `blank`; if the row isn't on the form use `absent`.
There is deliberately no way to express "the document literally prints the word
None as a value" — record it as `blank` and note it in `evidence`.

A GT key that matches **no manifest metric** (`admissions.applicants_totl`) is
likewise an authoring bug, not a scoring outcome: it is printed loudly and
forces a non-zero exit, because a typo silently shrinks the denominator.

## Value formatting

Write `value` **as printed in the PDF**, as a JSON string. The scorer's
normalizer strips formatting (`$`, `,`, `%`, whitespace, trailing zeros), so you
do not need to pre-clean — and pre-cleaning risks destroying the qualifier
tokens that matter (`"<1%"`).

Precision is meaning: `56` and `56.3` are different values and will not match.
Transcribe the printed digits exactly.

## Worked example per rule

The normalization rule is chosen from the manifest metric's `unit` (with
`type == "boolean"` taking priority). Full mapping:

The rule is chosen by `unit` **and** `type` — several units appear with both
`type: integer` and `type: number` in the manifest and resolve to different
rules. The two rules are numerically identical in effect; the split only
matters if you are reading the code.

| manifest `unit` | `type` | rule | canonical form | example GT `value` |
|---|---|---|---|---|
| `students`, `applicants`, `faculty`, `sections`, `weeks`, `score` | `integer` | count | separators stripped; a *fractional* trailing zero is dropped | `"1,234"`, `"1500"` |
| `students`, `faculty`, `weeks` | `number` | number | same, as a plain decimal | `"12"`, `"2.5"` |
| `carnegie_units`, `years`, `source_unit_value` | `number` | number | plain decimal | `"4"`, `"2.5"` |
| `percent` (both `type: number` and the 58 `type: string` ones) | — | percent | qualifier + number as printed | `"56.3"`, `"56.3%"`, `"<1%"` |
| `usd` | `number` | money | `$`/commas stripped | `"$59,320"` |
| `ratio` | `number` | ratio | `n:m` | `"12 : 1"`, `"12 to 1"`, `"0.87"` |
| `gpa` | `number` | gpa | plain decimal | `"3.90"` |
| `boolean` | `boolean` | boolean | `true` / `false` | `"X"`, `"✓"`, `"Yes"`, `true`, `false` |
| `category` | `enum` | text | lowercased, whitespace collapsed | `"very_important"` — see below |
| `text`, `date`, `url`, `email`, `academic_year` | `string` | text | lowercased, whitespace collapsed, dashes unified | `"2025–2026"` |

**"Trailing zeros" means *fractional* trailing zeros only.** `56.30` → `56.3`
and `59320.00` → `59320`; **`1500` stays `1500`** and `"1,500"` → `1500`.
Digits before the decimal point are never dropped. Transcribe the printed
digits exactly and let the normalizer do the rest.

`ratio`: a bare integer is read as `n:1` and the assumption is logged
(`ratio_implicit_denominator_1`). A bare **decimal** — the two
`outcomes.*_rate_ratio` metrics print e.g. `0.87` — is already a rate, so it
canonicalizes to `0.87:1` with **no** tag; the `transforms` channel stays clean
for autopsies. Scoring is identical either way.

Unicode qualifiers are rewritten to ASCII (`≤`→`<=`, `≥`→`>=`, `≈`→`~`) and
each rewrite **is logged** as a transform, because `≈`→`~` equates two
different approximation markers.

**Enums are the one exception to "as printed."** The engine is schema-constrained
to emit the manifest's snake_case enum token (`very_important`), not the PDF's
printed label ("Very Important"). Record the **token**. A value outside the
metric's compiled `enums` set is tagged `enum_value_not_in_manifest` in the
report's `transforms` list — it is never coerced, so if a whole domain's enums
suddenly read `wrong`, check that tag before blaming the engine.

Ranges/bands are detected inside the numeric rules: `"1500-1560"`,
`"1500 – 1560"` all canonicalize to `1500-1560`, both bounds normalized, and
both bounds must match.

```json
{
  "admissions.applicants_total":            { "status": "present", "value": "61,220", "page": 7 },
  "class_profile.sat_submitters_percent":   { "status": "present", "value": "<1%",    "page": 9 },
  "cost.tuition_undergraduate":             { "status": "present", "value": "$59,320", "page": 12 },
  "faculty.student_faculty_ratio":          { "status": "present", "value": "6 : 1",  "page": 15 },
  "class_profile.gpa_average":              { "status": "present", "value": "3.90",   "page": 9 },
  "academics.special_study_double_major":   { "status": "present", "value": "X",      "page": 11 },
  "admissions.rigor_of_record":             { "status": "present", "value": "very_important", "page": 8 },
  "class_profile.sat_composite_25_75":      { "status": "present", "value": "1500–1560", "page": 9 },
  "admissions.waitlist_offered":            { "status": "blank",   "page": 8, "evidence": "C2 waitlist rows all empty" },
  "transfer.applicants_total":              { "status": "absent",  "evidence": "no D section in this edition" }
}
```

## Tokens that mean "nothing here"

On **either** side, these normalize to *absent* (case-insensitive, after
whitespace collapse):

`""`, `"-"`, `"--"`, `"–"`, `"—"`, `"−"`, `"n/a"`, `"na"`, `"n.a."`, `"none"`,
`"null"`, `"nil"`, `"not reported"`, `"not applicable"`, `"not available"`,
`"blank"`, and JSON `null`.

**`0` is NOT one of them.** A `0` the engine scraped out of an empty cell is a
hallucination, and the scorer counts it as one. If a document genuinely prints
`0`, record `{"status": "present", "value": "0"}`.

## Scoring outcomes this schema drives

| GT | engine | outcome |
|---|---|---|
| `present` | matching value | `correct` |
| `present` | non-matching value | `wrong` |
| `present` | nothing (no finding, a **recognized** non-`reported` status, or an absent token) | `missed` |
| `blank`/`absent` | any value | `hallucinated` |
| `blank`/`absent` | nothing | `correct_abstention` |
| `unreadable` | anything | `unreadable` (not charged either way) |
| `present` with an absent-token value | anything | `gt_error` (authoring bug, not charged) |
| *(no GT entry)* | anything | `uncovered` |

`uncovered`, `unreadable`, and `gt_error` are excluded from `covered` and from
every accuracy/coverage denominator.

`citation-mismatch` (correct value, `page` ≠ GT `page`) is counted and reported
separately. It never changes an outcome and never gates anything.

## Engine `availability_status`

The engine may emit exactly five values (`domain/cds/claims.py`): `reported`,
`not_reported`, `not_applicable`, `suppressed`, `not_in_template_version`.
Only `reported` is an extraction; the other four are recognized abstentions.

Anything else — `"Reported"`, `"reported "`, `null`, a future
`"brand_new_status_v2"` — is **unrecognized**. It is counted, printed loudly,
and forces a non-zero exit, and the finding is charged **as if extracted**. It
is deliberately *not* whitespace/case-normalized: silently forgiving an
unknown status would turn every hallucination in a run into a
`correct_abstention`.

## Fitness

Each scored report carries an explicit lexicographic fitness tuple, higher is
better, in this fixed order:

```
(accuracy_pct, coverage_pct, -cost_per_doc, -latency_per_doc)
```

Accuracy alone is gameable — abstain on everything and it is `None`; extract
one metric and abstain on the rest and it is `100.0` at 0.25% coverage.
`None` maps to the sentinel `-1.0`, **below every real percentage including
`0.0`**, so a zero-extraction run always ranks last. Missing cost/latency is
treated as infinite. `compare_fitness(a, b)` orders two reports.

Every report carries `fitness_inputs` — the four raw numbers, named, plus a
`basis` string saying where they came from.

### The decision number is the aggregate, never one document

A config's number is its **full N-document eval aggregate**. Scoring a partial
eval is forbidden.

```bash
uv run python harness/scorer.py runs/exp-7/*.json --gt-dir gt --aggregate --label exp-7
```

`aggregate_reports(reports, expected_documents=5)` emits **one** aggregate
report with **one** fitness tuple, alongside the per-document reports.

- **Rates come from summed buckets**, never from averaging per-document
  percentages. Averaging weights a 4-metric document exactly as heavily as a
  300-metric one — a Simpson's-paradox trap in which the two reductions crown
  opposite configs. `correct`/`wrong`/`missed`/`hallucinated`/… are summed
  across documents and the ratios are computed once.
- **Cost and latency** are reported as both a total and a **mean per
  document**; the fitness tuple consumes the **means**, so the number stays
  comparable if the document set ever changes size.
- The zero-extraction sentinel (`-1.0`) applies identically at the aggregate
  level.
- The aggregate **refuses to certify a partial eval** — it populates
  `blocking_issues`, prints them, and exits non-zero rather than emitting a
  complete-looking fitness tuple. Triggers: fewer (or more) runs than
  `--expect-documents` (default 5), a duplicated document, any run carrying
  `errors`, any per-document blocking issue, mixed `scorer_version`, mixed
  manifest hash, or two different configs folded into one aggregate.
