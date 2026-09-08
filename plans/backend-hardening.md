# Backend Hardening Plan

**Status:** ready for review · **Date:** 2026-09-01 · **Branch target:** `fix/backend-hardening`

Produced from a nine-scope deep audit of the full backend. Source reports live in
`artifacts/backend-audit/` (5,400+ lines of evidence). This plan is the actionable distillation:
every issue, why it is an issue, and the exact surgical edit that closes it.

---

## 0. What this plan is, and what it is not

**It is:** a list of surgical edits to working, shipped code built over ~3 months. Every fix below
is expressible as a before/after snippet on named lines, or a deletion of a named line range.

**It is not:** a rewrite, a restructure, a migration, or a refactor. No new abstractions, no new
modules, no re-layering, no "extract a service". Nothing in this plan reorganizes code that works.

**Pointer convention (used throughout).** A bare `§N` always means **a section of this file**.
A rule from the audit brief is written **`constraints §N`** and refers to
`artifacts/backend-audit/00-constraints.md`. Any other document's section is named
(`DATABASE_GUIDE §6`, `01a §5.2`). An earlier draft mixed the first two and several pointers
resolved to the wrong document; they are corrected throughout.

### 0.1 The hardest rule — behavior preservation

**Observable app behavior MUST NOT change — unless the behavior *is* the bug.**

Every finding carries a mandatory `Behavior impact:` line, exactly one of:
- `NONE — behavior-neutral` — same inputs → same outputs, same SSE sequence, same rows, same codes.
- `INTENDED — <old> → <new>, because <why the old behavior is the defect>`

A fix is **invalid** if it silently changes a response shape, status code, error message, SSE event
sequence, persisted row, default/limit/threshold, or any prompt/skill/tool-description text
(those steer the model, so editing them *is* a behavior change).

**Corollary:** "this looks wrong but nothing depends on it" is not licence to change it. If it is
genuinely dead, delete it — deletion is behavior-neutral. If it is live, changing it needs a real
bug behind it.

### 0.2 Counts

**These counts are derived from the per-finding `Behavior impact:` labels, not asserted alongside
them.** An earlier draft asserted them independently and they did not reconcile — the category table
summed to 52 while the label counts summed to 43, and "owner decisions: 4" sat beside a §14 that had
a fifth dangling below its table. If a count below ever disagrees with the labels, **the labels win**
and the count is the bug.

| Category | Count | Where |
|---|---|---|
| Honesty-critical (a student is shown something false) | 6 | §3: H3, H2, W1, R5, R3, D2 |
| Data-integrity / correctness bugs | 14 | §4: L1, L4, P1, P2/P3, P4, P5, W2, W3, L2, L3, R2, P6, P12, L6 |
| Security | 4 | §5: S1, S2, Z1, Z2+Z3 |
| Red quality gates (8 test failures + 3 mypy errors) | 11 | §6 |
| Dead code / duplication / cheap wins | 11 | §7: L5, D3, D4, H4, S3, S4, R7, P8, P9, P10 (comment only), P11 *(was 13 — D1 merged into D2 Part A, P7 cut; P10 was briefly promoted to a decision and is back as a comment-only row, with its typed-shape half cut to §13)* |
| Honesty tests that must exist | 4 | §8: T8, H1, H3, R3's pin *(was 3; R3's pin was proposed but uncounted)* |
| Latent CRITICAL | 1 | §9: H1 |
| **Owner decisions required (not decided here)** | **6** | §14: 1 H3 · 2 H2-display · 3 edition spelling · 4 W2 shape · 5 R3/ADR · 6 L4/`TODOS.md` |

**Behavior-neutral (`NONE`): 21** — the 8 Phase A test rows, D2 Part A, W3 (no fix ships), T2, T7,
D3, D4, H4, S3, R7, P8, P9, P10 (comment only), P11.
**Intended behavior changes (`INTENDED`): 27** — H3, H2, W1, R5, R3, D2 Part B, L1, L4, P1, P2/P3,
P4, P5, W2, L2, L3, R2, P6, P12, L6, S1, S2, Z1, Z2, Z3, L5, S4, H1.

**How the 6 owner decisions relate to those 27** — stated exactly, because an earlier draft said
"seven of those 27 are gated" and only some of the named items were members of the list at all:
- **Decision 1 (H3) gates nothing.** H3 ships by default in Phase B and is one of the 27; the
  decision is whether the owner overrides that default, not whether anything ships.
- **Four of the 27 are gated and ship nothing until their decision is made:** R3 (decision 5),
  D2 Part B (3), W2 (4), L4 (6).
- **Two further gated items carry no `INTENDED` label today**, so they are in neither enumeration:
  **H2's display leg** (decision 2) is unlabelled until an option is chosen — the `INTENDED` H2 entry
  above is its carry-through, which ships in Phase B regardless; and **W3's replacement fix**
  (unblocked by decision 4) sits under a `NONE` label precisely because no fix ships for W3.
- **P10 is in neither list and is no longer a decision** — its comment correction is in the `NONE`
  enumeration above, and its typed-shape half is cut to §13 as not-schedulable.

---

## 1. ⛔ Read this before touching anything: three of eight test failures looked like regressions and were not

The routine suite is **RED on clean `main`: 8 failed, 1743 passed** (`.env` not sourced, so these
are not the known env-leak artifacts). `ruff` is clean; `mypy` has 3 errors.

**Seven of the eight failures are stale tests with no production regression behind them.**

I initially mis-diagnosed two of them from the failure output alone, and the mis-diagnosis was
dangerous in both directions. It is recorded in `artifacts/backend-audit/00-baseline.md` §B-CORRECTION
so the error is auditable:

- I read the golden-fixture drift as "source tiering is inconsistent in production" and would have
  changed `_citation_for_web_result` to emit `official` for a third-party URL. That would have
  **reverted commit `0fb1740` ("fix: mark third-party web citations as community") and labelled
  every content farm as an official source** — manufacturing the exact honesty defect I thought I
  was fixing.
- I read the `.edu` catalog gate as a silent feature outage. It is deliberate, added alongside
  `EmptyCatalog` whose `school_domain()` always returns `None`, so the tool could only ever fail.

**The rule this encodes, and it is binding for every red test in §6:**

> A failing test has two possible causes. `git log`/`git blame` **on the changed line** — not the
> failure message — is what distinguishes them. "Fixing" a stale test hides a regression;
> "fixing" code to satisfy a stale test creates one. State the verdict and the evidence for each.

**Root cause of 4 of the 8 failures:** commit `55509d3` ("chore: prepare temporary render demo
deploy") changed 11 files and **touched zero test files**. It introduced both
`settings.cds_data_enabled` and the `.edu` catalog gate.

---

## 2. Verified baseline

```
uv run pytest -m "not live_llm and not live_search and not live_db"
→ 8 failed, 1743 passed, 234 deselected

uv run ruff check .   → clean
uv run mypy .         → 3 errors (all in scripts/finish_render_staging.py — noise, see T2)
```

Independently verified by the orchestrator against the live DB (`localhost:5433`):

- **H3 is real and live today** — exactly 1 row: UPenn, `value=0`, `raw_value='- '`.
- **H1 is genuinely latent** — 0 of 65 active packets sit on a non-current manifest.
- **`setup_db.sql:81` contains the role-hardening line** the failing test claims is missing (it was
  parameterized to `:"target_database"`; the test still asserts the literal `counselle_data`).

---

## 3. TIER 0 — Honesty-critical

CLAUDE.md principle 3 has one non-negotiable carve-out: **never lie to a student.** These are the
highest-priority items in the plan regardless of effort.

### H3 — A not-reported dash is served as a reported zero *(CRITICAL, LIVE TODAY)*

**Location:** `counselle_db/packets.py:361-380` (`_display`), fix goes at `:295-304`
**Full evidence:** `artifacts/backend-audit/04a-honesty-core.md` § H3

`_display` validates the *typed* value then returns the extractor's raw string verbatim:

```python
def _display(metric: ParsedMetric, definition: ManifestMetric) -> str:
    _validate_typed_value(metric.value, definition)     # checks TYPE only
    if metric.raw_value is not None and metric.raw_value.strip():
        return metric.raw_value.strip()                 # returns the RAW STRING
```

Nothing compares `raw_value` to `value`. `read_metric` then puts both on the same row —
`display` (the raw string) and `value` (the typed number) — and both travel to the client.

**Concrete failure, verified on live data:**

| school | ref | typed `value` | `raw_value` |
|---|---|---:|---|
| U. of Pennsylvania | `financial_aid.h2_g_awarded_non_need_based_grant_aid_first_time_first_year` | **`0`** | **`'- '`** |

UPenn's CDS prints `-` — the standard marker for a cell the school did not report. It is stored
`verified`/`reported`, `value=0`. The student sees `-`; **every machine consumer sees `0`**: charts,
the agent's own reasoning, and `query_database` candidate rankings (the recipe `DATABASE_GUIDE` §8
explicitly blesses). A cross-school ranking will report UPenn as *awarding zero non-need-based
grant aid* — a factual claim about UPenn's aid policy that its CDS never makes.

This is verbatim `DATABASE_GUIDE` §9's prohibition: *"never … convert unavailable to zero"*.

**Surgical fix** — reject at the declared anti-corruption boundary rather than repairing downstream.
`counselle_db/packets.py:295-304`, inside the existing per-metric validation sweep:

```python
        try:
            if metric.extraction_status == "verified" and metric.availability_status == "reported":
                _display(metric, definitions[ref])
                # DATABASE_GUIDE §9: never convert unavailable to zero.  A raw cell that
                # carries no digits (a CDS "-"/"N/A" dash) is not a reported number, no
                # matter what the extractor typed alongside it.
                if (
                    definitions[ref].type in {"integer", "number"}
                    and metric.raw_value is not None
                    and metric.raw_value.strip()
                    and not any(char.isdigit() for char in metric.raw_value)
                ):
                    raise ValueError("non-numeric raw for a reported numeric metric")
        except ValueError:
            raise _reject("metric_value_type_invalid", row) from None
```

The digit test is deliberately loose: `"7 to 1"`, `"2.00"`, `"24.33%"`, `"98%"` all still pass; only
genuinely digit-free cells (`-`, `N/A`, `—`) fail.

**The `metric.raw_value.strip()` condition is load-bearing, not decoration.** `_display`
(`counselle_db/packets.py:363`) returns the raw string **only** when
`metric.raw_value is not None and metric.raw_value.strip()`; for `""` or `"   "` it falls through to
the typed formatter and renders the honest typed value — no lie, nothing to reject. Without the strip
test the guard would fire on those rows too, and since this is **fail-closed**, a false positive
costs a whole school-domain. The guard must match `_display`'s own branch condition exactly. *(The
enumeration query below already covers this case — `'' !~ '[0-9]'` is TRUE — and returned exactly one
row, so it is not live today; the condition is there so it stays that way.)*

**Behavior impact:** `INTENDED — a verified+reported numeric metric whose raw_value contains no digit
(today: exactly one row, UPenn) changes from "student shown '-' while machines see 0" to "the whole
domain packet is rejected with the existing _SAFE_PACKET_ERROR and cds_packet_rejected is logged",
because presenting a not-reported dash as a reported zero is the §9 prohibition.`

> ### ⚠️ OWNER DECISION 1 — blast radius of the rejection is domain-wide
> One bad metric drops UPenn's **entire `financial_aid` domain**, not just that metric. That is the
> existing deliberate shape of every other `_reject` in this function (fail closed rather than
> serve a corrupt packet), so it is consistent — but it **is** a visible availability regression for
> one school-domain. The underlying row should be corrected through the CDS admin `active_update`
> flow, which is **out of scope for this plan and owned by a separate agent** (constraints §5).
>
> **Default: ship the guard now**, accept the one-school-domain availability loss, and file the UPenn
> row correction as a separate note for the CDS-admin owner. An earlier draft recommended the
> reverse — fix the data first, then ship — which would have gated **the highest-priority honesty fix
> in this plan on another agent's excluded surface.** **Constraints §5** excludes that tool precisely so this plan
> does not take a dependency on it. "Fix the data first" remains available as the owner's
> alternative; it is no longer the recommendation.

**Fix risk:** MEDIUM — fail-closed, so a false positive removes real data. **Enumerate before
applying** (currently returns exactly 1 row; if it has grown, fix the data first):

```sql
WITH cur AS (SELECT content FROM cds_library.cds_manifest_snapshots WHERE is_current),
defs AS (SELECT mm->>'id' ref, mm->>'type' typ FROM cur,
  LATERAL jsonb_array_elements(content->'domains') d, LATERAL jsonb_array_elements(d->'metrics') mm),
ex AS (SELECT p.school_id, p.domain_id, e.key ref, e.val val
       FROM cds_library.active_cds_domain_packets p,
            LATERAL jsonb_each(p.packet->'metrics') e(key,val) WHERE p.packet IS NOT NULL)
SELECT s.name, ex.domain_id, ex.ref, ex.val->>'value', ex.val->>'raw_value'
FROM ex JOIN defs ON defs.ref=ex.ref JOIN cds_library.school_profiles s ON s.id=ex.school_id
WHERE defs.typ IN ('integer','number') AND ex.val->>'extraction_status'='verified'
  AND ex.val->>'availability_status'='reported' AND ex.val->>'raw_value' !~ '[0-9]';
```

**Effort:** 30 min. **Confidence:** HIGH (row verified in production).

**Deliberately NOT fixed here** — two related legs are *precision/scale* disagreements, not
fabrications, and need a product decision (does `ratio` mean 0–1 or 0–100?):
- Pitzer's borrower share displays `24.33%`, reasons as `24`.
- Harvard's graduation rate displays `98%`, `raw` is `0.98` — so `app/viz.py:190` plots it on a
  different scale from `percent` metrics stored 0–100.
These compound with H2; see **Owner Decision 2**.

---

### H2 — Money and percentages reach the student as bare, unmarked numbers *(HIGH, LIVE TODAY)*

**Location:** `counselle_db/models.py:99-108`, `counselle_db/packets.py:454-477`, `domain/envelope.py:18,129`
**Full evidence:** `artifacts/backend-audit/04a-honesty-core.md` § H2

The manifest carries a per-metric `unit` and the packet parser reads it — but `DomainRow` has no
`unit` field, so `read_metric` drops it. `CitationEnvelope.unit` exists and is on the wire, yet
**none of its 8 construction sites passes it**; it is always `null` on the student path.

**Live data:** 52 of 125 `usd` metrics and 8 of 20 `percent` metrics have no `raw_value`, so
`_display` falls through to a bare number:

| school | ref | unit | shown to student |
|---|---|---|---|
| Harvard | `cost.food_and_housing_on_campus_first_year` | `usd` | **`22130`** |
| Harvard | `admissions.application_fee_amount` | `usd` | **`85`** |
| Yale | `financial_aid.h2_i_average_percent_need_met_all_full_time` | `percent` | **`100`** |

No `$`, no separator, no machine-readable unit for any client to repair it. Note the perverse
asymmetry: because these are typed `number` not `integer`, they do not even get the `f"{value:,}"`
grouping plain counts get — **a dollar amount renders less legibly than a headcount.** Yale's
need-met reads as bare `100`, which a student can take as "100 students", "$100", or a rank.

**Surgical fix** — three additive lines plus one deletion:

1. `counselle_db/models.py:99-108` — add one field to `DomainRow`:
```python
    availability_status: str | None = None
    unit: str | None = None            # the manifest's declared unit for this metric
    value: Any = None
```
2. `counselle_db/packets.py:454-462` — carry it through:
```python
        availability_status=metric.availability_status,
        unit=definition.unit,          # ADD
```
3. Pass the unit at the three CDS-row envelope sites. **Two of the three take a `DomainRow`; the
   third does not** — `app/tool_middleware.py:70-77` iterates `result["rows"]`, the **MCP JSON
   payload**, where `row` is a plain `dict`. Writing `row.unit` there is an `AttributeError` at
   runtime on the primary agent read path:
   - `app/viz.py:186-190` — `unit=row.unit,` (a `DomainRow`) ✓
   - `app/workspace/service_reference.py:167-171` — `unit=row.unit,` (a `DomainRow`) ✓
   - `app/tool_middleware.py:73-77` — **`unit=row.get("unit"),`** (a `dict`)
4. `domain/envelope.py:18` — **delete** the `Unit` literal. It is provably dead (zero references
   outside its own definition) *and* its vocabulary (`currency`, `bool`, `text`) does not match the
   manifest's real one (`usd`, `ratio`, `carnegie_units`, `students`, `weeks`, …). Hardcoding a
   unit enum would violate ADR 0032's "the catalog is dynamic". `unit: str | None` stays a free
   string sourced from the manifest.

**Behavior impact:** `INTENDED — (a) CitationEnvelope.unit for CDS domain values changes from always
null to the manifest's declared unit string, and (b) every metric row of every get_domain MCP result
gains a "unit" key, because shipping a currency or percentage as an unmarked bare number with no
machine-readable unit is a value-honesty defect under DATABASE_GUIDE §6 and ADR 0006.` Deleting
`domain/envelope.py:18` is `NONE — behavior-neutral` (proven-dead alias).
**Rendered `display` strings are deliberately unchanged** — see Owner Decision 2.

