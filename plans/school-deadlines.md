# School deadlines — recover what CollegeData publishes, then stop copying it

Status: draft, 2026-09-20. Lives in `plans/` until the owner accepts the work.

## 1. Problem

A student's application deadline in Counselle is a one-time copy. The Add School
dialog is meant to offer the CollegeData date for EA/ED/RD so the student can
click "Use" and land it in `counselle.applications.deadline`. From then on
nothing refreshes it: a school moving its date, or a new cycle's dates landing
in the daily crawl, never reaches the student's row. The aid deadline is not
offered at all.

The offer itself is also broken today: `DEADLINE_FACT_ROUND` in
`AddSchoolDialog.tsx` compares snake-case round ids (`"early_action"`) against
the `DeadlinesBlock` rows' `round`, which the backend fills from the human label
(`"Early action"`, via `_deadline_round_label`). They never match, so
`deadlineOffer` is always null in production; the dialog's tests pass only
because their fixtures invent `round: "regular"`. Part B deletes this path
rather than fixing it.

Underneath that, the facts store loses most of the early-round dates CollegeData
actually prints. Live counts on 2026-09-20 (2,239 profiled schools):

| Fact | Rows | With a real `value_date` |
|---|---|---|
| `deadlines.regular` | 1,821 | 662 (1,159 are "Rolling", correctly) |
| `deadlines.early_decision` | 248 | 91 |
| `deadlines.early_action` | 480 | 253 |
| `deadlines.reply_by` | 203 | 119 |
| `deadlines.regular_notification` | 1,453 | 0 (mapped as text) |
| `deadlines.early_action_notification` | 403 | 0 (mapped as text) |

272 schools say `early_decision_offered = true`; 185 of them have no dated ED
deadline. Checked against the live site for Yale, Emory, Northwestern and Duke,
the site has the dates and our mapper drops them, for exactly two reasons:

1. **Two dates in one cell.** CollegeData prints ED I and ED II together:
   Emory and Vanderbilt say `"November 1, January 1"`, 27 schools say
   `"November 1, January 15"`, and EA has the same shape (`"November 1,
   December 1"`). `text_fallback_date` cannot parse the pair, so the whole cell
   survives as text with no date.
2. **No year to anchor to.** A bare `"November 1"` is rolled onto `cycle_year`,
   which `_cycle_year` derives from the admission header's
   `admissionDeadlineDate`. Schools with rolling regular admission have no such
   date, so `cycle_year` is `None` and the early date is stored as text. The
   crawler's `fallback_cycle_year` is only consulted when the admission tab
   itself was not fetched.

Notification dates ("April 1", "December 15") are mapped `scalar, kind: text`
on purpose in `facts_keys.yaml` and never become dates at all.

**Non-goals.** REA as distinct from EA (CollegeData files Yale's SCEA under
"Early Action"), priority deadlines, supplemental essay prompts, and anything
CollegeData does not print. Those need a per-school official-page scrape; that
is a separate plan (§7). This plan does not touch the parked CDS pipeline, the
`school_requirements` decision (`plans/school-page-slim.md`), or the crawler's
fetch/rate-limit layer.

## 2. What ships

**Part A — the mapper keeps every date CollegeData prints.** Comma-joined
pairs split into two facts; bare month-days anchor to the current admissions
cycle when the page carries no year; notification dates become dates. One
`remap` pass rewrites the store from existing snapshots, no network.

**Part B — application deadlines derive from the store.** A null
`applications.deadline` means "inherit from the facts store for my round and
cycle"; a student-entered date is an override. The same for `aid_deadline`. The
list, the detail page, the agent's `view_schools`/`get_school`, and every task's
`deadline_inherited` all read one effective value with its source and
checked-on date.

## 3. Part A — mapper

### A1. Split two-date cells

`app/facts/mapper_handlers.py::text_fallback_date` gains an optional
`second_key`. When the raw value contains exactly one comma and both halves
parse as bare month-days (`domain.facts.period.parse_bare_month_day`), it
emits two `MappedFact`s: the first half under `base_key`, the second under
`second_key`, each with its own resolved date, its own `display` (the half as
printed, e.g. `"January 1"`), and the shared `reported_period`. Anything else
falls through to today's behavior unchanged. A pair with no `second_key`
configured (the rule did not ask for it) also falls through unchanged; that is
the `reply_by`/`financial_aid` case, where a comma would be a surprise worth
seeing as text rather than guessing.

