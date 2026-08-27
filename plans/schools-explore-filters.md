# Schools → Explore — filter specification

Status: **design, not implemented.** Frontend-only mockup exists; no backend contract yet.

The Explore tab browses every profiled school. This document defines which metrics may
back a filter, which may not, and why. Every entry is derived from
`specs/cds-pipeline/METRICS-KEEP.md` (the 394-metric keep list) and verified against
`config/cds/domains/*.yaml` in the `feat/cds-pipeline` worktree.

Companion surface: **My list** — the existing application tracker. Its filters (status,
list type, round) are unrelated and are not in scope here.

---

## 1. The four gates

A metric becomes a filter only if it passes all four.

| Gate | Test | What it eliminates |
|---|---|---|
| **G1 — Absence is unambiguous** | A blank or unchecked value must mean "no", not "this form edition didn't ask" | 36 checkbox metrics |
| **G2 — Type is comparable** | Numeric or closed enum. Percent-semantic strings need a parsed companion first | 58 string-typed percents |
| **G3 — Definition is identical across schools** | The same thing, measured the same way, everywhere | GPA, major shares |
| **G4 — Stable year to year** | Not dominated by cohort noise | Waitlist counts |

### G1 is machine-checkable

`METRICS-KEEP.md` §"Three schema decisions" states that `not_in_template_version` must
survive to the UI as a third state, and that **no boolean carrying that sentinel can ever
be a catalog filter** — filtering "has study abroad" would silently drop every school that
used an older CDS template.

That sentinel maps exactly onto `definition_variant` in the domain YAMLs:

| `definition_variant` | Count | Filter-safe | What it is |
|---|---|---|---|
| `availability` | 24 | ❌ | Checkbox grid — unchecked means "not marked" |
| `required` (in `academics.yaml` only) | 12 | ❌ | The E3 core-curriculum checkbox grid |
| `policy` | 16 | ✅ | A real yes/no question the form asks directly |
| `selected` | 70 | ✅ | Closed enum |

**Verification command:**

```bash
cd .worktrees/cds-pipeline/config/cds/domains
grep -B8 "definition_variant: availability" *.yaml | grep -oE "id: [a-z_0-9]+"
```

Re-run this if the catalog is re-cut. The gate is the `definition_variant`, not a
hand-maintained allowlist.

**Consequence, and it is better news than the keep list implies:** Early Decision, Early
Action, application fee, and test policy are `policy`/`selected` and therefore **safe**.
Study abroad, honors program, undergraduate research, double major, student-designed
major, ROTC, and the core-curriculum grid are `availability`/`required` and therefore
**dead as filters**.

Note `definition_variant: required` also covers the admissions `*_units_required` metrics,
which are unit counts rather than checkboxes. The checkbox reading of `required` applies to
`academics.yaml` only.

---

## 2. Tier 1 — the visible filter bar

Six filters, always visible, no panel needed. They answer the six questions someone
actually opens a college search with: *where, how selective, how big, what kind, how much,
can I get in.*

| # | Filter | Control | Backing metric | Notes |
|---|---|---|---|---|
| 1 | Location | State / region multi-select | `state_or_region`, `city`, `country` | Near-total coverage. Top-3 fit factor. |
| 2 | Admit rate | Range | derived `admitted_total / applicants_total` | Switches to the residency-specific rate when home state is known |
| 3 | Size | Buckets | `undergraduate_total` | Under 2k / 2–10k / 10–25k / 25k+ |
| 4 | Public or private | Toggle | `institutional_control` | Enum, always present, drives the cost branch |
| 5 | Your cost | Range | derived sticker COA | Branches on control + residency |
| 6 | Test range fit | Preset | `sat_composite_p25/p75`, `act_composite_p25/p75` | Anchored to the student's own score |

### Design notes

**#3 uses buckets, not a slider.** Students think "small college" / "big state school",
not "4,200 students". Buckets also degrade gracefully when the metric is missing.

**#5 must handle two mutually exclusive cost shapes.** Per trap 13, schools that cannot
itemize populate `comprehensive_tuition_food_housing_amount` and blank the itemized rows;
others do the reverse. Summing without checking which shape is populated silently produces
`$0` and sorts that school to the top of a "cheapest" list. The sticker derivation must
detect the shape first.

Tuition row is selected by `institutional_control` + residency:

| Control | Residency | Row |
|---|---|---|
| Private | any | `tuition_private_first_year` |
| Public | in-district | `tuition_public_in_district_first_year` |
| Public | in-state | `tuition_public_in_state_out_of_district_first_year` |
| Public | out-of-state | `tuition_public_out_of_state_first_year` |
| any | nonresident/international | `tuition_nonresident_first_year` |