> **⚠️ Leg (b) is a model-visible change, and it re-stales the goldens Phase A just regenerated.**
> `counselle_db/server.py:184-186` returns `(await service.get_domain(...)).model_dump(mode="json")`,
> so a new `DomainRow` field is **not** invisible: it appears as a new `"unit"` key on every metric
> row in the JSON **the model itself reads**, and in the payload `app/tool_overflow.py` budgets.
> Under §0.1 that is a behavior change, which is why it is named in the label above. An earlier draft
> claimed "no existing caller reads it" — **that claim is false and has been struck; the model reads
> it.** Consequence for execution: H2 lands in Phase B, *after* Phase A regenerated the protocol
> goldens, so if those fixtures cover `get_domain` rows they go red again on H2. **H2 requires a
> second `REGEN_PROTOCOL_FIXTURES=1` pass plus the `cd frontend && npm test -- protocol-fixtures`
> step, under the same §6 field-by-field diff discipline.** This dependency is recorded in §10 Phase B
> and §11.

**Frontend blast radius (grepped, per §6):** `frontend/src/api/chat/types.ts:54` types
`unit?: string | null` and `frontend/src/api/chat/validation.ts:239-266` validates it, but **no
non-test frontend site renders `envelope.unit`** — the `unit` hits in
`features/schools/explore/explore-config.ts` are a separate, unrelated local descriptor type. So the
wire contract is unchanged *and* nothing a student sees changes from this leg. That is what keeps
Owner Decision 2 (display formatting) genuinely open rather than partly pre-empted.

> ### ⚠️ OWNER DECISION 2 — do we interpolate the unit into `display`?
> Making Harvard's cost render `"$22,130"` and Yale's `"100%"` is the visibly-correct end state, but
> it would **double-mark** the 152 metrics whose `raw_value` already contains the symbol (e.g. `"7%"`).
> That needs a unit→format map and its own decision, and it compounds with H3's `ratio` scale
> question. Carrying the unit onto the row (above) is the prerequisite and is unambiguously correct
> on its own. **Recommendation: ship the carry-through now, decide display formatting separately.**

**Fix risk:** LOW-MEDIUM — the field itself is additive and optional with a `None` default on a frozen
model, and the frontend already types `unit?: string | null`, so there is no wire-contract change. The
risk that is real is the one above: the key is model-visible and re-stales the goldens, so the
regeneration step must not be skipped.
**Effort:** 45 min + the second fixture regeneration. **Confidence:** HIGH.

---

### W1 — A student's essay body is rewritten with text they never wrote *(DATA-INTEGRITY, empirically proven)*

**Location:** `app/workspace/essay_markdown.py:318-322` (`_serialize_leaf`)
**Full evidence:** `artifacts/backend-audit/01c-essay-memory-mounting.md` § W1

```python
    link = next((m for m in marks if m["type"] == "link"), None)
    if link is not None:
        href = (link.get("attrs") or {}).get("href", "")
        text = f"[{text}]({href})"
```

`href` is interpolated **raw**. CommonMark only accepts an unescaped destination with no ASCII
space and balanced parens; otherwise the construct is not a link and re-parses as literal text.

**Measured, end to end through `apply_edits`** — and it triggers on editing a *different* paragraph,
because `_align_container` keys on rendered markdown and `render(parse(render(x))) != render(x)`
here, so the untouched block is silently rebuilt from the corrupted reparse:

```
href='http://a.com/x y'  → student's essay literally reads:  [click](http://a.com/x y)
href='http://a.com/a)b'  → paragraph text becomes 'clickb)'  ← GAINS junk text, href truncates
```

Also measured broken: `'/relative path/x'`, `'http://a.com/a(b'`, any href with a newline. The
editor is Tiptap StarterKit with the Link extension, so any pasted rich-text anchor can carry one.
*(The newline case is broken today and **stays** broken after the fix below — see "What this fix does
and does not cover".)*

**Surgical fix** — use CommonMark's angle-bracket destination form when the bare form won't survive:

```python
    link = next((m for m in marks if m["type"] == "link"), None)
    if link is not None:
        href = (link.get("attrs") or {}).get("href", "")
        text = f"[{text}]({_link_destination(href)})"


_UNSAFE_BARE_HREF = re.compile(r"[ \t\n<>]")


def _link_destination(href: str) -> str:
    """Angle-bracket form for destinations CommonMark won't take bare."""
    if _UNSAFE_BARE_HREF.search(href) or not _parens_balanced(href):
        return "<" + href.replace("\\", "\\\\").replace("<", "\\<").replace(">", "\\>") + ">"
    return href


def _parens_balanced(href: str) -> bool:
    depth = 0
    for ch in href:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0
```

**What this fix does and does not cover** — measured with the proposed `_link_destination` in place,
end to end through the real `to_markdown`/`to_tiptap`:

```
href='http://a.com/a)b'   -> text='click'  href='http://a.com/a)b'    stable=True   FIXED
href='http://a.com/a(b'   -> text='click'  href='http://a.com/a(b'    stable=True   FIXED
href='http://a.com/x y'   -> text='click'  href='http://a.com/x%20y'  stable=False  prose fixed, href normalized
href='/relative path/x'   -> text='click'  href='/relative%20path/x'  stable=False  prose fixed, href normalized
href='http://a.com/x\ny'  -> text='[click](<http://a.com/x y>)'       stable=False  NOT FIXED
```

- **The two paren cases are fully fixed** — link and href both survive, and the round trip is stable.
- **The space cases: the prose corruption is fixed, but the href is silently percent-encoded.** The
  URL stays semantically equivalent and no student text is harmed, but `render(parse(render(x)))
  != render(x)` still holds, so `_align_container` still rebuilds the untouched block — into a
  normalized URL now instead of junk text.
- **The newline case is NOT fixed and is out of scope.** CommonMark forbids a line ending inside an
  angle-bracket destination, so `<http://a.com/x\ny>` is not a link destination either and the
  construct still re-parses as literal prose. An earlier draft of this plan listed "any href with a
  newline" among the cases the fix repairs — **that was wrong.** A newline href remains corrupted
  after this fix. The obvious remedy (percent-encode `\n`/`\r`/space/tab before choosing the
  destination form) would turn the fix into an href *normalizer* that rewrites stored data, which is
  a materially different change; **no such fix is proposed here.**

**Behavior impact:** `INTENDED — a link with a space or unbalanced-paren href was rewritten into
literal "[text](href)" prose inside the student's essay (and in the "a)b" case gained junk text) →
the link survives the round trip, because silently rewriting a student's essay body is the worst
class of defect in this repo. Secondary, and deliberate: an href containing a space is normalized to
its percent-encoded form on the next reparse. An href containing a newline is unchanged — still
corrupted, still out of scope.`

**Fix risk:** LOW — the angle form is taken only for hrefs that provably don't round-trip today.
**Effort:** ~15 lines. **Confidence:** HIGH (measured, not read) — including the measurement of what
it fails to fix.

---

### R5 — A failed search is indistinguishable from an empty one, licensing a false absence claim *(MEDIUM-HIGH)*

**Location:** `adapters/tavily_tools.py:365-378`, `:432`, `:540-544`
**Full evidence:** `artifacts/backend-audit/01b-agent-runtime.md` § R5

Genuine transport failures are correctly handled (503 → `{error, retryable}`). The gap is the
**soft failure**: `resp.get("results", [])` conflates a *missing key* with an *empty list*. Tavily's
SDK raises only on non-2xx, so a 200 carrying a throttle body (`{"detail": "rate limited"}`) or a
schema change yields no `results` key → the tool reports a successful, empty search.

All four shapes were executed and are **byte-identical to the model**:
```
B filtered (reddit dropped)   : {'results': []}
C zero hits (genuine)         : {'results': []}
D off-domain (guard dropped)  : {'results': []}
E malformed 200 (throttled)   : {'results': []}
```

**Concrete failure.** Student asks "does Duke require the SAT for 2027?" with `.edu` on. Tavily
soft-throttles. The tool returns `{"results": []}` with no error and no retry hint; `EmissionRouter`
paints a normal completed step ("Searched Duke's official site ✓"); the model writes *"Duke's site
doesn't list a 2027 testing requirement."* **That is an absence claim derived from a failed search,
and nothing downstream can catch it** — per constraints §4 the output validators were deliberately
removed and inline `[n]` citations are the sole honesty gate, and an absence claim carries no
citation to check.

**Surgical fix** — one type guard per tool (3 sites) plus one helper beside `_safe_error` (`:258`).
**Only one of the three sites is a plain assignment where the guard pastes in as-is; the other two
are list comprehensions that call `resp.get("results", [])` inline and must be rewritten to iterate
the guarded name.** An earlier draft described all three as a pure insertion.

The guard itself, in all three cases:
```python
    raw_results = resp.get("results")
    if not isinstance(raw_results, list):
        return _malformed_response_error()
```

**Site 1 — `adapters/tavily_tools.py:432` (`search_school_site`), plain assignment, pure insertion:**
```diff
-    results = resp.get("results", [])
+    raw_results = resp.get("results")
+    if not isinstance(raw_results, list):
+        return _malformed_response_error()
+    results = raw_results
```

**Site 2 — `:365-370` (`search_web`), comprehension:**
```diff
+    raw_results = resp.get("results")
+    if not isinstance(raw_results, list):
+        return _malformed_response_error()
     results = [
         result
-        for result in resp.get("results", [])
+        for result in raw_results
         if isinstance(result, dict)
         and _web_result_allowed(result.get("url"), exclude_domains)
     ]
```

**Site 3 — `:540-544` (`search_reddit`), the same comprehension shape:**
```diff
+    raw_results = resp.get("results")
+    if not isinstance(raw_results, list):
+        return _malformed_response_error()
     results = [
         result
-        for result in resp.get("results", [])
+        for result in raw_results
         if isinstance(result, dict) and _reddit_result_allowed(result.get("url"), valid_subs)
     ]
```
```python
def _malformed_response_error() -> dict[str, Any]:
    """A 200 with no result list is a failed search, never an evidenced absence."""
    return {
        "error": "the search service returned no result list — this search failed and "
                 "proves nothing about whether the information exists",
        "retryable": True,
    }
```

**Behavior impact:** `INTENDED — a Tavily 200 carrying no "results" list currently returns
{"results": []}, which the model reads as an evidenced "nothing found" → it now returns the standard
{error, retryable} teaching payload, because a failed search that looks like an empty one lets the
agent state an absence it never verified.` Cases B/C/D are deliberately unchanged — those are
genuine empty results and `{"results": []}` is the honest answer for them.

**Fix risk:** LOW — the returned shape is the module's existing documented error envelope, so no new
contract. **Effort:** 15 min. **Confidence:** HIGH that the conflation exists (executed).

---

### R3 — A model-invented number from a Reddit comment renders as precise data in a comparison table *(MEDIUM-HIGH — ⚠️ OWNER DECISION 5)*

**Location:** `app/viz.py:365`
**Full evidence:** `artifacts/backend-audit/01b-agent-runtime.md` § R3

The DB channel is clean — `MetricCellInput`/`ProfileCellInput` carry a **ref only**, and the number
is fetched in-process from the packet, never from the model. The defect is the external-cell branch:

```python
                elif entry.citation.source not in {"web", "edu", "reddit"}:
```

`SourcedCellInput.display`/`raw` are typed **by the model** and validated only as nonblank/finite.
For `web`/`edu` this is sanctioned by ADR 0032's amendment. **`reddit` is not.** ADR 0014 is
explicit and was never superseded:

> Community / qualitative (Reddit, deep-research synthesis) → rendered as an explicitly
> community-tier qualitative card, **never a quantified chart. No fabricated "73% of redditors…"
> precision.**

The `community_card` meant to hold such content is deferred and does not exist — so there is no
sanctioned surface for a Reddit value, yet `app/viz.py:365` admits one into the two quantified types.

**Concrete failure.** Student asks about class sizes with Reddit on. `search_reddit` returns a thread
as `[4]`. The model calls `render_viz` with `{"display": "18", "raw": 18, "marker": "[4]"}` — a
number it inferred from a comment reading *"most of my classes were under 20."* The cell renders as
a precise `18` **beside genuine packet-fetched CDS values in the same grid.**

**Surgical fix** — one membership set, **split into two branches**. A single branch would be wrong:
`SourceName` is `Literal["cds","profile","web","edu","reddit"]` (`domain/envelope.py:17`), so
`not in {"web","edu"}` is also reached by `cds` and `profile` markers, and telling the model a `cds`
citation "is community sentiment" is false — and it is **model-facing teaching text**, which §0.1
treats as behavior. Existing `app/viz.py:365-366` is
`elif entry.citation.source not in {"web", "edu", "reddit"}:` / `reason = f"marker {cell.marker} is
not an external web/edu/reddit source"`. Replace with:

```python
                elif entry.citation.source == "reddit":
                    reason = (
                        f"marker {cell.marker} is community sentiment, not a quantifiable "
                        "source — state it in prose instead of a visualization cell"
                    )
                elif entry.citation.source not in {"web", "edu"}:
                    reason = f"marker {cell.marker} is not an external web/edu source"
```

The rejection is already a teaching payload flowing into `rejected_cells` with row/col and a
corrective reason. The model's correct move — narrate the sentiment in prose with its `[4]`
citation — stays fully available.

**Behavior impact:** `INTENDED — a Reddit-sourced cell whose number the model typed currently renders
as a precise value in a stat_block/comparison_table → it is now rejected with a corrective reason,
because a model-inferred number attributed to a Reddit thread is fabricated precision on a community
source, which ADR 0014 forbids outright.` This **will** change agent behavior on Reddit-heavy turns,
by design. Second, smaller leg: the existing non-external rejection string changes from
`"…is not an external web/edu/reddit source"` to `"…is not an external web/edu source"` — also
`INTENDED`, and also model-facing text, because after this change `reddit` is genuinely no longer in
the sanctioned set and the old string would be a false statement of the rule.

**Fix risk:** LOW. **Effort:** 10 min + a pinning test (earns its place under the honesty carve-out —
counted as Tier-5 item 4 in §8). **Confidence:** MEDIUM-HIGH — code path certain; the judgement is
whether ADR 0032's amendment silently widened ADR 0014's ban. No ADR/DESIGN/ARCHITECTURE line says it
did.

> ### ⚠️ OWNER DECISION 5 — did ADR 0032's amendment widen ADR 0014's community-quantification ban?
> The finding's own confidence line concedes that this is an **unresolved reading of two ADRs**, and
> its behavior line concedes that the fix **will** change agent behavior on Reddit-heavy turns. That
> is the same profile as Owner Decisions 1–4 — a product-visible change to the agent's action space —
> and an earlier draft of this plan resolved it unilaterally as a shipping default. It should not.
>
> **The case for shipping:** ADR 0014's prose is unambiguous and was never superseded ("**never** a
> quantified chart. No fabricated '73% of redditors…' precision"). The `community_card` that was meant
> to hold such content is deferred and does not exist, so there is currently **no sanctioned surface
> for a Reddit number at all** — yet `app/viz.py:365` admits one into the two quantified types. The
> rejection is a teaching payload; the model's correct move (narrate the sentiment in prose with its
> `[4]` citation) stays fully available.
>
> **The case against:** ADR 0032's amendment sanctioned model-typed `display`/`raw` for `web`/`edu`
> without saying anything about `reddit` either way. Reading that silence as "reddit stays banned" is
> an interpretation, not a recorded decision, and acting on an interpretation of two ADRs is exactly
> what `CLAUDE.md`'s "do not silently break an ADR" is about.
>
> **Recommendation: ship it** — the honesty argument is strong and the ADR 0014 quote is explicit.
> **But if the owner takes it, ADR 0014 or ADR 0032 needs one line recording that the amendment did
> not widen the community-quantification ban.** Leaving the ambiguity in place *after* acting on it is
> the one outcome that is worse than either choice. **Until decided, R3 is not in an execution
> phase** — it moves from Phase B to Phase F.

---

### D2 — The CDS edition is spelled three ways, and two land on the same row *(HIGH-VALUE, honesty)*

**Location:** `app/tool_middleware.py:60,68,82-89`; `counselle_db/packets.py:427,441`; `counselle_db/formatting.py:16-18`
**Full evidence:** `artifacts/backend-audit/03-dead-code-structure.md` § D2

`app/tool_middleware.py:82-89` puts two spellings on the **same row**: `vintage` = `"CDS 2024-25"`
while `citation.vintage`/`source_label` = `"Common Data Set 2024-25"`. The `stale_edition` caveat
then renders:

> *"This value comes from the older **Common Data Set 2024-25** CDS edition."*

and with period qualifiers appended (`packets.py:441` — `:439` is a `break`; an earlier draft cited
the wrong line):

