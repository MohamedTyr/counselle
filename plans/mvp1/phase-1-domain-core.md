# Phase 1 — Domain core (the pure honesty engine)

**Branch:** `feat/p1-domain-core`
**Objective:** the `domain/` package per ADR 0017 — pure functions and Pydantic models, **zero I/O, zero LLM, zero framework imports** (stdlib + pydantic only; enforce with a test that scans `domain/` imports). This is the most-tested code in the repo; `docs/DATABASE_GUIDE.md` §6 is the literal spec for the normalization engine. **TDD: builder agents write the tests in this file FIRST, watch them fail, then implement.**

## Inputs for builder agents
- `docs/DATABASE_GUIDE.md` §6 (reading rules — the spec), §9 (provenance/vintage), §12 (CDS coverage), §7 (shortlist context).
- `docs/ARCHITECTURE.md` §9 (envelope), §16 (temporal), §6 (event types), §12.1 (clarify spec), §17 (render spec).

## Work breakdown

### Slice A — types (`domain/envelope.py`, `domain/specs.py`, `domain/events.py`)

`domain/envelope.py`:
```python
SourceName = Literal["ipeds", "scorecard", "cds", "web", "edu", "reddit"]
Tier = Literal["official", "community"]

class Citation(BaseModel):
    source: SourceName
    tier: Tier
    vintage: str                    # human string, e.g. "IPEDS 2024-25 (provisional)"
    caveat: str | None = None
    raw_table: str | None = None
    url: str | None = None          # for web/edu/reddit sources

class CitationEnvelope(BaseModel):
    v: int = 1
    field: str                      # field key or pseudo-key (e.g. "web.search_result")
    label: str
    display: str                    # ALWAYS set; "not available" when available=False
    raw: float | int | bool | str | None = None
    available: bool
    unit: Literal["percent","currency","count","number","bool","text","date"] | None
    citation: Citation
```