Plus `required_fees_first_year` + `food_and_housing_on_campus_first_year` + books +
transportation + other. Surface `final_costs_not_available` and `final_costs_expected_date`
as an honesty flag when present (trap 12: printed tuition is stale *below* what the
applicant will pay).

**#6 is a preset, not a raw slider.** A raw SAT range filter invites the student to filter
on numbers that describe submitters only. Options: "my score is in the middle 50%" / "at or
above the 25th percentile" / "above the 75th percentile", anchored to the score in the
personalization strip. Per trap 1, schools with `sat_submitters_percent` under 50% are
**flagged, never silently ranked** — at 38% submitted the middle 50 describes the top third
of the class.

---

## 3. Tier 2 — behind "+ Filter"

Grouped by the question they answer, not by CDS domain.

### Money

| Filter | Backing metric | Notes |
|---|---|---|
| Need fully met | derived `h2_h_need_fully_met_count_first_time_first_year / h2_c_determined_have_need_first_time_first_year` | Trap 3: use this, **not** `h2_i`. The printed `h2_i` has an aid-recipients denominator and excludes PLUS/private loans, so a school can print 100% while the family still borrows. |
| Merit aid reach | `h2_g_awarded_non_need_based_grant_aid_first_time_first_year` | Percentage getting merit regardless of need — the full-pay family's question |
| No application fee | `has_application_fee` (`policy` ✅), `application_fee_amount` | A real barrier for low-income applicants |

### Rounds and deadlines

| Filter | Backing metric | Notes |
|---|---|---|
| Offers Early Decision | `early_decision_offered` (`policy` ✅) | |
| Offers Early Action | `early_action_offered` (`policy` ✅) | Pair with `early_action_restrictive` so REA/SCEA can be excluded — it constrains the entire round plan |
| Deadline still open | `application_closing_date_fall`, `early_decision_first_closing_date`, `early_action_closing_date` | Highest-urgency filter in December |
| Rolling admission | `has_application_closing_date`, `decision_notification_mode` | |

### Testing

| Filter | Backing metric | Notes |
|---|---|---|
| Test policy | `sat_or_act_admission_policy` (`selected` ✅) | Required / optional / blind. Label "as reported" — the skills mandate a `.edu` re-verify, and `test_policy_clarification` can carry "test-blind except nursing" |

### Outcomes

| Filter | Backing metric | Notes |
|---|---|---|
| Graduation rate | `primary_all_students_six_year_graduation_rate_ratio`; derived 4-year rate | |
| First-year retention | `first_year_retention_reported_percent` | Trap 10: copied, never recomputed — the printed rate carries form-defined exclusions |

### Campus

| Filter | Backing metric | Notes |
|---|---|---|
| Students per faculty | `students_per_faculty` | Trap 8: display the `ratio_basis_student_fte` / `ratio_basis_faculty_fte` caveat. Never recompute from the bases. |
| Classes under 20 | derived from `class_sections_2_9` + `class_sections_10_19` over the band total | Not printed on the CDS form — must be computed |
| Live on campus | `college_owned_housing_percent_undergraduates` | Best available proxy for the missing campus-setting field |
| Greek life scale | `fraternity_joiners_percent_undergraduates`, `sorority_joiners_percent_undergraduates` | "Little or no Greek life" is a common ask |
| International share | derived `nonresident_all_undergraduates / undergraduate_total` | |
| Out-of-state share | `out_of_state_percent_undergraduates` | Trap 9: excludes international from both numerator and denominator — **not additive** with international share |
| Women's / men's / coed | `undergraduate_gender_model` (`selected` ✅) | The keep list explicitly names this a legitimate structural filter, kept in place of the cut gender-split cells |
| Academic calendar | `academic_calendar` (`selected` ✅) | Semester / quarter / trimester |

### Data quality

| Filter | Backing metric | Notes |
|---|---|---|
| Current-edition data only | `academic_year`, `cost_academic_year`, `aid_reporting_academic_year` | Exclude schools whose CDS edition is older than N years. Comparing a 2024–25 admit rate against a 2021–22 one is misleading, and every competitor hides this. |

---

## 4. Tier 3 — blocked on a parsed companion field

`METRICS-KEEP.md` §"Three schema decisions" #3: **58 of the 394 kept metrics are
percent-semantic `type: string`**, deliberately preserving qualifiers like `"<1%"`. That
includes every kept `*_bachelors_percent` (38), every class-rank band, and both test-submitter
rates.

The string typing is correct and must not be "fixed" at extraction. The contract belongs at
the consumption boundary:

- **Display** keeps the raw string, qualifier and all.
- **Matching math** parses to a nullable float; unparseable is **missing, never zero**.
- **No `type: string` percent may back a numeric sort or range filter without an explicit
  parsed companion field.**

Worth building companions for these, not all 58:

| Metric | Unlocks |
|---|---|
| `sat_submitters_percent`, `act_submitters_percent` | The under-50% flag that Tier-1 #6 depends on |
| `class_rank_top_tenth_percent` | A "class academic strength" filter (bands are nested — trap 6 — so never derive one from another) |
| The H2 aid percentages, if string-typed | The two money filters above |

---

## 5. Banned, with the reason

These are the filters a designer reaches for first. Each is worse than no filter.

| Tempting filter | Why not |
|---|---|
| **"Offers my major"** | `*_bachelors_percent` is a share of degrees *conferred* in one year, not a program catalog. Trap 7: **a 0% or blank row does not mean the major doesn't exist.** This filter would actively lie to a student. The most dangerous item on this list. |
| Study abroad, honors program, undergraduate research, double major, student-designed major, ROTC, core curriculum | 36 `availability`/`required` checkbox metrics — unchecked means the template didn't ask |
| Average high school GPA | Trap 2: scales differ (weighted 5.0, unweighted 4.0, 100-point) and CDS does not report which. "Never rank or diff schools on it." |
| Campus setting (urban / suburban / rural) | Absent from the data. A first-order fit filter we do not have. |
| Religious affiliation | Absent from `identity.yaml`. Do **not** mistake `selection_factor_religious_affiliation_commitment` (whether faith is weighed in admission) for the school's own affiliation. |
| Need-blind vs need-aware | Zero fields. Only fingerprintable on `.edu` per school. |
| Meets-full-need pledge | Only inferable as a realized outcome (`h2_h / h2_c`), never the pledge itself |
| Superscoring policy | Not a CDS field |
| Common App / Coalition platform | Absent |
| Waitlist odds | Trap 5: `waitlist_admitted_count` swings 0 → 400 year to year. Narrative only, never a chance input. |
| ED advantage over RD | Trap 4: ED counts combine ED I and ED II, and there are **no EA counts at all**. A derived RD rate is polluted by EA admits at any EA school. Publish only for ED-only schools. |
| Admit rate by major | Only the boolean `program_specific_factor_differences` says *that* it varies, never *how* |
| Net price by income band | Confirmed absent from both money domains — that is an IPEDS table. Point at `net_price_calculator_url`. |
| Post-graduation salary or employment | Not CDS — College Scorecard |
| Legacy or athlete admit rate | Importance only (`selection_factor_alumni_relation`), no rate |

---

## 6. The systemic rule — coverage disclosure

Every range filter silently excludes schools that are **missing** the metric, not just
schools that fail it. With imperfect extraction recall this is a large and invisible
exclusion.

**Rule: every active filter reports its exclusions and offers a one-click override.**

```
412 schools  ·  38 hidden — no admit rate published   [ include ]
```

Without this, a student filters "graduation rate above 85%" and never learns that the
school that would have been perfect for them simply had an unparsed row. This is
`AGENTS.md` principle 3 — never lie to a student — applied to search, and it is a genuine
differentiator: no competitor discloses it.

---

## 7. Cross-cutting rules

1. **Filter state lives in the URL.** `?tab=explore&state=MA&admit=4-60&size=2000-10000`.
   Shareable, back-button-safe, and each tab keeps its own state independently.
2. **Facet counts on enums only.** `Public (168) / Private (244)` is cheap and useful.
   Counts on ranges are expensive; skip them.
3. **Caveats are structurally inseparable from the number.** Per
   `METRICS-KEEP.md` §"Three schema decisions" #2, it must be impossible to fetch
   `sat_composite_*` without `sat_submitters_percent`, `class_rank_top_*` without
   `class_rank_submitted_percent`, or `average_high_school_gpa` without
   `high_school_gpa_submitted_percent`. In the UI the caveat's **visual weight scales with
   its severity** — quiet above 80% submitted, amber below 50%. A caveat in a tooltip is a
   caveat that gets dropped.
4. **The personalization strip (home state + test score) is load-bearing** for Tier-1 #2,
   #5, and #6. Without it those three degrade rather than break, but #5 must pick a
   residency assumption and disclose it.

---

## 8. Open decisions

| # | Decision | Recommendation |
|---|---|---|
| 1 | Facet counts on enums? | Yes for enums, no for ranges |
| 2 | Does the personalization strip ship in v1? | Yes — it is what separates this from a directory |
| 3 | Per-school profile completeness — filter, per-row indicator, or neither? | Filter only. A per-row badge risks reading as a rating *of the school* rather than of our data. |
| 4 | Which of the 58 string percents get parsed companions? | The 3 groups in §4 only |

---

## References

- `specs/cds-pipeline/METRICS-KEEP.md` — the 394-metric keep list, traps, and schema decisions
- `config/cds/domains/*.yaml` — `definition_variant` is the G1 gate
- `docs/DATABASE_GUIDE.md` — packet, availability, evidence, and caveat rules
- `AGENTS.md` — principle 3, the honesty carve-out