Rule changes in `config/assets/facts_keys.yaml`:

```yaml
- {..., match: "Early Decision Deadline", handler: text_fallback_date, fact_key: deadlines.early_decision, second_key: deadlines.early_decision_2, section: applying}
- {..., match: "Early Action Deadline",   handler: text_fallback_date, fact_key: deadlines.early_action,   second_key: deadlines.early_action_2,   section: applying}
```

`_dispatch_leaf` passes `rule.get("second_key")` through. Each half carries
the same `reported_period` and `reported_period_year` (both anchor to the one
`cycle_year`); only `value_date` and `display` differ.

The sections generator resolves a key's owning tab by scanning each rule's
emitted keys in `_candidates()` (`scripts/build_facts_sections_tabs.py:700`,
today `fact_key`, `produces`, `pct_key`, `count_key`). Add `second_key` there,
or `owning_tab_for()` raises "no owning tab found" for the two new keys the
moment the generator or its byte-identical test runs.

Rejected: a regex `"(\w+ \d+), (\w+ \d+)"` handler of its own. `text_fallback_date`
already owns the absence → ISO → month-day → text ladder; the pair is one more
rung, not a new handler.

### A2. Anchor bare dates to the current cycle

`_cycle_year(pages, fallback_cycle_year)` returns `fallback_cycle_year` when the
header carries no ISO date. Today the crawler passes `None` there unless the
admission tab was skipped. Change `app/facts/crawl.py` so the fallback is
always populated:

```
fallback_year = (stored regular-deadline year if admission tab not fetched)
                or settings.current_admissions_cycle_year
```

The crawl pass computes this in `_process_school` (`crawl.py:~303`). The
remap pass does not: `run_remap_pass` holds `settings` but calls
`_process_school_remap(pool, school_id=, mapper_version=)`, which hardcodes
`fallback_cycle_year=None` into `_write_school` (`crawl.py:413`). Thread one
`fallback_cycle_year: int` parameter through `run_remap_pass →
_process_school_remap → _write_school`, sourced from the same expression, so
A5's remap actually anchors. Without that change the remap recovers the comma
pairs at schools with a dated regular deadline and nothing else.
`current_admissions_cycle_year` already exists on `Settings` (2027 today) and
is served by `GET /v1/config`; it is the one place the cycle is named.

Honesty note: an anchored fact carries `reported_period = "2026-27"` and a
`display` of the bare text as printed. The facts page and the Add School offer
already refuse a deadline whose `reported_period` does not match the student's
cycle, so a page that CollegeData has not rolled forward yet cannot be offered
against the wrong year; it is shown as "November 1 · 2026-27" and nothing more.
That is the same exposure the regular deadline already has.

### A3. Notification dates as dates

In `facts_keys.yaml`, switch `Regular Admission Notification` and `Early Action
Notification` from `scalar, kind: text` to `text_fallback_date`. "Not
reported" already resolves through `absence_display`; prose like "On a rolling
basis beginning December 20" stays text by the handler's last rung.
`deadlines.aid_award_notification` ("On or about April 1") stays text; it is
prose on most pages and is not a date the student acts on.

### A4. Sections, labels, and the deadlines block

- `scripts/build_facts_sections_tabs.py` `_SECTIONS_SOURCE`: add
  `deadlines.early_decision_2` and `deadlines.early_action_2` to the
  `applying/deadlines` group directly after their first-round keys; add labels
  "Early decision II deadline" and "Early action II deadline". Regenerate
  `config/assets/facts_sections.yaml` with the script.
- `app/facts/service.py::_OFFERED_KEY_FOR_DEADLINE`: map the two new keys to
  the same `*_offered` flags so a school that does not offer ED renders "Not
  offered" for ED II as well, and a school that offers ED but prints one date
  renders ED II by the ordinary absence rule (never "Not offered").