`domain/specs.py` — `SourceConfig` (web: bool, reddit: bool, reddit_subreddits: list[str] | None  # None = full menu, edu: bool; classmethod `defaults_from(settings-ish mapping)`), `ClarifySpec` (v:int=1, question, header, multi_select: bool, options: list[ClarifyOption(label, hint)] — 2–4 enforced by validator; "Other" is NOT in options, the widget adds it), `RenderSpec` (v:int=1, type: Literal["stat_block","comparison_table","score_band"], title, schools: list[SchoolRef(unitid:int, name:str)], rows: list[VizRow(label, cells: list[CitationEnvelope])], band: ScoreBand | None — for score_band: test: Literal["sat","act","both"], per-section bands as rows; validator: score_band must NOT contain any cell whose field implies a summed SAT composite — reject field pairs (sat_ebrw_*, sat_math_*) combined into one row labeled composite).

`domain/events.py` — the protocol event types (ARCHITECTURE §6): `Event(v:int=1, type: Literal["meta","delta","viz","clarify","sources","usage","done","error"], data: dict)` plus typed payload models `MetaData(trace_id, session_id, model)`, `DeltaData(text)`, `SourcesData(sources: list[SourceEntry(index:int, citation: Citation, label:str)])`, `UsageData(input_tokens:int, output_tokens:int, est_cost_usd: float | None, tool_calls:int)`, `DoneData(status: Literal["complete","awaiting_input"])`, `ErrorData(message, trace_id)`. Helper constructors `ev_delta(text) -> Event` etc.

### Slice B — the normalization engine (`domain/normalize.py`) — THE honesty core

Interface (everything a caller must know):
```python
class FieldMeta(BaseModel):     # mirrors public.fields columns the engine needs
    key: str; label: str; category: str | None
    data_type: Literal["int","number","percent","currency","text","bool","date","json"]
    source: Literal["ipeds","scorecard","cds"]
    raw_table: str | None; raw_column: str | None

class NormalizedValue(BaseModel):
    display: str; raw: float | int | bool | str | None
    available: bool; unit: str | None; decoded_label: str | None = None
    extra_caveat: str | None = None   # e.g. national-benchmark warning

def normalize(meta: FieldMeta, value: Any, decode_map: Mapping[str, str] | None = None) -> NormalizedValue
```
`value` is the raw jsonb payload **already json-decoded to a Python object** (callers normalize psycopg2-vs-asyncpg differences before this point — DATABASE_GUIDE §2). `decode_map` is the code→label mapping for this field's raw column when one exists (fetched by the DB layer; the engine stays pure).

Behavior, rule by rule (each → tests in Slice D):
- **R3/NULL:** `value is None` → `available=False, display="not available"`, raw=None. Never anything else.
- **percent (R2):** fraction ×100; format: **one decimal, strip a trailing `.0`** (`0.0361→"3.6%"`, `0.58→"58%"`, `0.587→"58.7%"`) — never round away real precision (eng-review); raw keeps the fraction.
- **currency (R5):** round half-up to whole dollars, thousands separators, keep sign: `59885.0→"$59,885"`, `17146.5→"$17,147"`, `-2536.0→"-$2,536"`. raw = the float.
- **int (R6+R1):** parse `round(Decimal(value))`; if `decode_map` provided and the code is a key → `display=decoded_label` (e.g. CONTROL `2→"Private not-for-profit"`, ADMCON7 `1→"Required"/3→"Test-Blind"/5→"Test-Optional"`); else thousands-formatted integer (`6370.0000…→"6,370"`, `790→"790"`).
- **number:** trim to ≤2 meaningful decimals (`318.67→"318.67"`, `3.85→"3.85"`, `15.0→"15"`).
- **bool:** `true→"Yes"`, `false→"No"`.
- **text (R4/R7/R8):**
  - sentinel `"-2"` for `institution.system_name` → `display="Not part of a system"`, available=True, raw=None.
  - **BBRR range tokens** (any field whose `raw_column` starts with `BBRR` or key matches `outcomes.bbrr*`): plain decimal string `"0.03"` → percent path → `"3%"`; token containing `<` or `-` → `"<=0.05"→"≤ 5% (reported as a range)"`, `"0.05-0.09"→"5%–9% (reported as a range)"`; **never arithmetic on tokens** (raw=None for tokens).
  - CDS enum strings (source=="cds"): `"considered_if_submitted"→"Considered if submitted"` (replace `_`→space, capitalize first letter only).
  - URLs (key ends `.website` or `.admissions_url` or value matches `^www\.`): prepend `https://` when scheme-less; never `http://`.
  - otherwise passthrough.
- **R9/benchmark guard:** field keys containing `_all_institutions` (and `cost.median_net_price_all_institutions`) → `extra_caveat="National benchmark across all institutions — not this school's own value."`
- Unknown data_type / unparseable value → `available=False, display="not available"` **plus** the function returns normally (no exceptions for data weirdness; raise only on programmer error like a None meta).
- **R11/R12 are selection rules, not transforms** — they live in the dossier shortlist asset + the source-preference table below; document in the module docstring.

Also in this module: `SOURCE_PREFERENCE` — the R9 table from DATABASE_GUIDE §6 (acceptance rate → scorecard `admissions.acceptance_rate` over ipeds `admit_rate_total`; undergrad headcount → `enrollment.undergrad_total`; median earnings → `earnings.median_4yr_postcompletion`, never `*_all_institutions`; test policy → `cds.c8a_test_policy` then decoded ADMCON7; HBCU → `institution.hbcu` bool over coded `is_hbcu`), exposed as `preferred_field(concept) -> list[str]` for the DB layer and skills.

### Slice C — vintage, tiers, season (`domain/vintage.py`, `domain/tiers.py`, `domain/season.py`)

`vintage.py`:
```python
def vintage_for(source, cycle_year, *, scorecard_filename: str | None = None,
                field_key: str | None = None) -> Citation-parts (vintage: str, caveat: str | None)
```
- `("ipeds", 2024)` → `"IPEDS 2024-25 (provisional)"`; `("ipeds", 2023)` → `"IPEDS 2023-24 financial-aid data"`; generic: `f"IPEDS {y}-{y+1-2000:02d}"` + "(provisional)" for the current vintage.
- `("scorecard", None)` → parse `MMDDYYYY` from filename (`College_Scorecard_Raw_Data_03232026.zip` → `"College Scorecard, published Mar 2026"`); **earnings lag:** if field_key matches `earnings.*_(\d+)yr*` → caveat `f"Earnings reflect students who entered around {pub_year - N}, not current students."` (`_10yr` + 2026 → ~2016 — DATABASE_GUIDE §9).
- `("cds", 2024)` → `"2024-25 Common Data Set filed by the school"`.

`tiers.py`: `CoverageTier = Literal["base","cds_pdf_only","cds_extracted"]`; `compute_tier(cds_extracted_count: int, has_cds_pdf: bool) -> CoverageTier` (count>0 → extracted; pdf only → pdf_only; else base — the Stanford trap means the *count*, never `extract_status`, decides; DATABASE_GUIDE §14.6). Plus `tier_explanation(tier) -> str` (one student-readable sentence each, used in prompts).

`season.py`: `admission_season(today: date, calendar: list[SeasonWindow]) -> Season(phase: str, description: str, entering_class: str  # e.g. "Fall 2027", cycle_note: str)` — pure lookup over the `season_calendar.yaml` rows (passed in, not read from disk — purity). Entering-class rule per ARCHITECTURE §16: Jun–Dec belong to the cycle entering fall of `today.year + 1`; Jan–May to fall of `today.year`.

### Slice D — the test suite (written FIRST; the other slices make it pass)

`tests/domain/test_normalize.py` — minimum vectors (one test each, AAA style, behavior-named):
1. `0.0361` percent → `"3.6%"`, raw `0.0361`; 2. `0.58` → `"58%"`; 3. None → not-available; 4. missing-row convention documented (caller passes None); 5. `59885.0` currency; 6. `17146.5` rounds to `"$17,147"`; 7. `-2536.0` keeps sign; 8. `6370.0000000000000000` int → `"6,370"`; 9. CONTROL 2 + decode_map → decoded label, raw stays 2; 10. ADMCON7 5 → "Test-Optional"; 11. int with no decode_map → plain count (SAT 790); 12. bool true → "Yes"; 13. CDS `"considered_if_submitted"` → "Considered if submitted"; 14. system_name `"-2"` sentinel; 15. BBRR `"0.03"` → `"3%"`; 16. BBRR `"<=0.05"` → range text, raw None; 17. BBRR `"0.05-0.09"` → range text; 18. `"www.duke.edu"` → `"https://www.duke.edu"`; 19. already-https URL unchanged; 20. `_all_institutions` benchmark caveat present; 21. number `318.67`; 22. garbage value → not-available, no exception; 23. `preferred_field("acceptance_rate")[0] == "admissions.acceptance_rate"`.

`tests/domain/test_vintage.py`: the four source mappings above + the `_10yr→~2016` lag caveat + `_4yr→~2022`.
`tests/domain/test_tiers.py`: (249, True)→extracted; (0, True)→pdf_only (Stanford); (0, False)→base.
`tests/domain/test_season.py`: 2026-06-10→(pre-application, "Fall 2027"); 2026-11-05→(early deadlines, "Fall 2027"); 2026-04-15→(decision/choose, "Fall 2026"); boundary days (Jun 1, May 31).
`tests/domain/test_specs.py`: ClarifySpec rejects 1 or 5 options; RenderSpec score_band rejects a fabricated SAT-composite row; Event serializes with `v`.
`tests/domain/test_purity.py`: walk `domain/*.py` ASTs — no imports outside stdlib+pydantic.
`tests/domain/test_normalize_properties.py` **(eng-review D7; `uv add --dev hypothesis`):** property-based invariants over generated `(data_type, value)` pairs (floats incl. nan/inf, ints, strings incl. tokens/URLs/garbage, bools, None, lists, dicts): (1) `normalize` **never raises**; (2) `display` is always a non-empty `str`; (3) `available=False` ⇒ `display=="not available"`; (4) when a `decode_map` is supplied and the value is a key, `display` is never the bare code.

## Live verification
None (pure code). Full suite + mypy strict on `domain/`.

## Try it yourself (user)
```bash
uv run pytest tests/domain -q          # ~35+ tests, all green
uv run python -c "
from domain.normalize import normalize, FieldMeta
m = FieldMeta(key='admissions.acceptance_rate', label='Acceptance Rate', category='admissions', data_type='percent', source='scorecard', raw_table='raw.scorecard_institution', raw_column='ADM_RATE')
print(normalize(m, 0.0361))"           # display='3.6%'
```

## Gate checklist
- [ ] Every numbered test vector above exists and passes; tests were written before implementation (TDD).
- [ ] Purity test passes (no I/O/framework imports in `domain/`).
- [ ] mypy strict clean on `domain/`.
- [ ] Every R1–R12 rule is either implemented or explicitly documented as a selection rule with its home named.

## Milestone commit
```
feat(domain): pure honesty core — envelope, normalization R1-R12, vintage, tiers, season, spec types

DATABASE_GUIDE §6 implemented as code with full behavioral test coverage;
zero I/O imports (enforced by test). ADR 0006/0017.
```