> *"…the older CDS 2024-25; Reporting period: Fall 2024 CDS edition."*

Garbled, student-visible citation prose.

**⚠️ Neither Part A nor Part B nor Owner Decision 3 fixes that sentence.** The full path, verified in
code: `counselle_db/packets.py:441` appends `f"; {context.label}: {', '.join(displays)}"` onto
`vintage`; `app/workspace/service_reference.py:183` passes that whole string —
qualifiers included — as `render_caveat("stale_edition", edition=row.vintage)`; and
`config/assets/caveats.yaml:5` is `"This value comes from the older {edition} CDS edition."` So the
`{edition}` slot receives a *composite* string that already contains a semicolon clause, and the
template then appends the words "CDS edition" after it. **Part A only changes how the `CDS 2024-25`
prefix is derived — the `; Reporting period: …` suffix still lands in the caveat slot, so the
headline harm survives the headline fix.** Fixing it means either not passing the qualifier-laden
`vintage` into the caveat slot, or changing the template — **neither is in scope here**, and it is
recorded as such in §13. This finding's in-scope value is Part A (one source of truth for the edition
string) plus surfacing the decision below; the garbled sentence itself is **not** closed by this plan.

**Surgical fix, Part A (behavior-neutral):** `counselle_db/packets.py:427` re-derives the edition
string inline (`f"CDS {academic_year}-{str(academic_year + 1)[-2:]}"`) while
`counselle_db/formatting.py:16` owns `format_cds_edition()` — and `packets.py` **already imports from
that module**. Replace the inline derivation with the call. Numerically identical today.
`Behavior impact: NONE — behavior-neutral.`

**Part B is an owner call** — see below.

> ### ⚠️ OWNER DECISION 3 — which edition spelling is canonical?
> Unifying the two spellings on the row changes a **student-visible citation label**. Options:
> (a) everything becomes `"CDS 2024-25"` (compact, matches the caveat grammar);
> (b) everything becomes `"Common Data Set 2024-25"` (explicit, better for a first-time reader).
> Either is defensible; the current state — both, on one row — is not.
> **`Behavior impact:` is stated per option, because the two options have different old→new pairs —
> and neither can be written in full until the chosen option's `config/assets/caveats.yaml`
> before/after exists, so nothing ships until Owner Decision 3 is made:**
> - **(a)** `INTENDED — the tool-middleware source label and citation vintage read "Common Data Set
>   2024-25" while the packet's own vintage on the same row reads "CDS 2024-25" → both read
>   "CDS 2024-25", because one row showing a student two different names for one document is a
>   provenance statement that contradicts itself.`
> - **(b)** `INTENDED — the same disagreement → both read "Common Data Set 2024-25", because <same>` —
>   **plus** the `selected_edition` string at `counselle_db/service.py:615` and the pin at
>   `tests/counselle_db/test_foundation_regressions.py:34` move with it. That second leg is why (b)
>   cannot carry a one-line label today: its blast radius is not specified.
>