- `_deadline_round_label` already strips " deadline"; the new labels produce
  "Early decision II" / "Early action II" rows in `DeadlinesBlock`.
- No doc change: `DATABASE_GUIDE.md` carries no per-key inventory; the key
  list's source of truth is `facts_keys.yaml` plus the regenerated sections.

### A5. Remap and verify

Run `uv run python -m app.facts remap` against the dev database. Acceptance,
by query on `current_school_facts`:

- `deadlines.early_decision` dated rows ≥ 200 (from 91); no row whose
  `display` contains a comma.
- `deadlines.early_decision_2` exists with ≥ 60 dated rows.
- `deadlines.early_action` dated rows ≥ 400 (from 253); `deadlines.early_action_2`
  present.
- Zero `deadlines.early_decision`/`early_action` rows with a bare month-day
  `display` and null `value_date`.
- `deadlines.regular_notification`: report the dated count; no bar, since §1
  has no prose-vs-date breakdown for it. Spot-check that "Not reported" rows
  are absent and "On a rolling basis…" rows stayed text.
- Emory: ED `2026-11-01`, ED II `2027-01-01`. Yale: EA `2026-11-01`, EA
  notification `2026-12-15`, no ED II row. Northwestern: unchanged.
- The mapper fixture suite (`tests/app/facts/test_mapper_fixtures.py`) still
  reports zero unmapped labels across the eleven fixture schools.

## 4. Part B — derived application deadlines

### B1. Backend: effective deadline with a source

`counselle.applications.deadline` and `aid_deadline` keep their meaning as the
student's own value; no migration. The derivation lives in the read path.

`app/workspace/models.py`:

```python
DeadlineSource = Literal["student", "facts"]

class ApplicationView(Application):
    ...
    deadline_source: DeadlineSource | None = None
    deadline_checked_at: Date | None = None      # facts observed_at.date(); facts source only
    aid_deadline_source: DeadlineSource | None = None
    aid_deadline_checked_at: Date | None = None
```

`deadline` on the view is the effective value: the row's own date when set
(source `student`), else the matching facts date (source `facts`), else `None`
(source `None`). `Application` (the bare row model returned by mutations)
is unchanged.

`app/workspace/service_applications.py::_views_from_rows` already batches
identities through `school_identities` in `app/workspace/service_utils.py`,
a parameterized query straight on `catalog.pool`. Add `school_deadline_facts(catalog,
unitids)` beside it in the same file and the same shape: one
`SELECT ... WHERE school_id = ANY($1) AND fact_key = ANY($2)` over
`current_school_facts` (reader role, read-only, the view `get_facts` uses).
Not in `counselle_db/service.py`: that module is the agent's four tools, and a
workspace-only batch read does not belong on that surface.
Keys: the four round deadlines, `deadlines.financial_aid`. Then a pure
function in `domain/`:

```python
# domain/facts/inherit.py  (pure; beside period.py and state.py — ADR 0017)
ROUND_FACT_KEY = {"EA": "deadlines.early_action", "REA": "deadlines.early_action",
                  "ED": "deadlines.early_decision", "ED2": "deadlines.early_decision_2",
                  "RD": "deadlines.regular"}          # Rolling, Priority: no fact
AID_FACT_KEY = "deadlines.financial_aid"

def inherited_date(fact, *, cycle_year: int | None, stale_days: int, now: datetime) -> InheritedDate | None
```

One function, keyed by fact rather than by round: the caller looks up
`ROUND_FACT_KEY[round]` for the application deadline and `AID_FACT_KEY` for
the aid deadline, then passes the matching fact row (or `None`). It returns
`InheritedDate(date, checked_at)` only when all of: `cycle_year` is not `None`
(legacy rows without a cycle exist and are supported by the schema's partial
unique indexes; they never inherit), the fact has a `value_date`, its
`reported_period` equals `deadline_reported_period(cycle_year)` from
`domain/facts/period.py` (the same rule `AddSchoolDialog` enforces today), and
`is_stale(fact.observed_at, stale_days, now=now)` from `domain/facts/state.py`
is false. Any miss returns `None`; a rolling regular deadline is a miss (no
date), which is correct: a rolling school has no deadline to inherit. No new
staleness or period code; both rules already live in `domain/facts/`. REA →
early action is a judgment recorded here once: CollegeData files single-choice
EA under its EA row (Yale), so a student who picked REA inherits that date.

`list_applications`, `get_application_detail`, `_application_view_by_id` all
flow through `_views_from_rows`, so the list, the detail, and mutation receipts
carry the effective value without further changes. `app/workspace/agent_tools.py`
builds `deadline_inherited` for tasks from `app.deadline` of those views, so a
task under an ED application inherits the facts date with no change there.

`render_school_row` (`agent_tools_schools.py`) adds `deadline_source` and
`deadline_checked_at` beside `deadline` when the source is `facts`, so the agent
can say "November 1, from our data checked September 2026" and never present
an inherited date as something the student entered. The `update_school` tool's
docstring gains one line: setting `deadline` overrides the inherited date;
clearing it returns to inheriting.

`_ARCHIVED_SCHOOLS_SQL` (archived rows only) keeps reading the raw column; an
archived school's deadline is not a live commitment and inheriting there adds
nothing.

### B2. Frontend

`frontend/src/api/workspace/types.ts` (hand-written mirror of
`ApplicationView`) gains the four wire fields; `schoolFromApplication` in
`frontend/src/domain/school.ts` maps them onto `School` as `deadlineSource`,
`deadlineCheckedAt`, `aidDeadlineSource`, `aidDeadlineCheckedAt`. The existing
`deadline` stays the effective value, so `DeadlineValue`, sorting, filters and
urgency need no change.

`SchoolWorkspace.tsx` Application deadline field:

- Source `facts`: the input shows the inherited date with a one-line note under
  it, "From Counselle's data, checked Sep 2026", and the field's placeholder is
  the inherited date when the student clears it. Typing a date and committing
  patches `deadline`; the note switches to a "Use Counselle's date" action that
  patches `deadline: null`.
- Source `student`, with a differing inherited date available: same "Use
  Counselle's date" action so a stale override is one click away.
- Source `None`: today's plain input.

That note is the only new copy on the page and is there to prevent a wrong
belief about who set the date, which is the house rule's exception.

`AddSchoolDialog.tsx`: delete the "Use <date>" prefill: the `schoolFacts`
query, the `deadlineOffer` memo, `DEADLINE_FACT_ROUND`,
`DEADLINE_FACTS_STALE_TIME_MS`, `formatMonthYear`, `formatMonthDayYear`, and
the `FactsDeadlineRow`/`SchoolFactsDeadlines` wire types. Keep the file's local
`cycleLabel`; `trackedCycleLabel` still uses it for "Tracked for 2026-27". The dialog's deadline input stays for a student
who wants their own date; left blank, the new row inherits. The dialog's tests
lose the prefill cases and gain none.

Aid deadline gets the same treatment on the detail page via
`deadlines.financial_aid`; the scholarship deadline stays student-only
(CollegeData has no such field).

### B3. Tests that earn their place

- `tests/domain/facts/test_inherit.py`: `inherited_date` — match, cycle
  mismatch → `None`, `cycle_year=None` → `None`, stale → `None`, rolling (no
  date) → `None`; plus `ROUND_FACT_KEY` covers every `Round` that has a fact and
  none that does not. Honesty-critical, so this one is hard-tested.
- `tests/app/facts/test_mapper_handlers.py` (new, small): `text_fallback_date`
  with `second_key` on `"November 1, January 1"`, on a single date, on a pair
  with no `second_key`, and on `"Rolling"`.
- `tests/app/facts/test_service.py`: one case for the ED II row under
  `early_decision_offered = false` → "Not offered".
- `tests/app/test_school_workspace_services_unit.py`: `_views_from_rows` picks
  `student` over `facts`, and `facts` when the column is null.
- Frontend: `SchoolWorkspace.test.tsx` gains the "Use Counselle's date"
  interaction; `AddSchoolDialog.test.tsx` drops the prefill tests.

## 5. Ordered tasks