> **The two options do not cost the same, and an earlier draft recommended (b) without saying so.**
> - **(a) is specified and cheap.** Source `03` D2 Part B is written for it: make
>   `app/tool_middleware.py:60` and `:68` call `format_cds_edition(year)` instead of interpolating
>   `"Common Data Set {year}-{yy}"`. Two lines, one formatter, no other consumer moves.
> - **(b) is not specified anywhere, and it is not one edit.** Making
>   `source_label`/`citation.vintage` read `"Common Data Set 2024-25"` requires either a **second
>   formatter** beside `format_cds_edition()` in `counselle_db/formatting.py` (and a rule for which
>   call site takes which), **or** changing `format_cds_edition()` itself — which also changes
>   `counselle_db/service.py:615`'s `selected_edition` and **flips the regression pin at
>   `tests/counselle_db/test_foundation_regressions.py:34`** (`assert format_cds_edition(2024) ==
>   "CDS 2024-25"`). None of that was stated.
>
> **No recommendation is carried forward.** Choosing (b) means commissioning the design above first;
> an engineer handed "(b)" today cannot execute it from this plan. The earlier draft also asserted
> that (b) "requires the caveat template to stop appending the redundant word 'CDS edition' — one
> asset edit", with no before/after — in violation of §0's own promise, and it does not in any case
> fix the garbled sentence (see the boxed note above: the qualifier suffix, not the word "CDS
> edition", is what garbles it). **Whichever option is chosen, its `config/assets/caveats.yaml`
> before/after must be written out before it is scheduled.**

---

## 4. TIER 1 — Data integrity and correctness

### L1 — Cancel racing a completed turn duplicates the assistant answer in the transcript *(HIGH)*

**Location:** `app/turns.py:1171-1176`; `app/records.py:349-356`; window opened by `app/run_turn.py:1004-1058`
**Full evidence:** `artifacts/backend-audit/01a-turn-lifecycle.md` § L1

The agent node commits its `complete` record in the graph state delta. `run_turn` then performs
**two real DB round-trips before yielding any terminal event** (`touch_session`, `graph.aget_state`).
During either await the turn is still claimed and its task still live, so `cancel()`'s guard passes,
and `_persist_partial` builds a record from a snapshot that *already contains* the node's record for
the same `message_id`. `append_or_replace`'s replace branch fires only for a **parked** tail, so it
**appends a duplicate**.

**Concrete failure:** student presses Stop in that window → transcript shows **the same assistant
answer twice** on reload (once complete, once cancelled), both with the same `message_id`, so a
thumbs-up on one renders on both. The identical race exists for the watchdog and the shutdown drain
— a redeploy landing in that window duplicates every in-flight-but-finished turn. Contradicts
ADR 0022 decision 13 ("cancel racing completion = the idle no-op").

**Relation to the deferred B2 corners (`TODOS.md:50-53`).** L1 is a *different* defect from both
logged items: the B2 parked-ghost corner is about a **parked** (`awaiting_input`) record left ghosted
when the next action is not a resume, and the `_write_failure_record` corner is about prose landing
without a record. L1 is about a **completed** record being duplicated — the tail is `complete`, not
`awaiting_input`, no clarify park is involved, and the fix is a short-circuit inside `_persist_partial`
rather than a new lock. It is a direct contradiction of ADR 0022 decision 13, which neither logged
item covers. *(The parked sub-case that does overlap the logged item is carved out below and routed
to Owner Decision 6.)*

**Surgical fix** — a 25-line guard (8 comment + 17 code) inserted immediately after
`app/turns.py:1171`, which is verbatim `        records = list(values.get("turn_records") or [])`
(the first line of the block below is that anchor, shown for placement, not re-typed):

```python
        records = list(values.get("turn_records") or [])
        # The turn already committed its own terminal record (the node's state delta
        # landed before this cancel/timeout won the race). Appending a second record
        # for the same message_id would duplicate the assistant answer in the
        # transcript — ADR 0022's "cancel racing completion = the idle no-op". The
        # parked case still needs the write, but ONLY the v1 one: append_or_replace
        # replaces an awaiting_input tail with the same id *and* `not _is_v2_clarify`
        # (app/records.py:349-356). For a v2 parked tail it APPENDS, so letting that
        # case through here would write the very duplicate this guard exists to stop.
        message_id = turn.ids.get("message_id")
        already_committed = any(r.get("message_id") == message_id for r in records)
        replaces_parked = (
            is_parked(records)
            and records[-1].get("message_id") == message_id
            and not _is_v2_clarify(records[-1])
        )
        if already_committed and not replaces_parked:
            logger.info(
                "terminal record already committed — skipping duplicate partial "
                "(session_id=%s, status=%s)", turn.session_id, status,
            )
            if turn.continuation_of is not None:
                await self._graph.aupdate_state(
                    config, {"continuation_intent": None}, as_node=AGENT_NODE
                )
            return
```
**Import edit — the two names come from two different modules; do not merge them.** `is_parked` is
already imported, but from `app.turn_persistence`, inside the `from app.turn_persistence import (`
block at `app/turns.py:65-71` (`is_parked` is `:68`). `_is_v2_clarify` is **not** in that module and
is not re-exported by it — repo-wide it has exactly two hits, its definition at `app/records.py:322`
and its one use at `app/records.py:353`. **Add `_is_v2_clarify` to the `from app.records import …`
line at `app/turns.py:59`**, which today reads:

```python
from app.records import Emission, FinalEmissionDeduper, TurnStatus
```
→
```python
from app.records import Emission, FinalEmissionDeduper, TurnStatus, _is_v2_clarify
```

Adding it to the `:65-71` block instead is an **`ImportError` at module import time** on the primary
turn-registry module — the process does not start. (An earlier draft of this plan said "add it to
that same block as `is_parked`" ← **DO NOT SHIP THIS**; it conflated the two import blocks.)

**Why the fourth condition matters.** An earlier draft wrote `replaces_parked` with only two
conditions (`is_parked` + matching `message_id`) and an inline comment claiming `append_or_replace`
replaces "an `awaiting_input` tail with the same id". That is the **v1** rule only. The real predicate
(`app/records.py:349-356`) has four conditions — the fourth is `not _is_v2_clarify(prior[-1])`, and
the docstring says so explicitly ("a v2 pending A1 is NEVER re-run through this legacy replace path
… append instead"). With the two-condition version, a cancel landing in the window after the node
committed a **v2** clarify park evaluates `already_committed=True, replaces_parked=True` → no
short-circuit → `build_terminal_update` → `append_or_replace` takes the **append** branch → the
duplicate lands anyway. That is a reachable sub-case of the exact defect L1 exists to fix.

**Behavior impact:** `INTENDED — (a) a cancel/timeout/shutdown racing a turn whose record already
committed appends a second duplicate assistant record → it now writes no record and the committed
record stands; (b) the same race against a v2 clarify park, which today appends a duplicate beside
the parked record, now also writes nothing and leaves the awaiting_input record as the tail — because
duplicating a student-visible answer in the honesty surface is the bug.` SSE is unchanged: the
single-shot `done(cancelled)` still goes out. *(Leg (b) means a v2 park survives a racing cancel as
still-parked rather than gaining a phantom cancelled twin; the parked record is the truthful state,
since the question genuinely was asked and never answered.)*

**Fix risk:** LOW — pure short-circuit. **Effort:** 15 min.
**Confidence:** HIGH on the path. **Falsified if** LangGraph does not checkpoint the node's
`turn_records` delta before `astream`'s consumer loop drains. **Settle this before implementing** —
cancel while a stubbed `touch_session` blocks on an `asyncio.Event` and observe whether the snapshot
carries the node's record. This is a **verification step for the diagnosis, not a new test asset**
(§11); run it once by hand and record the result rather than committing it.

---

### L4 — A Stop racing a clarification answer erases the accepted answer *(MEDIUM-HIGH — ⚠️ OWNER DECISION 6, not schedulable)*

**Location:** `app/turns.py:618-640`, `:1204-1242`; `app/clarify_lifecycle.py:159-266`

> ### ⚠️ OWNER DECISION 6 — L4 is a piecemeal guard on an area a recorded decision says not to guard piecemeal
> **This finding collides head-on with an already-logged deferral, and cannot ship without the owner
> overriding that deferral.** `TODOS.md:50-51` reads verbatim:
>
> > **B2: parked-then-non-resume ghost (turn lifecycle)** — A parked thread whose next action is NOT
> > a resume (**e.g. a cancel racing in**) can leave the parked record ghosted — B2's turn registry
> > single-flight lock owns concurrent-turn lifecycle; **do not guard piecemeal.**
>
> L4 *is* that scenario — a cancel racing in on a parked thread, corrupting `turn_records` — and the
> fix below (taking a `ClarifyClaimRegistry` claim around `_unpark_if_parked` only) is exactly the
> piecemeal guard that item forbids.
>
> **The case for overriding:** the logged item describes a *ghosted record*; L4 is measured **data
> loss** — the student's accepted clarification answer is erased from a committed record (see the
> concrete failure below). The fix is 12 lines, process-local, released in a `finally`, and HTTP-
> invisible (`cancel_session` maps both `"unparked"` and `"idle"` to 204). It uses machinery that
> already exists and is already unit-tested: `ClarifyClaimRegistry.try_claim` **already accepts
> `kind="cancel"`** (`app/clarify_lifecycle.py:310,330,349`) — only the production wiring never
> landed, and the module docstring says it was Phase 5 scope.
>
> **The case for deferring:** "do not guard piecemeal" was written by the owner of the turn-registry
> single-flight lock, who intends to solve the whole concurrent-turn-lifecycle family at once. A
> second lock taken outside that lock is precisely the accretion the instruction exists to prevent,
> and shipping it makes the eventual single-flight rework harder, not easier.
>
> **Decide:** override the deferral and ship L4 now, or fold L4 into the B2 turn-lifecycle work and
> ship nothing here. **No recommendation is offered** — this is the owner's own recorded instruction
> and only the owner can lift it. Until it is decided, **L4 is not in any execution phase.**

`accept_clarification` does a read-modify-write of the whole `turn_records` list across real awaits.
The registry takes a claim around it — but only against another *accept*. `cancel()` consults
`_turns` only, never `_clarify_claims`, and `_unpark_if_parked` does its own read-modify-write of
the same list. `ClarifyClaimRegistry.try_claim` **already accepts `kind="cancel"` and is unit-tested**
— the production wiring never landed (the module docstring says it was Phase 5 scope).

**Concrete failure:** last-writer-wins. Either the accept lands then the cancel rewrites A1 to
`cancelled` with `clarify.response` **gone — the student's answer erased** — while A2 is already
streaming; or the cancel returns `204 "unparked"` (UI shows the question unanswered) while A1 is in
fact answered and A2 runs to completion. Either way `clear_session` drops A1's parked source
registry, so A2's citations can lose their pre-question sources.

**Surgical fix** — `app/turns.py:638-640`:

```python
        # Serialize the parked-record rewrite against an in-flight clarify
        # acceptance: both do a read-modify-write of the whole turn_records list.
        try:
            self._clarify_claims.try_claim(session_id, kind="cancel")
        except ClarifyClaimBusy:
            logger.info(
                "cancel skipped — a clarification acceptance holds the claim (session_id=%s)",
                session_id,
            )
            return "idle"
        try:
            if await self._unpark_if_parked(session_id):
                return "unparked"
        finally:
            self._clarify_claims.release(session_id)
        return "idle"
```
plus adding `ClarifyClaimBusy` to the import at `app/turns.py:55`.

**Behavior impact:** `INTENDED — a cancel arriving while a clarification acceptance is mid-flight
last-writer-wins over turn_records (erasing an accepted answer) → it now returns the idle no-op,
because destroying a committed student answer is the bug.` **HTTP unchanged** — `cancel_session` maps
both `"unparked"` and `"idle"` to 204, so no client can observe the difference. Uncontended cancels
(every ordinary Stop) are byte-identical.

**Fix risk:** LOW — process-local claim released in `finally`, cannot strand. **Effort:** 20 min.

---

### P1 — `create_tasks` is not all-or-nothing despite promising it is *(HIGH)*

**Location:** `app/workspace/agent_tools_mutations.py:196-207`; `app/workspace/service_tasks.py:192`

Each `create_task` opens its own transaction, but the tool docstring promises the opposite:
*"All-or-nothing: either every task in the batch is created, or none are."*

**Concrete failure, no race needed:** `create_tasks([{title:"A"}, {title:"B", application_id:X,
essay_id:E}])` where `E` belongs to a *different* application. Draft 0 commits; draft 1 raises in
`_validate_links`. The exception escapes while "A" is already committed with a published event. The
model, told nothing was created, resubmits and **duplicates "A"**.

The identical bug was already fixed for essays (`create_essays_batch`) and honors
(`create_honors_batch`). Tasks were never migrated.

**Surgical fix:** add `create_tasks_batch` beside `create_task` — the body of `create_task` with the
`async with` hoisted out of the loop, publishing after commit — then call it from the tool with a
`except (WorkspaceNotFoundError, WorkspaceValidationError)` returning the teaching error. Also
collapses a 20-round-trip write loop.

**Behavior impact:** `INTENDED — partial batch commit on validation failure → no rows committed,
because the docstring contract the model relies on promises all-or-nothing and the current behavior
causes duplicate tasks on retry.` **Effort:** ~40 lines.

---

### P2/P3 — Honors bypass the advisory lock: the cap can be exceeded and `sort_order` collides *(DATA-INTEGRITY)*

**Location:** `app/workspace/service_activities.py:401-416` (create), `:722-726` (restore), `:753-762` (reorder)

`_require_capacity` and `_next_sort_order` take no row lock, and the module's own comment says
*"`max(sort_order)` and the active-slot count have no row to lock for an empty list."*
`create_activities` and `create_honors_batch` call `_lock_activities`/`_lock_honors`.
**`create_honor`, `_restore_row` and `_reorder_rows` do not** — the restore/reorder sites guard with
`if table == "activities"` and simply skip locking for honors.

**Concrete failure:** 4 active honors, two concurrent `POST /v1/honors` → both read `count=4`, both
pass `4 >= 5 == False`, both insert → **6 active honors when the Common App allows 5**, sharing
`sort_order=4`. No DB constraint backs the cap. The duplicate `sort_order` then makes `_reorder_rows`
non-deterministic, so receipt `old_ranks` are unstable. A live test exists for the activities
version; none for honors.

**Surgical fix:**
```python
# create_honor (service_activities.py:401)
        await _lock_honors(conn, user_id)
        await _require_capacity(conn, "honors", user_id, HONOR_CAP)

# both restore/reorder sites
        if table == "activities":
            await _lock_activities(conn, user_id)
        else:
            await _lock_honors(conn, user_id)
```
The two locks use distinct namespace tags (`0`/`1`), so they cannot collide. `_archive_row` needs no
change — archive has no cap or `max()` read.

**Behavior impact:** `INTENDED — concurrent honor create/restore/reorder could exceed the 5-honor cap
or collide sort_order → serialized, because the result is invalid workspace data.` Serial behavior
unchanged. **Effort:** 5 lines total. **Confidence:** HIGH.

---

### P4 — `duplicate_essay` drops the deadline, and the student is shown a wrong date *(MEDIUM)*

**Location:** `app/workspace/service_essays.py:320-334`

`counselle.essays.deadline` is absent from the INSERT column list. Omitting `prompt_ref` is
deliberate (a unique index would reject it); `deadline` has no such constraint, and every other
user-set field including `comments`/`suggestions` is copied.

**Concrete failure:** essay deadline `2026-11-01`, application deadline `2026-01-02`. The copy gets
`deadline = NULL`, and `_ESSAY_LIST_SQL`'s `COALESCE(e.deadline, a.deadline)` then reports the copy's
deadline as **2026-01-02** — ten months earlier — presented to the student as fact.

**Surgical fix:** add `deadline` to both the column list and the SELECT, between `word_limit` and
`comments`.

**Behavior impact:** `INTENDED — duplicated essay showed the application's deadline → shows the
original essay's deadline, because the current value is a wrong date shown to a student.`
**Effort:** 2 lines. **Confidence:** MEDIUM-HIGH (nothing documents the omission as intentional).

---

### P5 — Archiving an application orphans essay-only-linked tasks *(MEDIUM)*

**Location:** `app/workspace/service_applications.py:350-351`, `:670-684`

The task cascade matches on `application_id` only, but `_validate_links` explicitly permits a task
with `essay_id` set and `application_id` NULL.

**Concrete failure:** archive the application → the essay is archived, the task stays active with a
dangling `essay_id`. `render_task_row` resolves against the *active* essay list, gets `None`, drops
the key — the student sees a live, apparently unlinked task. Restoring doesn't recover it either:
`_restore_linked_tasks` matches `archived_via_application`, which was never set.

**Surgical fix** — widen the predicate (must stay *before* `_archive_linked_essays`, which the
current call order already satisfies):
```sql
        WHERE user_id = $2 AND archived_at IS NULL
          AND (application_id = $1
               OR essay_id IN (SELECT id FROM counselle.essays
                               WHERE user_id = $2 AND application_id = $1 AND archived_at IS NULL))
```
The restore side needs no change. **Behavior impact:** `INTENDED — essay-only-linked tasks survived
an application archive as unreachable orphans → archived with the application, because the surviving
task points at an archived essay that render_task_row cannot resolve, so the student sees a live task
whose link silently vanished and which no restore path can ever recover.` **Effort:** 8 lines.

---

### W2 — An empty paragraph is silently deleted by any unrelated `edit_essay` *(HIGH)*

**Location:** `app/workspace/essay_markdown.py:104-106`, `:463-466`, `:731`

`to_markdown` joins blocks with `"\n\n"`; an empty paragraph serializes to `""`, so `["a","","b"]`
becomes `"a\n\n\n\nb"` and re-parses to **two** blocks. Measured through `apply_edits`: editing an
unrelated paragraph drops the blank one. A student who double-Enters for spacing (the default way to
get a blank line in Tiptap StarterKit) loses it the first time the agent touches the essay, with no
mention in the receipt or the "Applied N edits." summary.

> ### ⚠️ OWNER DECISION 4 — two viable fix shapes
> **(a) Preserve it:** give an empty paragraph a stable token (`&#8203;`) that survives reparse, and
> strip it on the way back. ~8 lines. Downside: the agent sees `&#8203;` in `read_essay`, which is
> **prompt-visible** — a behavior change on the model's input surface.
> **(b) Stop it being silent:** leave the projection alone and have `_align_container` carry over old
> children the diff dropped when their rendered form was empty. Keeps the agent's view clean.
> **Recommendation: (b)** — it is the smaller behavioral footprint and does not put an HTML entity in
> front of the model. *(Precision: §0.1's named categories are prompt/skill/**tool-description** text,
> not tool **output**, so "§0.1 treats this as a behavior change" — as an earlier draft put it — is
> overstated. Putting `&#8203;` into what `read_essay` returns is still a change to the model's input
> surface and still counts against (a); the recommendation stands on that, not on a §0.1 citation.)*
> **The two options also differ in guarantee, not only in taste:** (a) preserves the empty paragraph
> in the projection itself, while (b) preserves it only via `_align_container` carry-over, which
> behaves differently when the **neighbouring** block is the one being edited.

**⚠️ Neither option has a before/after snippet, so W2 is not schedulable.** §0 promises every fix in
this plan is "expressible as a before/after snippet on specific lines"; W2 ships prose for both
shapes, and the recommended one — (b) — is a change to the **essay-diff/alignment algorithm**
described only at the level of intent ("carry over old children the diff dropped when their rendered
form was empty"). Its own risk line concedes it: *"shape-dependent."* Nobody can tell from this plan
whether (b) is surgical or a restructure, which is exactly what **constraints §1** (the prime
directive, restated at §0) exists to keep out. **W2 therefore
carries no effort estimate and no risk rating until a snippet exists, and it is in no execution
phase** — it sits under §14 as Owner Decision 4. The bug diagnosis (measured, HIGH confidence)
stands unchanged; it is the fix that does not qualify yet. *(W3 is now blocked behind the same
missing snippet — see §4 W3.)*

**Behavior impact:** `INTENDED — an unrelated edit_essay deleted every empty paragraph → empty
paragraphs survive, because deleting student-authored structure without telling anyone is data loss.`
*(Label stated for whichever shape is eventually chosen; nothing ships until one is specified.)*
**Fix risk:** not rated — no specified fix. **Confidence:** HIGH on the bug (measured).

---

### W3 — An indented paragraph becomes a code block on any unrelated edit *(MEDIUM)*

**Location:** `app/workspace/essay_markdown.py:412-431` (`_escape_leading_line`)

The escape guard covers ATX headings, bullets, ordered markers, blockquotes, fences, thematic breaks
and setext underlines — but **not** the 4-space indented-code-block rule, which `MarkdownIt("commonmark")`
enables. Measured: a paragraph indented 4 spaces (or a tab) comes back as a **`codeBlock`** —
monospace in the editor, indentation gone — after editing a *different* paragraph.

**No safe surgical fix identified — see below.** The obvious escape does not work.

An earlier draft of this plan proposed adding one alternative to `_escape_leading_line`:

```python
_INDENTED_CODE_RE = re.compile(r"^(?: {4}|\t)")   # ← DO NOT SHIP THIS
```

on the theory that "a leading backslash is ASCII-punctuation-escapable and moves the first content
column left of the 4-space threshold." **That theory is wrong, and the failure was measured through
the real `to_markdown`/`to_tiptap`:**

```
BEFORE:  '    indented para'  -> codeBlock  text='indented para'          (the bug is real)
AFTER:   '    indented para'  -> paragraph  text='\    indented para'     ← BACKSLASH INJECTED
BEFORE:  '\ttabbed para'      -> codeBlock  text='tabbed para'
AFTER:   '\ttabbed para'      -> paragraph  text='\\\ttabbed para'        ← BACKSLASH INJECTED
```

CommonMark honours a backslash escape only before **ASCII punctuation**. Here the backslash is
followed by a **space or a tab**, so it is not an escape — it survives as a literal `\` at the front
of the student's sentence. The existing alternatives (`#`, `-`, `>`, `` ` ``) are safe precisely
because they precede punctuation, where `\#` *is* a valid escape; indented code is the one case where
the trick does not transfer, which is presumably why it was never added. The proposed fix would have
traded "the paragraph becomes a code block" for "the paragraph gains a stray backslash" — both are
silent rewrites of a student's essay body, the worst class of defect in this repo.

**Status: documented defect, no fix in this plan.** The measured evidence above stands; the bug is
real and reproducible. `_escape_leading_line` cannot solve it — an escape mechanism that cannot
escape a leading space has nothing to work with. Any real fix has to preserve the leading indent
through the reparse rather than escape it, which is the same mechanism Owner Decision 4(b) proposes
for W2 (carry the original node over in `_align_container`, `app/workspace/essay_markdown.py:731`,
when the reparse changed the block's type). That shape is unspecified for W2 too (see Owner Decision
4), so W3 is not schedulable until it exists. **No replacement fix is invented here.**

**Behavior impact:** `NONE — behavior-neutral` (no code change ships for W3 in this plan).
**Confidence:** HIGH on the bug (measured); the *fix* was the thing that was wrong.

---

### L2 — An A2 failure loses the whole turn record; the student's clarification answer vanishes *(MEDIUM)*

**Location:** `app/run_turn.py:651-664` sits outside the `try` that starts at `:688`

`_ensure_session` does a real pool acquire and two SQL statements. The ordinary turn does this
correctly (`_prepare_turn_input` is inside `run_turn`'s main try); A2 drifted.

**Concrete failure:** a pool blip after `meta`/`clarify_response` have been emitted → the exception
escapes to the registry's generic catch-all, the student sees the error live, but **no A2 record is
written** and `continuation_intent` is stuck at `"accepted"`. On reload the A2 bubble is gone with no
record the answer was ever submitted.

**Surgical fix:** move the `try:` from `:688` up to `:651` and indent `:651-687` by four spaces.
Nothing else changes; the inner best-effort try/except stays as-is.

**Behavior impact:** `INTENDED — a failure in A2's session-ensure currently produces an error event
with no turn record and a stuck intent → it now routes through _finish_failed_continuation like every
other A2 failure, because a student who submitted a clarification answer is left with no record it
was ever submitted and an intent stuck at "accepted".` SSE wire unchanged (same `_USER_SAFE_ERROR` either way). **Effort:** 10 min.

---

### L3 — Clarification continuations bypass the concurrent-turn cap *(MEDIUM)*

**Location:** `app/turns.py:532-534` (missing check) vs `:406-408` (how `start()` does it)

`start()` enforces `max_concurrent_turns` inside its no-await claim window; `start_continuation` does
not. **Proof it was intended:** the route already has `except TooManyTurns → 503`
(`api/routes/sessions.py:402`), and neither `accept_clarification` nor `start_continuation` can raise
it — those four lines are dead.

**Relation to the deferred B2 corners (`TODOS.md:50-53`).** L3 is not a concurrency guard at all and
touches neither logged corner: it adds no lock, no claim, and no ordering — it restores an **already-
written admission check** to the one entry point that skipped it, inside the *existing* no-await claim
window that the single-flight lock already owns. Nothing is guarded piecemeal; a missing `if` is
filled in so the route's already-written 503 handler becomes reachable.

**Concrete failure:** with the cap at 50, a 51st *ordinary* message correctly 503s, but a 51st
*clarification answer* still spawns a detached task, buffer and `RunHandle`. Over-budget appends then
force head eviction on **other** sessions' buffers, terminating innocent consumers with "your
connection fell behind".

**Surgical fix** — 3 lines after `app/turns.py:533`:
```python
        if len(self._turns) >= self._settings.max_concurrent_turns:
            raise TooManyTurns(session_id)
```
**Behavior impact:** `INTENDED — a continuation submitted at the cap starts anyway → 503, the response
the route was already written to produce, because a turn spawned past the cap forces head eviction on
*other* sessions' buffers and terminates innocent consumers with "your connection fell behind".` No
effect below the cap. Secondary, minor: inserting after
`:533` makes `TooManyTurns` win over `ResponseModeUnavailable` when both apply
(`_require_response_mode_available` is at `:534`) — an ordering change between two error types, not a
new one. **Effort:** 5 min.

**Noted, not fixed:** the raise happens after `accept_clarification` committed A1 as answered, so a
capped-out answer leaves A1 answered with no A2 — the same shape today's
`ResponseModeUnavailable`/`ValueError` paths already have. Not made worse by this fix.

---

### R2 — The prompt tells the model `.edu` is mounted when it is not *(MEDIUM)*

**Location:** `app/agent_node.py:830`; `app/prompt.py:81-90`

`render_source_availability` reads the **requested** config; `build_tools` mounts from the requested
config **AND** the catalog. They disagree on exactly one axis: `.edu` with an empty catalog.

**Concrete failure** (`COUNSELLE_CDS_DATA_ENABLED=false`, the shipped demo path): the tool is not
mounted, but the prompt injects `edu_status = "enabled and mounted"`. The model calls it, gets
pydantic-ai's *unknown tool* retry (not a teaching payload), burning one of its 2 retries; the step
is suppressed because `search_school_site ∈ GATEABLE_TOOLS - mounted`; **the student sees no timeline
entry and no error**, and the turn silently degrades to general-web quality with no disclosure.

**Surgical fix** — derive from what was actually mounted:
```python
    mounted_names = {tool.name for tool in tools}
    source_instructions = render_source_availability(
        source_config.model_copy(
            update={"edu": source_config.edu and "search_school_site" in mounted_names}
        )
    )
```
**Behavior impact:** `INTENDED — with an empty catalog and .edu enabled the prompt says ".edu is
enabled and mounted" while no such tool exists → it now says "disabled and not mounted", because a
prompt that promises a tool the model cannot call burns a retry on an unknown-tool error, suppresses
the step, and silently degrades the turn to general-web quality with no disclosure to the student.`
On every
deployment with `cds_data_enabled=true` the two already agree and **the rendered prompt is
byte-identical** — a no-op for production traffic today. **Effort:** 10 min.

---

### P6 — Archive receipts misname what was archived *(MEDIUM, receipt honesty)*

**Location:** `app/workspace/agent_tools_activities_mutations.py:452-455,478`; `agent_tools_honors_mutations.py:317-320,343`

The lookup map is keyed by canonical `str(uuid)` but the lookup uses the caller-supplied `raw_id`.
`try_uuid` accepts uppercase, hyphenless and `urn:uuid:` forms — all parse, none equal `str(uuid)`.

**Concrete failure:** `archive_activities(["9F8E7D6C-…"])` (uppercase, legal) archives correctly, but
the receipt subject title is the literal `"Activity"` instead of the real position, and
`resource_ref` carries the non-canonical string. The receipt is the student-facing write record, so
it **misreports what was removed**. Tasks get this right (`agent_tools_mutations.py:561`).

**Surgical fix:** key the map by `activity.id` (UUID) and look up by `parsed_id`; same in honors.
**Behavior impact:** `INTENDED — receipt showed the literal placeholder "Activity" and a
non-canonical resource_ref for legal non-canonical UUID input → shows the real subject and the
canonical ref, because the receipt is the student-facing write record and one that misnames what was
removed is a false statement about their own workspace.` **Effort:** 4 lines.

---

### P12 — A concurrent archive turns a tool call into `RuntimeError` after the write committed *(MEDIUM)*

**Location:** `agent_tools_activities_mutations.py:420-424,566`; `agent_tools_honors_mutations.py:103-105,428`

Bare `next(...)` with no default, over a list filtered to active rows, read **after** the update
transaction committed and released its lock. A concurrent archive → no match → bare `StopIteration`
escaping an `async def` becomes `RuntimeError: coroutine raised StopIteration`. **The tool crashes
instead of returning the ADR 0029 teaching payload — after the write committed and its event
published.**

**Surgical fix:** add a `None` default to all four `next()` calls and widen the return to `int | None`.
`render_activity_row`/`render_honor_row` already accept `rank: int | None` and omit the key when
`None`. The two restore sites interpolate `rank` into a summary string — guard those lines too.
**Behavior impact:** `INTENDED — tool crashed with RuntimeError on a narrow race → returns a row
without a rank, because a crash after a committed write is strictly worse than a missing rank.`
**Effort:** ~10 lines.

---

### L6 — A DB blip after spawning the turn 500s the request and strands the claim *(LOW-MEDIUM)*

**Location:** `api/routes/sessions.py:513-521`

`POST /messages` runs its sticky-config/title writes *after* spawning the turn. A DB blip 500s the
request while the turn runs on holding the claim — so the client's retry gets a 409.

**Surgical fix:** wrap `:513-521` in `try/except Exception: logger.warning(...)`, matching the
`touch_session` treatment already used at `app/run_turn.py:1004-1013`.
**Behavior impact:** `INTENDED — a DB blip in the post-spawn sticky-config/title writes returned 500
while the turn ran on holding its claim → the writes are logged and swallowed and the stream is
returned, because the turn has already started and a 500 tells the client to retry into a 409 on a
claim it cannot release.` **Effort:** 5 min.

---

## 5. TIER 2 — Security

### S1 — The auth rate limit is fully bypassable under the documented deploy flag *(HIGH — pre-deploy blocker)*

**Location:** **`scripts/entrypoint.sh:35`** (the executable container entrypoint — the file that
actually runs), `docs/DEPLOY.md:155` and `:158` (the prose), `api/ratelimit.py:145-149` + the module
docstring at `:10` (the false safety comments)
**Full evidence:** `artifacts/backend-audit/02a-auth-identity.md` § S1

`docs/DEPLOY.md` prescribes `--forwarded-allow-ips='*'`. Read from the **pinned uvicorn 0.49.0
source**: under `always_trust`, `get_trusted_client_address` returns `x_forwarded_for_hosts[0]` —
the **leftmost, fully client-supplied** entry. The code asserts in two places that
`request.client.host` is unspoofable *because* the deploy runs `--forwarded-allow-ips`. That comment
is false under `'*'`.

**Concrete exploit:** rotate `X-Forwarded-For` per request. Each lands on a fresh `auth:10.x.y.z` key,
so `check_auth` never reaches `attempts=10/window=60s`. **Zero 429s across 200k attempts.** There is
no account lockout anywhere in the repo and `password_min_length` is 8 → unrestricted online brute
force against every account. `auth_origin_protect` only checks `Origin`/`Referer`, which curl sets
freely. The same trick makes `POST /v1/auth/forgot-password` an unmetered mail-bomb/reset-token
oracle. Secondary: `_hits` is a `defaultdict(deque)` keyed by that spoofable string and evicted only
when empty at check time → 200k forged IPs/min ⇒ 200k resident deques in the process that also
serves chat.

**Distinct from the already-logged DS-06**, which is about keying strategy and process-locality.
This is that **the key itself is forgeable.**

**Reachability, stated honestly.** The exploit is real and end-to-end, but it is reachable only under
a deploy that has not happened (B6 is deferred). That puts steps 1–2 of the fix in the same class as
the already-logged DS-04 ("Blocks B6 deploy") and DS-06: **B6-deploy prerequisites, filed beside
them**, not a live hole in anything a student can reach today. **Step 3 — the `api/ratelimit.py`
comments asserting a safety property the deploy does not provide — is a real, present defect and is
behavior-neutral; it ships in Phase D on its own merits.** The severity ordering in this plan should
be read with that split in mind: S1 is a genuine HIGH *for the deploy*, and the deploy is deferred.

**Surgical fix** — the flag lives in **two** places, and only fixing the documentation leaves the hole
wide open. An earlier draft of this plan named only `docs/DEPLOY.md`; that was wrong.

1. **`scripts/entrypoint.sh` — the shipping artifact.** This is the file the container executes; it
   was added by `55509d3` ("chore: prepare temporary render demo deploy"), i.e. written *to be run*,
   and the Render demo was stood up on it. **Two hunks in this one file**, because the new variable is
   required at boot and the file already has a mechanism for that.

   **1a — `scripts/entrypoint.sh:4-8`, the existing `required_env` list.** The file declares its
   required variables in one place and fails the loop at `:10-16` with a named message
   (`missing required environment variable: $name`). A new required variable goes there, in the file's
   own idiom — not smuggled into a `${VAR:?…}` expansion three quarters down the file.
```diff
 required_env="
 COUNSELLE_DB_APP_DSN
 COUNSELLE_DB_RO_DSN
 COUNSELLE_JWT_SECRET
+COUNSELLE_TRUSTED_PROXY_CIDR
 "
```
   **1b — `scripts/entrypoint.sh:35`.** With 1a in place the variable is guaranteed set by the time
   `exec` runs, so the expansion is a plain `"${…}"`. Comments go on their own `#` lines above `exec`,
   where the rest of the file already puts its comments (`:18-19`).
```diff
+# Trust ONLY the platform's proxy CIDR. '*' makes uvicorn 0.49 take the LEFTMOST,
+# client-supplied X-Forwarded-For entry, turning the per-IP auth limit into a no-op.
 exec .venv/bin/uvicorn api.main:create_app \
   --factory \
   --host 0.0.0.0 \
   --port "${PORT:-8000}" \
   --proxy-headers \
-  --forwarded-allow-ips "*"
+  --forwarded-allow-ips "${COUNSELLE_TRUSTED_PROXY_CIDR}"
```
   *An earlier draft of this plan wrote the flag as*
   `--forwarded-allow-ips "${COUNSELLE_TRUSTED_PROXY_CIDR:?set to the platform's proxy CIDR}"`
   *with the two comment lines wrapped in backticks* ← **DO NOT SHIP THIS.** Backticks are command
   substitution, not comments — they happen to work (the subshell runs a comment, yields the empty
   string, word-splitting drops it) but they spawn two subshells on every container start and one
   mis-transcribed backtick rewrites the uvicorn argv. And a bare `:?` bypasses the file's own
   `required_env` block, putting the boot check in a second, undiscoverable place with a different
   error message.
2. **`docs/DEPLOY.md:155`** — the same substitution in the runbook's code block. **And `:158` in the
   same edit**, which today reads *"`--forwarded-allow-ips='*'` is the flag the first OAuth attempt
   dies without"* — that prose is why the next reader reverts the CIDR. It must say that trusting the
   proxy's CIDR (not `*`) is what fixes the `X-Forwarded-Proto`/`redirect_uri_mismatch` problem.
3. **`api/ratelimit.py:145-149` and the module docstring at `:10`** — correct the comments that assert
   `request.client.host` is unspoofable *because* the deploy runs `--forwarded-allow-ips`.

**Behavior impact:** `INTENDED — under the shipped entrypoint, uvicorn trusts the leftmost,
client-supplied X-Forwarded-For entry, so every per-IP limit keys on an attacker-chosen string → it
now trusts only the platform's proxy CIDR and the per-IP auth limit becomes enforceable, because a
rate-limit key the client picks is not a rate limit; **and, second leg, a container whose
`COUNSELLE_TRUSTED_PROXY_CIDR` is unset now exits at startup with
`missing required environment variable: COUNSELLE_TRUSTED_PROXY_CIDR` instead of booting with a
spoofable limiter — the existing Render demo will not redeploy until the variable is set — because a
silently-permissive default is the defect this finding is about.`** Step 3 alone is
`NONE — behavior-neutral`
(comments). **An earlier draft labelled this whole finding "comments only … nothing running changes"
— that was false: `scripts/entrypoint.sh` is executable configuration, not documentation.**

**Note on the env var:** `COUNSELLE_TRUSTED_PROXY_CIDR` is **not** on the ADR 0018 Settings surface and
is not proposed for it — it is consumed by the shell as a uvicorn CLI argument, never read by Python.
That is acceptable, but it is a new **required** deploy-time variable and belongs on the
`docs/DEPLOY.md` env matrix in the same edit, marked required. **Ordering:** because hunk 1a makes it
a boot requirement, `COUNSELLE_TRUSTED_PROXY_CIDR` must be set on the live Render service **before**
this commit lands, or the next deploy crash-loops. Phase D states this.
**Fix risk:** the CIDR must be right — too narrow and the proxy itself is untrusted, making every user
share one key (self-DoS at 10 logins/min site-wide). **Confirm against the actual host** whether its
proxy appends or replaces `X-Forwarded-For` before shipping the CIDR. **Effort:** 10 min.

---

### S2 — An unbounded `settings` blob taxes every authenticated request *(MEDIUM)*

**Location:** `api/routes/me.py:39-41,139`; amplified by `api/users_db.py:114-121`

`MePatchBody.name` is bounded; `settings: dict[str, Any] | None` is not. The only ceiling is
`MaxBodySizeMiddleware` at ~51 MB — sized for CDS PDF uploads, not a preferences bag. `PATCH /v1/me`
carries `require_json` but **not** `workspace_write_rate_limit` (which `PATCH /v1/onboarding` does).

The amplifier: `AsyncpgUserDatabase.get` does `SELECT *` and runs inside the auth dependency on
**every authenticated request** (`JWTStrategy.read_token` → `user_manager.get`).

**Concrete exploit:** one `PATCH /v1/me` with a 45 MB `settings` blob → 200. From then on every
request that account makes pulls 45 MB out of Postgres and json-decodes it *before the route body
runs*. With `db_pool_max = 5`, a couple of such accounts starve the pool that also serves live SSE
turns. Not self-limiting — the blob persists until patched back.

**Surgical fix:** add `user_settings_max_bytes: int = Field(default=64_000, gt=0)` to Settings, **add
`import json` to `api/routes/me.py`'s stdlib import block** (the module currently imports only
`from typing import Any` at `:17` and `structlog` at `:19` — without the new import the guard raises
`NameError` at request time), and guard the merged result. The guard goes **immediately after
`api/routes/me.py:139`, at 16 spaces** — inside `async with …:` → `if settings_patch is not None:`,
the branch where `new_settings` is actually bound; at 12 spaces it lands after that `if` and runs
against a possible `None`:
```python
                max_bytes = request.app.state.settings.user_settings_max_bytes
                if len(json.dumps(new_settings).encode()) > max_bytes:
                    raise EnvelopeError(422, "settings is too large.")
```
**Behavior impact:** `INTENDED — a PATCH whose merged settings exceed 64 000 bytes returned 200 and
persisted → now 422 and persists nothing, because the blob is re-read and json-decoded out of Postgres
by the auth dependency on every authenticated request that account makes, so an unbounded field
starves the `db_pool_max = 5` pool that also serves live SSE turns.` Shipped keys (`theme`, `default_source_config`,
`onboarding`) are low hundreds of bytes, so no legitimate client changes.
**Fix risk:** LOW — but check for existing over-ceiling rows first, since the guard runs on the merged
result and such a user could not change any setting until they shrink it:
```sql
SELECT id, pg_column_size(settings) FROM counselle.users ORDER BY 2 DESC LIMIT 5;
```
**Effort:** 15 min.

---

### Z1 — A malformed cursor 500s instead of returning the first page *(MEDIUM)*

**Location:** `app/sessions.py:131-142`

`_decode_cursor` validates the base64 but returns the id as an arbitrary `str`, bound against a
`uuid` column; asyncpg raises `ValueError` (verified locally) and nothing catches it — contradicting
the function's own docstring ("never a 500").

**Surgical fix:** validate the decoded id as a UUID and fall back to the first page on failure.
**Behavior impact:** `INTENDED — a malformed cursor returned 500 → it now returns the first page with
200, because `_decode_cursor`'s own docstring promises "never a 500" and an unhandled asyncpg
ValueError on a client-supplied string is that promise being broken.` Pre-verified against
the two existing cursor tests (`tests/api/test_b4.py:70-79`) — both pass unchanged. **Effort:** 10 min.

---

### Z2 / Z3 — Uncapped free text and uncapped bulk id lists *(MEDIUM)*

**Z2 — `app/workspace/models.py:486, 509-556`.** `ActivityCreate/Patch`, `HonorCreate/Patch`, and
`EssayPromptDraftConvert.title` are plain `str` while the same module already defines
`ProfileText`/`ProfileShortText`. With the 51 MB body ceiling × 240 writes/min, one account can PATCH
**~12 GB/min of durable Postgres row versions**. Fix: apply the existing `ProfileText` /
`ProfileShortText` aliases — **no new threshold is introduced**; these are the module's own already-
shipped caps, `PROFILE_TEXT_MAX_LENGTH = 5_000` and `PROFILE_SHORT_TEXT_MAX_LENGTH = 500`
(`app/workspace/models.py:64-65`), already applied to every comparable profile field. No legitimate
client payload exceeds them: an activity description or honor title is a Common App field bounded far
below 5,000 characters, and the same aliases already govern `must_haves`, `languages` and the other
free-text lists these models sit beside.
`Behavior impact: INTENDED — an ActivityCreate/Patch, HonorCreate/Patch or
EssayPromptDraftConvert.title of arbitrary length returned 201/200 and persisted → over 5,000 chars
(500 for short text) it now returns 422 and persists nothing, because the only ceiling today is the
~51 MB body limit sized for CDS PDF uploads, which lets one account write ~12 GB/min of durable row
versions into a field the product bounds at a few hundred characters.`

**Z3 — `api/routes/tasks.py:29-36`, `api/routes/activities.py:34-35`.** Bulk/reorder `ids: list[UUID]`
is uncapped (~1.3 M UUIDs fit in a body). Pydantic parses them **synchronously in the request
coroutine**, stalling every in-flight SSE stream, only to 422 afterwards. Fix: add
`Field(max_length=BATCH_ITEMS_MAX)` — **no new threshold is invented**; `BATCH_ITEMS_MAX = 20`
(`app/workspace_mutation_receipts.py:61`) is the batch bound this surface already enforces
downstream, so the cap only moves the *existing* limit earlier in the request. No legitimate client
payload exceeds it: the UI's bulk-status, bulk-archive and reorder controls all operate over a single
rendered list, and anything above 20 is already rejected after parsing today.
`Behavior impact: INTENDED — a bulk/reorder body carrying more ids than the batch bound parsed all of
them synchronously in the request coroutine and then 422'd → it now 422s before parsing, because the
oversized body is rejected either way and the only thing the current order buys is a multi-second
stall of every in-flight SSE stream sharing the event loop.`

**Deliberately not raised** (recorded so they are not re-litigated): the DOCX/PDF decompression-bomb
surface (already documented and mitigated at `app/workspace/extraction.py:22-25`), and adding a
redundant `user_id` predicate to a DELETE where `owned_session` already proved ownership.
`EssayCreate.content` is also uncapped — **no ceiling proposed**, because an essay genuinely is
long-form and a wrong guess silently truncates a student's work.

---

## 6. TIER 3 — Turn both quality gates green

`CLAUDE.md` documents `uv run pytest -m "not live_llm and not live_search and not live_db"` and
`uv run ruff check . && uv run mypy .` as the routine gates. Both are RED on clean `main`, which is
**why the tier contradiction in B-1 survived** — a red gate stops being a signal.

### The eight failures, with verdicts

**Every row gives an exact file, line and edit.** An earlier draft gave a one-phrase instruction and
no location for six of the eight, and used "Same" across two rows that live in *different files* —
which is precisely the guessing §0 forbids, in the one phase everything else is verified against.

| # | Test | Verdict | Exact fix |
|---|---|---|---|
| 1 | `test_build_runtime_creates_workspace_bus_without_seed_asset` | **TEST STALE** — `55509d3` added `settings.cds_data_enabled` and touched no test files | **`tests/app/test_deps_workspace.py:42`**: `settings = SimpleNamespace(db_app_dsn="postgresql://app", workspace_event_queue_size=7)` → add `, cds_data_enabled=True` inside the call. |
| 2 | `test_golden_full_turn_events` | **TEST STALE** — see R1 below | **`tests/app/test_protocol_fixtures.py:207`** (the `source="web"` / `url="https://example.com/1"` citation): `tier="official"` → `tier="community"`, **then** regenerate. Binding order in "R1 + T6" — do not regenerate first, and do not touch the other four `tier="official"` literals. |
| 3 | `test_golden_full_fidelity_transcript` | **TEST STALE** — same cause | Same single edit as row 2 — one literal fixes both tests. No second edit. |
| 4 | `test_toolset_lacks_disabled_sources_and_ask_student` | **TEST STALE** — `.edu` catalog gate is deliberate (R2 part 1) | **`tests/app/test_run_turn.py:242`** (inside `Rig.__init__`'s `ToolDeps(...)`, *not* the `AppDeps` stub at `:238`): `catalog=None,` → `catalog=SimpleNamespace(school_count=1),  # type: ignore[arg-type]`. The gate is `app/toolset.py:188`, `getattr(deps.catalog, "school_count", 0) > 0`, and `deps` there is the **`ToolDeps`**. |
| 5 | `TestSourceGating::test_all_enabled_builds_all_three_tools` | **TEST STALE** — same cause | **A different file from row 4.** **`tests/app/test_toolset.py:68`** (inside `Rig.__init__`'s `ToolDeps(...)`): `catalog=None,` → `catalog=SimpleNamespace(school_count=1),  # type: ignore[arg-type]`. |
| 6 | `TestSourceGating::test_reddit_disabled_means_no_reddit_tool` | **TEST STALE** — same cause | Same single edit as row 5 — one shared `Rig`, one edit fixes both. No second edit. |
| 7 | `TestMcpToolset::test_build_mcp_toolset_wires_stdio_child_and_registry_hook` | **TEST STALE** — `991f8b8` "fix: launch mcp child with runtime python" changed `"uv"` → `sys.executable`, one file, no test update | **`tests/app/test_toolset.py:278`**: `assert transport.command == "uv"` → `assert transport.command == sys.executable`. `:279`'s `transport.args` assertion is already correct and stays. Add `import sys` if the module lacks it. |
| 8 | `test_setup_db_reconciles_existing_roles_and_legacy_authority` | **TEST STALE, control INTACT** — `setup_db.sql:81` has the line, parameterized to `:"target_database"` | **`tests/counselle_db/test_foundation_regressions.py:512`**, inside the `for role in ("counselle_ro", "counselle_app"):` loop at `:509`. **⚠️ Quoting trap:** the replacement string embeds double quotes, so the existing double-quoted f-string cannot simply be edited — the literal must switch to single quotes, or the naive edit is a `SyntaxError`:<br>`assert f"ALTER ROLE {role} IN DATABASE counselle_data RESET ALL" in setup`<br>→ `assert f'ALTER ROLE {role} IN DATABASE :"target_database" RESET ALL' in setup` |

**`Behavior impact` (all 8 rows): `NONE — behavior-neutral` — test files only, zero production files
touched.** *(Traceability: rows 1/4/5/6 are source `05` T4, row 7 is `05` T3 / `01b` R6, row 8 is `05`
T5, rows 2/3 are `01b` R1 / `05` T6. The plan uses the finding IDs `R1`, `T2`–`T8`; `R6` has no
separate entry because its content is row 7.)*

### R1 + T6 — the fixture regeneration trap *(binding ordering constraint)*

`tests/app/test_protocol_fixtures.py:205-210` hand-authors `tier="official"` for
`https://example.com/1`, reachable only because the test monkeypatches `app.viz.render_viz` away.
Production has exactly **one** tier assignment site (`adapters/tavily_tools.py:130-137`); the viz cell
reuses `entry.citation`, the same object, so they **cannot disagree in production**.

> ### ⚠️ THE ONE LINE TO CHANGE — and the four you must not touch
> **Target: `tests/app/test_protocol_fixtures.py:207`**, the `tier="official"` inside this block
> (`:205-210`), which is the `Citation` of `_CANNED_SPEC`'s second `AvailableResolvedCell`:
> ```python
>                     citation=Citation(
>                         source="web",
>                         tier="official",        # ← line 207: THIS one, and only this one
>                         vintage="Retrieved Jun 10, 2026 (live web)",
>                         url="https://example.com/1",
>                     ),
> ```
> The identifying marks are `source="web"` **and** `url="https://example.com/1"`. Re-anchor on those,
> not on the line number.
>
> **`grep -n 'tier="official"' tests/app/test_protocol_fixtures.py` returns five hits — 94, 158, 169,
> 207, 598. Four of them are decoys and are CORRECT:**
> - `:94` and `:598` — `kind="db_tool"` **step** tiers (a DB read genuinely is official).
> - `:158` — `_CDS_CITATION` (`source="cds"`; `cds → official` is a real invariant).
> - `:169` — `_PROFILE_CITATION` (`source="profile"`; likewise).
>
> Changing any of those four breaks a real invariant. **An earlier draft of this plan cited
> `:322-327` — that range is a `ModelResponse(TextPart(...))` block containing no `Citation` and no
> `tier=` at all.** If you are looking at prose about Duke's housing, you are in the wrong place.

Git is unambiguous, on the line that actually carries the literal:

```
$ git blame -L 200,212 --date=short tests/app/test_protocol_fixtures.py
83e2e85d  2026-07-15  tier="official",          ← line 207
$ git show 0fb1740 --stat --date=short
0fb1740  2026-07-30  fix: mark third-party web citations as community
  adapters/tavily_tools.py | domain/envelope.py | tests/app/test_tavily_tools.py
  tests/app/test_toolset.py | tests/domain/test_envelope_v2.py
  (test_protocol_fixtures.py NOT touched)
```

`0fb1740` (2026-07-30) set the current production behavior and did not touch this file; the test
literal was last written 2026-07-15, **two weeks earlier**. *(An earlier draft said "2026-06-18, six
weeks earlier" — that came from `git log -L 320,328`, run against the wrong region of the file, which
returns `1ba05c2` "feat: support inline visualization placement", an unrelated commit. The date was
wrong; **the conclusion — production correct, test stale — is unchanged and independently
re-verified**.)*

**The trap:** the test's own failure message says to run `REGEN_PROTOCOL_FIXTURES=1`. Doing that
**first** bakes `official` into the committed fixture and converts the only guardrail that caught
this into a rubber stamp.

**Binding order:**
1. Change `tier="official"` → `tier="community"` at `tests/app/test_protocol_fixtures.py:207` — the
   one identified by `source="web"` / `url="https://example.com/1"` above. **Leave the other four
   `tier="official"` literals alone.**
2. Only then `REGEN_PROTOCOL_FIXTURES=1 uv run pytest tests/app/test_protocol_fixtures.py`.
3. **`git diff` the regenerated fixture JSON and read it field by field.** Confirm the only changed
   fields are the `tier` values on the `https://example.com/1` source. These two fixtures are the pin
   for the entire FE↔BE contract (`specs/mvp2/plan/wire-contract.md`), and `55509d3` touched
   `api/main.py`, `app/deps.py` and `app/graph.py` without touching a single test — so an unrelated
   second drift could land in the same regenerated JSON. **Any other changed field: stop and
   investigate before committing.**
4. Then `cd frontend && npm test -- protocol-fixtures`.

`Behavior impact: NONE — behavior-neutral.` No production file changes.

### T2 — the 3 mypy errors

All three are in `scripts/finish_render_staging.py`, all `Any` laundering out of a `_request(...) -> Any`
Render REST wrapper — **verified noise**, but they keep `mypy .` red. The file has exactly one commit
and was merged without `mypy .` ever being run. It targets the Render staging DB that **expires
2026-09-18**.

**Two valid fixes. Recommendation: annotate.** An earlier draft recommended deleting the script; that
was wrong on two counts.

1. **Deletion is not behavior-neutral here, because the script is not dead code.** **Constraints §2**'s
   dead-code row requires "proven dead by exhaustive grep incl. dynamic/string-keyed references"; an operator-invoked `scripts/` tool with no in-repo
   caller is the *normal* shape for that directory, not evidence of deadness. It is a live capability
   against a staging DB that is alive until **2026-09-18**.
2. **Deleting it silently breaks a documented deploy step.** `docs/DEPLOY.md:84` invokes it:
   ```bash
   uv run python scripts/finish_render_staging.py --wait
   ```
   — in the *same document* this plan is separately editing at `:155`/`:158` for S1. Removing a script
   the runbook calls, without touching the runbook, is internally inconsistent with S1's own argument
   that `docs/DEPLOY.md` matters enough to fix. *(`grep -rn finish_render_staging` confirms the only
   other hits are historical `specs/` records, which are correctly left alone.)*

**The fix: annotate the three `_request(...) -> Any` call sites** (`:166`, `:193`, `:202`). Same green
`mypy`, zero capability loss, no runbook edit needed. `Behavior impact: NONE — behavior-neutral`
(type annotations only).

**If the owner prefers deletion anyway**, it must be *"delete the script **and** remove
`docs/DEPLOY.md:83-84`, the Render-staging finish step, which targets a DB expiring 2026-09-18"* —
`docs/DEPLOY.md` joins T2's file list in that case. It is not offered as the recommendation.
**T2 is in scope:** **constraints §5** excludes only `scripts/cds_*`.

### T7 — a test that asserts nothing

`test_event_order_final_answer_streams_staged_cards_after_answer_delta` is a one-line alias with
zero assertions of its own. A named test that checks nothing is worse than no test, because it reads
as coverage.

**Fix: delete it.** An earlier draft also offered "or give it a real assertion" — **that option is
cut.** Writing a new assertion for an event-ordering test that is not honesty-critical, is not
pinning a known bug, and is not gnarly logic is a reflexive test, which the house style rejects
outright (**constraints §3**, quoting `CLAUDE.md` "How we build": "no TDD, no reflexive tests"). Deletion is the only option consistent with the same
stance the finding's own reasoning invokes.
`Behavior impact: NONE — behavior-neutral` (removes a zero-assertion alias; no production file
touched, no coverage of any behavior lost).

---

## 7. TIER 4 — Dead code, duplication, cheap wins

The **dead-code deletion** rows (D3, H4, S3, P11) were proven dead by exhaustive grep **including
dynamic lookups** (string-keyed registries, LangGraph node names, skill/tool/SSE-event names,
settings read by name, `getattr`), per **constraints §2**'s dead-code bar. **P8 is not one of them:**
`app/workspace/agent_tools_mutations.py:483` is reachable, executing code that no grep can prove
dead — it is the deletion of a **redundant re-fetch**, admissible on the basis its own row states
(`apps`/`essays` are already bound from `:463` and nothing between the two lines rebinds them), not
on a deadness grep. The section also carries rows that are
not deletions — L5 and S4 are behavior changes with their own `INTENDED` labels, D4 is a
de-duplication, and R7 / P9 / P10 are corrections to text that states the opposite of what the code
does. Read each row's own `Behavior impact:` line; the section heading is not a claim about any
individual row.

**Every row carries its own `Behavior impact:` line.** An earlier draft used a blanket section header
("all behavior-neutral unless noted") instead — and that blanket is exactly what swallowed L5, which
is *not* behavior-neutral. No blanket, no exceptions.

| ID | Location | What | Fix + `Behavior impact:` |
|---|---|---|---|
| **L5** | `domain/events.py:430` | `ev_sources` dumps in Python mode → `Citation.retrieved_at` stays a `datetime` → `_event_nbytes`' `json.dumps` throws → **the largest event of every CDS-citing turn is charged 256 bytes instead of 28,869** (113×). The BC-01 OOM guard is blind to its dominant term. | `mode="json"`. `Behavior impact: INTENDED — the largest event of every CDS-citing turn was charged 256 B instead of ~28.9 KB, so the BC-01 byte budget and its head eviction fired far later than configured → the event is now charged its real size and eviction fires at the configured budget, because a guard blind to its dominant term is not the configured guard.` **See the box below — this row is not a cheap win.** |
| **D3** | `app/tool_overflow.py:314-325` | `_domains_of` is unreachable — its only call site resolves to a same-named twin in `app/steps.py:869`, and `steps.py` never imports `tool_overflow`. **Worse than unused:** the dead copy returns `[]` where the live one returns `None`, so anyone grepping the name reads the wrong contract. | Delete the range. `Behavior impact: NONE — behavior-neutral` (proven-dead function, no reachable call site). |
| **D4** | `counselle_db/service.py:358-361` + `:413-429` vs `evals/runner.py:486-489` + `:542-558` | `_ordered_column` and `_join_has_exact_document_keys` are **byte-identical**. One *gates* student-facing `query_database` SQL; the other *grades* it. Change the rule in one and the eval grader silently scores against the old one. | **In `evals/runner.py`, delete `_ordered_column` (`:486-489`) and `_join_has_exact_document_keys` (`:542-558`) and import both from `counselle_db.service`** — `counselle_db/service.py` keeps the canonical definitions and is not edited. **Scope strictly to those two.** The wider ranges an earlier draft cited (`service.py:353-431` / `runner.py:482-599`) also enclose `_selected_document_cte`, which **does differ between the two files** (`-> str \| None` vs `-> tuple[str, exp.Select] \| None`) — folding that in would be a real behavior change, not a de-duplication. `Behavior impact: NONE — behavior-neutral` (byte-identical bodies replaced by an import). **See the box below — the direction is load-bearing.** |
| **H4** | `counselle_db/db.py:75-84` | Two proven-dead helpers, one scaffolding a feature ADR 0031 decided against. | Delete. Also fix `counselle_db/db.py:1` — the module docstring says "pool factory + fetch helper" and would otherwise describe a deleted function. `Behavior impact: NONE — behavior-neutral` (proven-dead helpers + a docstring). |
| **S3** | `config/settings.py:321` | `allowed_hosts` is a **security setting wired to nothing** — single-hit exhaustive grep. An operator can set `COUNSELLE_ALLOWED_HOSTS`, boot cleanly, and believe Host filtering is on. It is not. | Delete the line. `Behavior impact: NONE — behavior-neutral` — the field is read by nothing, and `extra="ignore"` (`config/settings.py:63,108,155`) means a deploy still setting the env var cannot crash. |
| **S4** | `api/main.py:244-248` | The SPA-fallback `/v1/*` 404 hardcodes `trace_id: None` while every other envelope reads the real id — the 404 is un-triageable. | **Three edits, all required — there is no `request` in scope today.** (1) `api/main.py:30` is `from fastapi import Depends, FastAPI, HTTPException` → add `Request`. (2) `api/main.py:241` is `async def spa_fallback(full_path: str) -> FileResponse \| JSONResponse:` → `async def spa_fallback(full_path: str, request: Request) -> FileResponse \| JSONResponse:`. (3) only then replace the hardcoded `"trace_id": None` with `getattr(request.state, "trace_id", None)`. Applying (3) alone is a `NameError` at request time on the `/v1/*` 404 path; `spa_fallback` is nested inside `_install_spa_routes` (`:209`), whose enclosing scope has no `request` either. Adding a `Request` parameter to a FastAPI handler is signature-only — FastAPI injects it by type and it does not appear in the path or query schema — so routing is unchanged and the label below still stands. `Behavior impact: INTENDED — the /v1/* SPA-fallback 404 envelope's trace_id was always null → it now carries the request's real trace id, because an error envelope that cannot be tied back to its request is untriageable, and it is the only envelope in the app that lies about having no id.` |
| **R7** | `app/toolset.py:113-117` | Constant's comment says 30 s, value is 60.0; the constant is test-only (production reads the Settings surface). | Correct the comment to 60 s. `Behavior impact: NONE — behavior-neutral` (comment text only). **Not argued as a bug** — there is no failing scenario and no reachable consequence. It ships only as a zero-risk comment correction bundled into Phase E, and it is the first thing to cut if the plan is trimmed. |
| **P8** | `app/workspace/agent_tools_mutations.py:483` | `update_task` re-runs `active_workspace_links` it already has in scope — four extra round-trips, two on the read-only catalog pool. | Delete the line; `apps`/`essays` stay bound from `:463`. `Behavior impact: NONE — behavior-neutral` (a pure deletion of a redundant re-fetch of data already in scope). |
| **P9** | `app/workspace_mutation_receipts.py:199-209` | The docstring claims the opposite of what the code does. | **Fix the docstring only.** `Behavior impact: NONE — behavior-neutral` (documentation). **The code replacement is cut** — see the box below. |
| **P10** (comment only) | `app/workspace/agent_tools_profile.py:186` | The comment reads `# Decimal (GPA fields) and any other JSON-mode scalar not covered above.` — but `_build_patch_dict` (`:169`) dumps `mode="json"`, so pydantic has already turned every `Decimal` into a `str` and the `isinstance(value, (float, str))` branch at `:184` catches it. The tail the comment describes as the GPA path is the one path GPA never takes. | Correct the comment to say the tail is the not-otherwise-covered fallback, and that GPA arrives as a `str` and is handled at `:184`. **Do not touch the code** — see the box below. `Behavior impact: NONE — behavior-neutral` (comment text only; same class as P9's docstring). |
| **P11** | `app/workspace/agent_tools_essays_content.py:51-57` | `_parse_version` takes an `essay_id` it never uses. | Drop the parameter; update the one call site. `Behavior impact: NONE — behavior-neutral` (a genuinely dead parameter — **constraints §2**'s dead-code row). |

**`D1` is not a row here.** `03`'s finding ID `D1` and this plan's **§3 D2 Part A** are the *same
one-line edit* (`counselle_db/packets.py:11` import + `:427` call `format_cds_edition`) — source `03`
says so in as many words ("Part A … **this is D1**"). An earlier draft scheduled it twice, in Phase B
*and* Phase E, under §10's one-commit-per-ID rule; the second commit would have been an empty diff and
the log would show two edition fixes. **It ships exactly once, as D2 Part A in Phase B.**

> **⚠️ D4's direction is the whole fix — the other direction is a circular import.**
> An earlier draft of this plan said *"import the two named functions in `counselle_db/service.py`
> from `evals/runner.py`"* ← **DO NOT SHIP THIS.** `evals/runner.py:38` is
> `from counselle_db.service import get_domain`, so importing back the other way makes importing
> `counselle_db.service` import `evals.runner`, which re-enters a partially-initialised
> `counselle_db.service` whose `get_domain` is not yet bound — an **`ImportError` at process start on
> the production read path**, shipped under a `NONE — behavior-neutral` label. Independent of the
> cycle, the direction is also wrong on its own terms: `evals/runner.py:27-35` imports
> `app.run_turn`, `app.deps`, `app.agent_node` and `app.workspace.*`, so it would drag the entire
> agent runtime into `counselle_db` at import time, and it inverts ADR 0017's inward-only dependency
> rule — the very rule §8 R1b invokes to refuse a *smaller* change.
> **The shipped direction is the reverse:** `counselle_db/service.py` keeps the definitions
> untouched; `evals/runner.py` — which already imports from that module — deletes its two copies and
> imports them. That follows the existing dependency edge, adds no new one, and touches no
> production file.
> **Verification before the edit:** re-diff the two bodies at the moment of the edit and confirm they
> are still byte-identical; if they have drifted, D4 is no longer a de-duplication and must be
> re-opened rather than applied. **Risk: LOW** — one eval-harness file, no production file, no new
> import edge.

> **⚠️ L5 is not a bookkeeping fix — read this before shipping it.**
> `_event_nbytes` (`app/turns.py:140-152`) returns `len(json.dumps(event.data)) + 256`, falling back
> to the bare `_EVENT_OVERHEAD_BYTES = 256` (`:86`) on `TypeError`/`ValueError`. That number is not
> diagnostic: `_RingBuffer.append` (`:196-210`) charges it against the process-wide budget via
> `on_charge` and **evicts heads while `headroom < 0`**, and a consumer needing an evicted seq is
> terminated with "your connection fell behind". So correcting 256 B → ~28.9 KB (113×) makes the
> shared budget deplete far faster on every CDS-citing turn, firing eviction — and therefore
> fallen-behind terminations and failed Last-Event-ID resumes — at loads where it does not fire
> today. The "verified `encode_sse` bytes identical" check speaks to the *wire encoding*, which was
> never in question; it says nothing about the *accounting*, which is the entire point of the change.
> **Added verification (see §11):** measure the ring-buffer headroom delta on a representative
> CDS-citing turn before and after, and confirm the configured byte budget is still sized for a
> normal turn — otherwise this fix converts a silent OOM risk into a visible fallen-behind regression.

> **⚠️ P9's code replacement is cut; only the docstring fix ships.**
> The entry's own account is that the strip pass "strips exactly the items it then discards —
> **provably equivalent to** `tuple(items[:BATCH_ITEMS_MAX])`." By that account there is no wrong
> output, no failing input, and no reachable defect: only wasted work. §0's corollary is explicit —
> *"this looks wrong but nothing depends on it" is not licence to change it*, and a live,
> provably-equivalent code path has no bug behind it. The docstring, which states the opposite of
> what the code does, **is** a real defect and is behavior-neutral to fix. That half stays.

> **⚠️ P7 is cut — performance only, no failing scenario.**
> P7 (`app/workspace/agent_tools_profile.py:386`: `read_document` pulls up to 15 MiB of bytea the
> agent tool never reads) describes real wasted latency but names no wrong output and no failing
> input, so it clears none of **constraints §2**'s rows. §13 already cuts `_fetch_groups` by exactly that rule
> ("performance only, no failing scenario"), and P7 costs *more* than `_fetch_groups` would — it
> changes a service function's signature and adds a call-site argument. Applying the rule to one and
> not the other was an inconsistency. **P8 stays** — it is a pure deletion of a redundant re-fetch,
> which is admissible as a cheap win on its own terms. Recorded in §13.

> **⚠️ P10 is split: the comment correction ships as a Tier-4 row; the typed-shape question is cut
> as not-schedulable. It is no longer an owner decision.**
> `app/workspace/agent_tools_profile.py:172-187` — pydantic serializes `Decimal` → `str` in JSON
> mode, so GPA rides receipts as `kind:"text"`, contradicting the typed-value contract. An earlier
> draft made this **Owner Decision 7**. That was an over-escalation, and applying the plan's own
> W2 rule shows why: **a fork needs two executable branches, and this one has none and one.**
> - **Branch one** ("leave the code alone, correct the comment") ships nothing and changes nothing.
>   An option that changes nothing needs no owner. It is a false comment beside live code — the same
>   class as P9's docstring and R7's constant comment, both of which ship as Tier-4 rows — so it
>   ships as one too, in Phase E.
> - **Branch two** (route numeric strings to `decimal_value`) has **no before/after snippet**, and it
>   is not one line away from having one. `ProfileDecimal` (`app/workspace/models.py:97`) is used by
>   at least eight leaves across four sections — `gpa_unweighted`/`gpa_weighted`/`gpa_scale` (`:597-599`),
>   the `sections` dict (`:645`), `predicted`/`final` (`:666-667`), `budget_per_year`/`sai_estimate`
>   (`:729-730`) — so re-typing them needs a *rule* for which paths are decimal (a path allowlist? a
>   re-dispatch before `_build_patch_dict`'s `mode="json"` dump at `:169`? a change to that dump?),
>   each with a different blast radius, and none of them is stated anywhere. By **constraints §1**
>   that is not schedulable, which is exactly the disposition W2 got (Owner Decision 4 exists there
>   only because W2 has *two* candidate shapes; P10 has none). Recorded in §13.
>
> **Also: "delete the dead branch" is not an executable instruction.** `decimal_value(value)` at
> `:187` is **not** a branch — it is the function's unconditional tail return:
> ```python
>     if isinstance(value, (float, str)):
>         return text_value(str(value))
>     # Decimal (GPA fields) and any other JSON-mode scalar not covered above.
>     return decimal_value(value)
> ```
> Deleting `:187` leaves `_typed_exact_value` falling through to `None` against a `-> MutationValue`
> annotation: `mypy` fails and the runtime contract breaks. "Folding the tail into the preceding
> branch" (`return text_value(str(value))` unconditionally) is **not** zero-risk either — it is a
> behavior change if the tail is ever reachable, so it cannot carry a `NONE` label. **The comment
> correction is the only edit this plan ships for P10.**

---

## 8. TIER 5 — Honesty tests that must exist

The house style rejects reflexive tests and coverage targets. These four are the **honesty
carve-out**: each pins a rule that is currently unverified and whose regression would lie to a
student. Items 1–3 ship in Phase B; item 4 ships with R3 in Phase F, if Owner Decision 5 takes it.

1. **T8 — one source carries one tier.** No test asserts that a given source's tier is identical
   across viz cells **and** the sources rail. `web` has no `Citation` invariant (unlike
   `reddit → community` and `edu → official`), which is exactly why the stale literal went undetected
   since `0fb1740` (2026-07-30). Add one test that builds a turn with a web source and asserts the
   tier matches in both surfaces.
2. **H1 — `verified <= configured`.** No test pins that the availability summary's numerator cannot
   exceed its denominator. Add a narrow regression building a `DomainResult` from a packet on a
   superseded manifest.
3. **H3 — a digit-free raw cell cannot become a reported number.** Add a `parse_packet_row` unit test
   feeding a `verified`+`reported` `integer` metric with `value=0, raw_value="-"` and asserting
   `ServiceError`. Add a second case with `raw_value=""` asserting it is **accepted** — that pins the
   `.strip()` condition, without which this fail-closed guard drops honest packets.
4. **R3 — a Reddit-sourced cell cannot carry a model-typed number.** The pinning test §3 R3 calls for,
   counted here rather than left uncounted: it pins ADR 0014's community-quantification ban against
   the `app/viz.py:365` membership set. **Ships only if Owner Decision 5 takes R3.**

*(Count corrected: an earlier draft said "3" while proposing five tests in total. Four are listed
above. The fifth — L1's cancel-vs-checkpoint integration test — is **not** a test asset: it exists to
falsify L1's own HIGH-confidence claim about LangGraph checkpoint ordering, so it is a **verification
step** for the diagnosis, recorded in §11 and cheaper to run once by hand than to keep.)*

**Explicitly NOT proposed:** reintroducing any programmatic answer-validator. Those were deliberately
removed; inline `[N]` citations are the sole honesty gate.

**R1b — noted, not proposed.** The missing `web` tier invariant is real and is the root reason this
class of bug hides. Expressing it in `domain/envelope.py` requires moving `_is_official_domain` out of
`adapters/` into `domain/` (ADR 0017 forbids the import direction) — a **structural change, not a
surgical one**, so §0 rules it out. Recorded as the reason, not as a fix.

---

## 9. H1 — the latent CRITICAL

### H1 — `get_domain` counts N against the packet's manifest but M against the current one

**Location:** `counselle_db/service.py:854-914` · **Severity:** CRITICAL but **latent** (verified:
0 of 65 active packets sit on a non-current manifest)

`domain` is the **current** manifest's domain; `definitions` is the **packet's own (historical)**
manifest domain. `rows`, `verified`, `available` and `absent` are computed over the historical set
while `configured` and the summary denominator use the current one.

**Concrete failure.** 5.0.2's `enrollment` had **134** metrics; 5.1.0's has **4**. A school whose
active `enrollment` packet is still 5.0.2 (the view filters on `is_active` and
`status IN ('validated','partial')`, **not** manifest version) with 120 verified renders:

```
summary = "120 of 4 metrics verified"
availability = AvailabilitySummary(configured=4, verified=120, available=118, ...)
```

The student is told, verbatim, **"120 of 4 metrics verified"**, and any downstream percentage renders
as ~2950% coverage. `DATABASE_GUIDE` §6 requires M to be the current-manifest configured count and N
the verified count — they must be commensurable.

**Surgical fix** — constrain the counts to refs the current catalog still configures:
```python
    current_refs = {metric.ref for metric in domain.metrics}
    verified = sum(
        metric.extraction_status == "verified"
        for ref, metric in packet.packet.metrics.items()
        if ref in definitions and ref in current_refs
    )
    available = sum(row.available for row in rows if row.ref in current_refs)
    absent = sum(
        row.availability_status == "not_in_template_version"
        for row in rows if row.ref in current_refs
    )
```
`rows` are deliberately left alone — presenting a legacy packet's metrics under their own historical
definitions is the pinned-manifest rule the packet boundary already enforces
(`tests/counselle_db/test_catalog_contract.py:480`), and every such row already carries
`definition_drift`.

**Behavior impact:** `INTENDED — for a packet whose manifest_version differs from current,
summary/availability change from a cross-catalog count to a same-catalog count, because reporting
historical metrics against a current denominator is a false coverage claim.` **For all 65 live
packets `set(definitions) == current_refs`, so outputs are byte-identical.** **Effort:** 20 min.

---

## 10. Execution order

Dependencies are real; this order avoids rework.

> **⚠️ All line numbers in this plan are relative to clean `main`, and they drift as you work.**
> §10 orders by severity, not by file, so several findings land in one file across a phase. Where they
> do — **`counselle_db/packets.py`: H3 (`:295`), D2 Part A (`:427`), H2 (`:454`)** ·
> **`app/turns.py`: L1 (`:1171`), L3 (`:533`)** ·
> **`app/workspace/essay_markdown.py`: W1 (`:318`)** — apply them **bottom-up by line number**, or
> re-anchor on the quoted snippet. **The snippets, not the numbers, are authoritative.**
> Concretely: H3 inserts ~10 lines at `:295`, so by the time D2 Part A and H2 are applied their stated
> anchors are ~10 lines stale. (`app/turns.py` happens to be safe only because Phase C's order is
> coincidentally descending — do not rely on that.)
>
> **The same hazard exists *inside* a single finding with more than one site, so it is not enough to
> order the phase by file:**
> - **`adapters/tavily_tools.py` — R5 (Phase B) has three sites, `:365-378`, `:432`, `:540-544`, and
>   §3 presents them as Site 1 = `:432` first.** Do **not** apply them in the order printed: `:432` is
>   a pure insertion, so applying it first shifts `:540-544` downward. **Apply `:540` before `:432`**,
>   and `:365-378` (the lowest) last — or re-anchor each on its quoted snippet.
> - **`api/routes/me.py` — S2 (Phase D) edits two places in one file.** The fix adds `import json` to
>   the stdlib import block near the top **and** inserts a guard after `:139`. The import lands above
>   the anchor, so `:139` becomes `:140` before the second edit. Either insert the guard first, or
>   re-anchor on S2's own stated landmark ("immediately after `new_settings = _merge_settings(…)`,
>   inside the `if settings_patch is not None:` branch, at 16 spaces").
> - **`evals/runner.py` — D4 (Phase E) makes three edits in one file:** delete `:486-489`, delete
>   `:542-558`, and add the import beside `:38`. Delete `:542-558` **before** `:486-489` (deleting the
>   lower range first shifts the upper one up by 4), and add the import last — or delete by function
>   name, which is what the row actually identifies.
>
> Also note **S1 (Phase D) has two hunks in `scripts/entrypoint.sh`** — `:4-8` (the `required_env`
> list) and `:35` (the uvicorn flag). Adding one line at `:4-8` shifts `:35` to `:36`. Apply the
> `:35` hunk first, or re-anchor on `--forwarded-allow-ips`.

**Phase A — make the gates trustworthy (behavior-neutral only).**
Tier 3 in full: the eight stale-test fixes (R1's ordering constraint is binding — including the
field-by-field fixture diff at step 3), T2 (annotate), T7 (delete). End state: `pytest` green, `ruff`
clean, `mypy` clean. **Nothing else starts until this is true** — every later phase is verified by
these gates, and a red gate is why B-1 survived.

**Phase B — honesty-critical.** H3 (re-run the enumeration query first; ships by default per Owner
Decision 1), H1, H2 (carry-through only; Owner Decision 2 deferred), R5, D2 Part A. Then Tier-5
honesty tests 1–3.
> **⚠️ H2 re-stales the Phase A goldens.** `DomainRow.unit` is model-visible through
> `counselle_db/server.py:184`'s `model_dump(mode="json")`, so if the protocol fixtures cover
> `get_domain` rows they go red again. **After H2, run a second
> `REGEN_PROTOCOL_FIXTURES=1 uv run pytest tests/app/test_protocol_fixtures.py`, read the diff field
> by field under the same §6 discipline, then `cd frontend && npm test -- protocol-fixtures`.**
> Schedule H2 **last** among the `counselle_db/packets.py` edits so the regeneration happens once.

**Phase C — data integrity.** L1, L2, L3, L6, P1, P2, P3, P4, P5, P6, P12, W1.
**Not scheduled, and why:** **W2** and **W3** both need the same unspecified `_align_container`
carry-over shape (Owner Decision 4) — and W3's originally-proposed escape was withdrawn outright,
because it injects a literal backslash into the student's essay. **L4** is Owner Decision 6 (it
overrides `TODOS.md:50-51`'s "do not guard piecemeal").

**Phase D — security.** S1 (`scripts/entrypoint.sh` hunks 1a+1b **and** `docs/DEPLOY.md:155`/`:158`
**and** the `api/ratelimit.py` comments — the entrypoint is the part that actually closes the hole),
S2, Z1, Z2, Z3.
> **⚠️ S1 has a deploy-ordering precondition.** Hunk 1a adds `COUNSELLE_TRUSTED_PROXY_CIDR` to
> `scripts/entrypoint.sh`'s `required_env` list, so a container without it exits before `exec
> uvicorn`. **Set the variable on the live Render service first, then land the commit.** Landing it
> first crash-loops the running demo.

**Phase E — cheap wins and deletions.** L5 (with its buffer-headroom check), D3, D4, H4, S3, S4, R7,
P8, P9 (docstring only), P10 (comment only), P11.
**Not in this phase:** **D1** — it is `03`'s ID for what ships as **D2 Part A** in Phase B, and
scheduling it here too would produce an empty second commit. **P7** — cut (§13). **P10's typed-shape
half** — cut as not-schedulable (§13); only its comment correction is in this phase.

**Phase F — owner decisions.** Resolve **1–6**, then implement whichever they select:
1 (H3 blast radius) · 2 (unit → `display`) · 3 (canonical edition spelling) · 4 (W2 fix shape, which
also unblocks W3) · 5 (R3 / ADR 0014-vs-0032) · 6 (L4 / override "do not guard piecemeal").
Tier-5 test 4 ships here, with R3, if decision 5 takes it.

Suggested commit granularity: one commit per finding ID, message `fix(<area>): <finding> [ID]`, so any
single fix can be reverted independently. **Note the ID collision:** `D1` in this plan always means
`03`'s edition-string finding; `01a`'s unrelated `D1` is called **D1-lifecycle** (§13) and ships
nothing.

---

## 11. Verification protocol

After **every** finding:
```bash
uv run pytest -m "not live_llm and not live_search and not live_db"
uv run ruff check . && uv run mypy .
```
Both must be green — and after Phase A they will be, so any new red is caused by the change in hand.

Additional gates:
- Any `counselle_db/` change: `uv run python scripts/cds_manifest_check.py` (P1 hard gate — stop and
  escalate if the hash changes).
- H3, before applying: re-run the digit-free enumeration query in §3. If it returns more than the one
  known row, fix the data first. *(That query also settles the `raw_value=""` question the `.strip()`
  condition guards against — `'' !~ '[0-9]'` is TRUE, so an empty-raw row would show up in it.)*
- R1: the **four-step** ordering in §6. Never regenerate first, and **never commit a regenerated
  fixture without reading its diff field by field** — only the `tier` values on the
  `https://example.com/1` source may change.
- **H2, after applying: a second fixture regeneration**, same field-by-field diff discipline, plus
  `cd frontend && npm test -- protocol-fixtures`. `DomainRow.unit` is model-visible via
  `counselle_db/server.py:184`.
- **L1, before implementing:** settle the LangGraph checkpoint-ordering question by hand (cancel while
  a stubbed `touch_session` blocks on an `asyncio.Event`; observe whether the snapshot carries the
  node's record) and record the result. This establishes the diagnosis — it is a verification step,
  not a committed test.
- **L5, after applying:** measure the `_RingBuffer` headroom delta on a representative CDS-citing turn
  before and after, and confirm the configured byte budget is still sized for a normal turn. The
  charge moves 256 B → ~28.9 KB, which changes when head eviction and "fell behind" terminations
  fire. *(The pre-existing "`encode_sse` output is byte-identical" check is still worth running, but
  it speaks only to the wire encoding — it does not verify the accounting, which is the point of the
  change.)*
- S2, before applying: check for existing over-ceiling `users.settings` rows.
- **S1, before committing:** set `COUNSELLE_TRUSTED_PROXY_CIDR` on the live Render service. Hunk 1a
  puts it in `scripts/entrypoint.sh`'s `required_env` list, so a container without it exits before
  `exec uvicorn`. Landing the commit first crash-loops the running demo.
- **D4, before applying:** re-diff `_ordered_column` and `_join_has_exact_document_keys` across
  `counselle_db/service.py` and `evals/runner.py` and confirm they are still byte-identical. If they
  have drifted, it is no longer a de-duplication and the `NONE` label no longer holds. **Direction is
  load-bearing:** `evals/runner.py` imports from `counselle_db.service`, never the reverse — the
  reverse is an import cycle (§7's D4 box).
- Behavior-neutral claims: for H1, confirm `set(definitions) == current_refs` on live data.
- **Every phase, before its first commit:** re-anchor the phase's line numbers on the quoted snippets
  (see §10's drift box). A stale anchor in `counselle_db/packets.py` is the likeliest way to apply an
  edit to the wrong construct.

**Do not run** `live_llm` / `live_search` suites during this work — they cost real money.
**Do not** source `.env` for the routine pytest run — it produces 2 spurious failures.

---

## 12. Coverage — what was checked and found clean

Stated so the plan's silence is informative rather than ambiguous.

- **Route authorization: zero IDOR.** All **57 in-scope routes** traced route → dependency → service →
  SQL. `user_id` scoping holds uniformly; `owned_session` is the single ownership dependency; no 403
  exists anywhere, so no enumeration divergence; no injection; no path traversal (the documents path
  never touches the filesystem).
- **`query_database` guard: 27 escape vectors executed, all rejected** — base tables, `pg_catalog`,
  `pg_read_file`, UNION/subquery smuggling, data-modifying CTEs, `FOR UPDATE`, `packet::text`, CTE
  alias laundering, and a dynamic `->$1` key bound to `provider_contract`. Both `DATABASE_GUIDE` §8
  recipes still pass; limits enforced and disclosed as specified.
- **`DATABASE_GUIDE` compliance: 63 MATCHES / 5 DIVERGES / 0 UNIMPLEMENTED.** §7 markers verified
  MATCHES by executing the real middleware — the excerpt is stripped at `app/sources.py:187`
  (`EXCERPT LEAKS TO MODEL: False`). *Caution: a naive `"evidence" in json.dumps(...)` check gives a
  false positive — the substring lives inside the marker token.*
  **⚠️ Not every divergence is closed by this plan, and an earlier draft left that ambiguous by
  reporting the score inside a section headed "found clean" without naming the rows.** Naming them:
  the five DIVERGES resolve to **four distinct defects**, not five, and the earlier "four of the five
  are H1, H2 and H3" asserted three IDs for four rules without saying which ID covered two. Stated
  exactly, from the source's own tally (`04a-honesty-core.md:953`, which enumerates the rows as
  `H1 ×2 rows, H2 ×2 rows, H3 ×2 rows, H5 ×1 — 4 distinct defects`): **H1, H2 and H3 each diverge on
  more than one scored rule and are all fixed here** (H1 in §9 — `service.py:882-912` and the
  "N of M metrics verified" row; H2 in §3 — the dropped `unit` on `_display` and on
  `CitationEnvelope`; H3 in §3 — the `raw_value="-"` row under both "zero and false are valid
  reported values" and "never convert unavailable to zero"). **The remaining distinct defect is the
  source's H5, which this plan calls `04a` O1, and it is NOT fixed:** `_DOMAIN_ROWS_SQL`
  (`counselle_db/service.py:48`) selects
  `d.staleness_reason`, but `DomainResult` (`counselle_db/models.py:121-137`) has a `currentness`
  field and **no** `staleness_reason` field, so the reason is fetched on every `get_domain` and
  discarded. **This is the common path, not a corner: 4 of the 5 active documents are
  `stale`/`older_edition`.** The auditor self-cut it as below the **constraints §2** bar (nothing false is *shown* —
  a "why" is simply absent), and it is recorded in §13 rather than fixed. **Do not read this bullet
  as "all five divergences are covered."**
- **Workspace tool authz: clean.** All 39 tools are *unmounted* (not hidden) without an authenticated
  user; zero tool functions take a user/owner argument; every service call passes `ctx.user_id` from
  frozen turn state. No LLM-prompt-injection path to another student's rows.
- **`expected_version` (ADR 0030): sound.** `_check_not_stale` runs after `_require_essay(for_update=True)`
  inside the transaction — no TOCTOU. No content write skips it.
- **Memory (ADR 0031): clean.** No implicit writes anywhere; the 5,000-char budget is a hard reject
  under an advisory lock + `FOR UPDATE` — nothing truncated, evicted or dropped (measured: 20 accepted
  / 21 refused).
- **Turn lifecycle: no hang path.** All 10 `run_turn` exits and all 5 `run_continuation_turn` exits
  emit `done`/`error`; no reachable double-terminal; no `CancelledError` swallowed; no `create_task`
  without a strong reference; ADR 0025's prose invariant holds on all nine terminal paths.
- **Model routing: server-owned.** No request model anywhere accepts a model id, provider, thinking
  level, or `include_thoughts`. No hardcoded model ids outside Settings.
- **Structure: clean.** Zero dead public top-level names (654 checked), zero orphaned Settings fields
  (111 checked), **zero ADR 0017 layering violations**, zero pass-through modules, zero star-imports,
  3 TODO markers all legitimate. All 13 SSE event types consumed by the frontend. All 8 deptry
  "unused dependency" hits are false positives (distribution vs import name).
- **Tests: honest.** Marker correctness verified (nothing hits live LLM/search/DB unmarked), no
  silently skipped/xfailed tests, no flaky timing, only 3 mock assertions repo-wide, no secrets in logs.

---

## 13. Deliberately cut

Recorded so they are not re-raised as oversights.

- **Everything already logged in `TODOS.md`** — DS-04, DS-06, server-header CSP, session-TTL cleanup,
  sessions-list load-more, community-card viz, dev-origin allowlist. **The two logged B2
  turn-lifecycle corners are also cut** — the parked-then-non-resume ghost (`TODOS.md:50-51`) and the
  `_write_failure_record` double-failure corner (`:52-53`) are not fixed here.
  **Correction to an earlier draft of this list:** it claimed the B2 corners were cut while three
  turn-lifecycle findings were scheduled, which was a self-contradiction. The accurate statement is:
  **L1** and **L3** ship, and each carries a paragraph in §4 distinguishing it from both logged
  corners (L1 = a *completed* record duplicated, not a *parked* one ghosted; L3 = a missing admission
  check, not a new guard). **L4 does not ship** — it is the logged parked-ghost scenario and its fix
  is the piecemeal guard that item forbids, so it is escalated as **Owner Decision 6** and is in no
  execution phase.
- **CI** — proposed and explicitly declined by the owner. Not re-proposed.
- **Reintroducing output validators** — deliberately removed; citations are the sole honesty gate.
- **R1b's `web` tier invariant** — requires an ADR-0017-violating import move; structural, not surgical.
- **R5b filtered-result counts** — adds a field to the model-visible tool contract to serve a case
  where the current output is already truthful. Fails value × ease.
- **`EssayCreate.content` ceiling** — a wrong guess silently truncates a student's essay.
- **Seven in-scope files over 800 lines** — length alone is not a finding; each was navigated during
  the audit without difficulty.
- **The `4000`-char cap** — a wire-contract bound spanning FE+BE, explicitly commented as not a knob.
- **Serial `await` in `_fetch_groups`** — performance only, no failing scenario.
- **A captured cookie surviving password change/logout for 30 days** — ADR 0021 line 38 explicitly
  accepts this. *Useful for incident response:* `UPDATE counselle.users SET is_active = false` revokes
  instantly, because `read_token` re-fetches the user every request.
- **P7 (`read_document` pulls 15 MiB of unread bytea)** — performance only, no failing scenario and no
  wrong output; the fix would change a service signature and a call site. Cut by the same rule already
  applied to `_fetch_groups`. P8 survives because it is a pure deletion.
- **P10's typed-shape half** (`app/workspace/agent_tools_profile.py:172-187`: GPA rides receipts as
  `kind:"text"` because `_build_patch_dict` dumps `mode="json"`) — the contradiction with the
  typed-value contract is real, but **routing numeric strings to `decimal_value` has no specified
  shape**. `ProfileDecimal` (`app/workspace/models.py:97`) covers at least eight leaves across four
  sections (`:597-599`, `:645`, `:666-667`, `:729-730`), so any fix needs a rule for which paths are
  decimal — a path allowlist, a re-dispatch before the `mode="json"` dump at `:169`, or a change to
  that dump — each with a different blast radius on **student-visible write-record data**, and none
  of them is stated. Not schedulable (**constraints §1**), by the same rule applied to W2. An earlier
  draft carried this as Owner Decision 7; it was an over-escalation — the "zero-risk" branch changes
  nothing and the other branch has no snippet, so there was no fork to decide. **The comment
  correction ships** as a Tier-4 row in Phase E; only this half is cut.
- **W2's and W3's fixes** — the bugs are real and measured, but neither has a specified
  `_align_container` shape, so neither is schedulable (**constraints §1**). W3's originally-proposed escape was
  withdrawn outright: it injects a literal backslash into the student's essay.
- **The garbled `stale_edition` caveat sentence** (`packets.py:441` qualifiers → `service_reference.py:183`
  → `caveats.yaml:5`) — fixing it means either not passing the qualifier-laden `vintage` into the
  caveat slot or editing the template; neither has a specified shape and both change student-visible
  copy. Out of scope; see §3 D2.

**Source-declared non-findings, with the source's own reason.** §13 previously recorded ~2 of these,
which made the plan's silence unreadable — a reader could not tell "checked and declined" from
"never looked at". The full list:

- **`04a` O1 — `staleness_reason` fetched and discarded** (`counselle_db/service.py:48` selects it;
  `DomainResult` has no field for it). Source self-cut as below the **constraints §2** bar: nothing false is shown,
  a "why it's stale" is simply absent. **But it is a scored `DATABASE_GUIDE` DIVERGES on the common
  path** (4 of 5 active documents are stale) — see the caveat now attached to §12 bullet 3.
- **`04a` O3 — `ParsedPacket.currentness` dead field with a permissive default.** Source self-cut:
  no consumer, so the permissive default is unreachable.
- **`01a` D1 — dead legacy interrupt path** (`app/clarify.py`, the `interrupt()`-backed `ask_student`,
  imported by nothing but its own test). The auditor **declined deletion** because a pre-v2 parked
  checkpoint may still exist in the live database and `_unpark_if_parked`'s `has_interrupt` fallback
  is its only handling. Deferred to the ADR-0035 v1-compatibility retirement; the migration-data
  question comes first. **⚠️ ID collision:** `01a`'s `D1` and `03`'s `D1` are different findings. This
  plan's `D1` is always `03`'s (the edition string, which ships as **D2 Part A**); call this one
  **D1-lifecycle** wherever both are in play, since §10 mandates one commit per finding ID.
- **`01a` §5.2 — `build_terminal_update(usage=…)` dead parameter.** Source-declared below-bar.
- **`01a` §6 — six lifecycle items:** double-terminal hardening · `attach()` consumer-cap TOCTOU ·
  head-eviction replay vs wire-contract §6 · `user_message_id` rebind · `queued_at_terminal` ·
  `snapshot_seq`. All source-cut with reasons; §12's "turn lifecycle: no hang path" bullet is where
  they land.
- **`01b` — four not-reported items:** `search_reddit` freshness key · redundant `except` subclasses ·
  `_response_mode_unavailable` docstring · same-URL double registration. All source-cut as below-bar.
- **`02a` — six cut items:** the fastapi-users router carries neither `auth_origin_protect` nor
  `auth_rate_limit` · `allow_origins=["*"]` echo · `get_limiter` fail-open · `require_json` on
  body-less requests · `/v1/health` unauthenticated · `PATCH /v1/me` stale echo. **The first one is
  worth naming explicitly: it is the same surface as S1**, so once S1's CIDR fix lands a reader will
  reasonably ask why the password-change route is still unguarded. It is cut, not overlooked.
- **`05` T4's `getattr` cheap-win** (`app/toolset.py:188`, `getattr(deps.catalog, "school_count", 0)`
  silently disables `.edu` search forever if the attribute is ever renamed). **Declined — latent
  only**: both catalog types define `school_count` today. **This plan does not authorise that edit,
  in Phase A or anywhere else — taking it up is a new finding with its own before/after.**
  `app/toolset.py` is a production file and Phase A is declared test-files-only; the source's note
  that the item is *coupled to Phase A rows 4/5/6* is recorded for whoever eventually opens that
  finding, not as a schedule.

---

## 14. Owner decisions — consolidated

**Six.** An earlier draft's table listed four and left P10 dangling below it as an unnumbered note,
while §0.2 counted 4 and Phase F said "resolve 1–4" — so P10 was scheduled for execution in Phase E,
one phase *before* the only phase that resolves forks. R3 and L4 were not escalated at all; both are
now numbered rows. A subsequent draft over-corrected and made P10 a seventh decision: **that was an
over-escalation and it has been withdrawn** — a fork needs two executable branches, and P10 has one
branch that changes nothing and one with no snippet, so its comment half ships as a Tier-4 row and
its typed-shape half is cut as not-schedulable (§7's P10 box, §13). Every remaining row below is a
genuine fork, and nothing outside this table is pending.

| # | Decision | Finding ships in | Recommendation |
|---|---|---|---|
| **1** | H3's fail-closed guard drops UPenn's whole `financial_aid` domain, not one metric | §3 H3 — **ships by default in Phase B** | **Ship the guard now** and file the UPenn row for the CDS-admin owner. Gating this plan's top honesty fix on the **constraints §5**-excluded admin tool is the thing to avoid. "Fix the data first" is the alternative, not the default. |
| **2** | Interpolate units into `display` (`"$22,130"`, `"100%"`)? Double-marks the 152 rows whose `raw_value` already has the symbol; entangled with H3's `ratio` scale question | §3 H2 — carry-through ships in Phase B; formatting deferred | Ship H2's carry-through now; decide display formatting separately. *(The FE types but does not render `unit`, so nothing student-visible pre-empts this.)* |
| **3** | Which CDS edition spelling is canonical? | §3 D2 Part B — Phase F | **No recommendation.** (a) `"CDS 2024-25"` everywhere is specified and cheap (two lines in `app/tool_middleware.py`). (b) `"Common Data Set 2024-25"` is **unspecified** — it needs a second formatter or a change to `format_cds_edition()` that also moves `counselle_db/service.py:615` and flips the pin at `tests/counselle_db/test_foundation_regressions.py:34`. Whichever is chosen needs a `caveats.yaml` before/after written first. **Neither option fixes the garbled caveat sentence** — that is out of scope (§13). |
| **4** | W2: preserve empty paragraphs via a `&#8203;` token, or stop the loss being silent in `_align_container`? | §4 W2 — Phase F. **Also unblocks W3**, which needs the same mechanism | The `_align_container` route — smaller behavioral footprint, no HTML entity in the model's input. **But neither option has a before/after snippet, so nothing is schedulable until one is written** (**constraints §1**). The two also differ in guarantee: (a) preserves the paragraph in the projection, (b) only via carry-over, which behaves differently when the *neighbouring* block is edited. |
| **5** | Did ADR 0032's amendment widen ADR 0014's ban on quantified community sources? R3 drops `reddit` from `app/viz.py:365`'s sanctioned set | §3 R3 — Phase F (moved out of Phase B) | **Ship it** — ADR 0014's prose is explicit and unsuperseded, and there is no sanctioned surface for a Reddit number at all (the `community_card` is deferred). **Condition: whichever way it goes, record the reading in ADR 0014 or ADR 0032.** Leaving the ambiguity after acting on it is worse than either choice. Tier-5 test 4 ships with it. |
| **6** | L4 guards the parked-thread/cancel race that `TODOS.md:50-51` says **"do not guard piecemeal"** | §4 L4 — Phase F (removed from Phase C) | **No recommendation** — this is the owner's own recorded instruction and only the owner can lift it. For: measured data loss (an accepted student answer erased), 12 lines, HTTP-invisible, machinery already exists and is unit-tested. Against: it is exactly the accretion the instruction exists to prevent, and it makes the eventual single-flight rework harder. |