1. A1 handler + rule + dispatch (`mapper_handlers.py`, `mapper.py`, `facts_keys.yaml`).
2. A2 crawl fallback, including the remap-pass parameter (`crawl.py`).
3. A3 notification rules (`facts_keys.yaml`).
4. A4 sections source + regenerate + `_OFFERED_KEY_FOR_DEADLINE` + guide.
5. Routine suite green; A5 remap on dev DB; record the counts in this file.
6. B1 `domain/facts/inherit.py`, `school_deadline_facts`, view models, `_views_from_rows`,
   `render_school_row`, tool docstring.
7. B2 frontend types, `SchoolWorkspace`, `AddSchoolDialog` deletion.
8. Tests in §B3; `npm run typecheck && npm test`; `ruff` + `mypy`.
9. Live check in a browser on one account: add Emory as ED, see Nov 1 inherited
   with the note; type a date, see it override; clear, see inheritance return;
   confirm a task under it shows `deadline_inherited` in `view_tasks`.

Dependencies: 6 depends on 1–5 landing (the ED2 key must exist for the round
map). 7 depends on 6. Everything in 1–4 is one commit; 5 is an operational step;
6–8 is a second commit.

## 6. Risks

| # | Risk | Handling |
|---|---|---|
| R1 | A page whose cycle CollegeData has not rolled yet gets anchored to the current cycle by A2, producing a date in the past for the *coming* cycle. | The `reported_period` match in `inherited_deadline` and the facts page's cycle check already reject a mismatched period; A2 only affects schools with no ISO regular date, i.e. rolling schools, where the exposure is the early round only. Verified in A5 by spot-checking three rolling schools' EA dates against the live site. |
| R2 | The comma split misfires on a cell that is not two dates ("November 1, or rolling thereafter"). | Both halves must parse as bare month-days or the cell falls through to text, as today. |
| R3 | A student who set a deadline equal to the old prefill now sees `source: student` and a stale value if the school moves. | The "Use Counselle's date" action shows whenever the inherited date differs from the override. No data migration: we do not know which student rows were prefills. |
| R4 | `remap` rewrites facts for 2,239 schools; a handler bug lands store-wide at once. | The fixture suite runs the real mapper over eleven diverse schools first; `remap` is idempotent and re-runnable after a fix. |
| R5 | A batched facts read on every list load. | One query, `school_id = ANY($1)`, over an indexed view, for ≤ 40 schools. Not measured; measure only if the list gets slow. |

## 7. Follow-up (separate plan): official-page deadlines

What CollegeData does not print: REA/SCEA vs EA, ED II at schools that print
only one date, priority and scholarship deadlines, supplemental essay prompts,
and requirement detail beyond the "Other Application Requirements" rows. The
only trustworthy source for those is the school's own admissions site. Shape:
a second adapter beside `adapters/collegedata/` that pulls the admissions
dates page for schools on at least one student's list, extracts typed fields
with a cheap-tier model, and writes the same per-field store with a
`source_url` and `observed_at`, so every value renders "from yale.edu, checked
Sep 2026". Cadence weekly, demand-driven, never site-wide. It needs the owner's
call on model-extraction accuracy measurement before it is planned in detail.

## 8. Files

Modified: `app/facts/mapper_handlers.py`, `app/facts/mapper.py`,
`app/facts/crawl.py`, `app/facts/service.py`, `config/assets/facts_keys.yaml`,
`config/assets/facts_sections.yaml` (generated), `scripts/build_facts_sections_tabs.py`,
`app/workspace/service_utils.py`, `app/workspace/models.py`,
`app/workspace/service_applications.py`, `app/workspace/agent_tools_schools.py`,
`app/workspace/agent_tools_schools_mutations.py` (docstring),
`docs/DATABASE_GUIDE.md`, `frontend/src/features/schools/SchoolWorkspace.tsx`,
`frontend/src/features/schools/AddSchoolDialog.tsx`, `frontend/src/api/workspace/types.ts`,
`frontend/src/domain/school.ts`, their tests.

Created: `domain/facts/inherit.py`, `tests/domain/facts/test_inherit.py`,
`tests/app/facts/test_mapper_handlers.py`.

No migration. No new dependency. No new setting.

### A5 results (2026-09-20)

`uv run python -m app.facts remap`: `facts_remap_pass_finished
facts_changed=1797 run_id=547 schools_seen=2239`. No errors.

Before/after (`current_school_facts`, total / dated):

| Fact | Before | After |
|---|---|---|
| `deadlines.early_decision` | 248 / 91 | 248 / 235 |
| `deadlines.early_decision_2` | 0 / 0 | 117 / 117 |
| `deadlines.early_action` | 480 / 253 | 480 / 461 |
| `deadlines.early_action_2` | 0 / 0 | 61 / 61 |
| `deadlines.regular` | 1821 / 662 | 1821 / 662 |
| `deadlines.regular_notification` | 1453 / 0 | 1453 / 265 |
| `deadlines.early_action_notification` | 403 / 0 | 403 / 360 |

Acceptance:

- `deadlines.early_decision` dated ≥ 200: **PASS** (235).
- Zero `deadlines.early_decision` rows whose `display` contains a comma:
  **FAIL** (9 rows). All 9 are `"Rolling, Rolling"` (8 rows) or `"April 8,
  Rolling"` (1 row) — neither half of these is a bare month-day, so
  `text_fallback_date` correctly falls through to unmapped text per A1's own
  rule ("Anything else falls through to today's behavior unchanged"); this
  is the R2 guard working as designed, not a comma-pair the handler missed.
  Evidence (`school_id`, name, display): `113582` Design Institute of San
  Diego "April 8, Rolling"; `117575` Southern California Seminary "Rolling,
  Rolling"; `199971` Carolina Christian College "Rolling, Rolling"; `204006`
  Miami University-Hamilton "Rolling, Rolling"; `204015` Miami
  University-Middletown "Rolling, Rolling"; `205391` The Modern College of
  Design "Rolling, Rolling"; `138293` Webber International University
  "Rolling, Rolling"; `156189` Alice Lloyd College "Rolling, Rolling";
  `176406` Tougaloo College "Rolling, Rolling". No mapper change attempted —
  per the run instructions, a FAIL is reported with evidence, not patched.
- `deadlines.early_decision_2` present with ≥ 60 dated: **PASS** (117 total,
  117 dated).
- `deadlines.early_action` dated ≥ 400: **PASS** (461).
- `deadlines.early_action_2` present: **PASS** (61 total).
- Zero `deadlines.early_decision`/`early_action` rows with null `value_date`
  whose `display` matches `^[A-Z][a-z]+ \d{1,2}$`: **PASS** (0 rows).
- `deadlines.regular_notification` dated: 265. `deadlines.early_action_notification`
  dated: 360. Zero rows with `display = 'Not reported'` carrying a
  `value_date` in either key: **PASS** (0 / 0). Example rows that stayed
  text: `regular_notification` — school 192785 "Rolling, notification
  begins September 1"; school 457697 "Rolling"; school 458113 "Rolling".
  `early_action_notification` — school 117168 "Rolling"; school 196088
  "Rolling"; school 117575 "Rolling".
- Emory University (id 139658): ED `2026-11-01` ("November 1"), ED II
  `2027-01-01` ("January 1"): **PASS**. Yale University (id 130794): EA
  `2026-11-01` ("November 1"), `early_action_notification` `2026-12-15`
  ("December 15"), no `early_decision_2` row: **PASS**. Northwestern
  University (id 147767): ED `2026-11-01` ("November 1") only, unchanged:
  **PASS**.
- R1 rolling-regular spot check (regular `value_date IS NULL`, dated EA
  present): Belmont Abbey College — EA "October 31", `2026-10-31`,
  `2026-27`; Molloy University — EA "December 1", `2026-12-01`, `2026-27`;
  Roberts Wesleyan University — EA "November 15", `2026-11-15`, `2026-27`.
  Reported only, no live-site check performed.
- `uv run pytest tests/app/facts/test_mapper_fixtures.py -q`: **PASS** (8
  passed).

Overall: 10 of 11 acceptance items PASS; 1 FAIL (the comma-display check),
and that FAIL is the R2 guard behaving correctly against non-date comma
pairs the §3 A5 checklist didn't anticipate — not a mapper defect.
