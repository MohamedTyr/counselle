"""Golden self-tests for the tuning scorer.

NOT part of the repo's routine suite: `pyproject.toml` sets
`testpaths = ["tests"]`, so `uv run pytest` from the repo root never collects
this file. Run it explicitly:

    uv run pytest plans/cds-pipeline/tuning/harness/test_scorer.py -q

The golden table below is the trust gate. A scorer that flatters the engine is
the worst possible failure mode, so this file carries as many NEGATIVE controls
(pairs that must NOT match) as positive ones: a degenerate always-true
comparator must fail loudly here.

Every golden row drives the PRODUCTION comparator (`compare_metric`), in both
directions. There is deliberately no test-local `matches()` helper: a helper
that re-implements the equality test proves only that the helper works, and it
let a substring-containment or casefold mutant of `compare_metric` survive the
whole suite.
"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))

import scorer as scorer_module  # noqa: E402
from scorer import (  # noqa: E402
    FITNESS_FIELDS,
    GT_SCHEMA_VERSION,
    NO_DATA_SENTINEL,
    OUTCOMES,
    SCORER_VERSION,
    UNSCORED_OUTCOMES,
    Comparison,
    EngineFinding,
    GroundTruthEntry,
    Normalized,
    compare_fitness,
    compare_metric,
    engine_findings,
    fitness,
    gt_authoring_errors,
    load_ground_truth,
    manifest_universe,
    metric_key,
    normalize,
    normalize_text,
    rule_for_metric,
    score_run,
    summarize,
)

# --------------------------------------------------------------------------
# fixtures: synthetic manifest metrics, one per normalization rule
# --------------------------------------------------------------------------

COUNT = {"id": "d.count", "type": "integer", "unit": "students"}
PCT_NUM = {"id": "d.pctn", "type": "number", "unit": "percent"}
PCT_STR = {"id": "d.pcts", "type": "string", "unit": "percent"}  # the 58 qualifier-preserving ones
MONEY = {"id": "d.money", "type": "number", "unit": "usd"}
RATIO = {"id": "d.ratio", "type": "number", "unit": "ratio"}
GPA = {"id": "d.gpa", "type": "number", "unit": "gpa"}
SCORE = {"id": "d.score", "type": "integer", "unit": "score"}
BOOL = {"id": "d.bool", "type": "boolean", "unit": "boolean"}
ENUM = {"id": "d.enum", "type": "enum", "unit": "category"}
TEXT = {"id": "d.text", "type": "string", "unit": "text"}


def n(value: Any, metric: Mapping[str, Any]) -> Normalized:
    return normalize_text(value, rule_for_metric(metric))


def scored(engine_value: Any, gt_value: Any, metric: Mapping[str, Any]) -> str:
    """Run one (engine value, GT value) pair through the REAL comparator.

    This is the production path -- `compare_metric` -> the equality line -- not
    a re-implementation. Only `"correct"` counts as a match; every other
    outcome (`wrong`, `missed`, `gt_error`, ...) is a non-match.
    """
    finding = EngineFinding(
        key=("d", "m"),
        value=engine_value,
        availability_status="reported",
        page_number=None,
        raw={},
    )
    gt = GroundTruthEntry(
        key=("d", "m"), status="present", value=gt_value, page=None, evidence=None
    )
    return compare_metric(("d", "m"), metric, [finding], gt).outcome


# --------------------------------------------------------------------------
# THE GOLDEN TABLE
# --------------------------------------------------------------------------

MUST_MATCH = [
    ("count separators", "1,234", "1234", COUNT),
    ("count trailing .0", "1234.0", "1234", COUNT),
    ("count whitespace", " 1 234 ", "1234", COUNT),
    ("percent trailing zero", "56.30", "56.3", PCT_NUM),
    ("percent sign stripped", "56.3%", "56.3", PCT_NUM),
    ("percent integer", "56", "56.0", PCT_NUM),
    ("percent qualifier <1%", "<1%", "<1%", PCT_STR),
    ("percent qualifier spaced", "< 1 %", "<1", PCT_STR),
    ("percent qualifier unicode", "≤1%", "<=1%", PCT_STR),
    ("money dollars+commas", "$59,320", "59320", MONEY),
    ("money trailing cents", "$59,320.00", "59320", MONEY),
    ("ratio spaced colon", "12 : 1", "12:1", RATIO),
    ("ratio 'to' form", "12 to 1", "12:1", RATIO),
    ("ratio bare number (logged transform)", "12", "12:1", RATIO),
    ("gpa trailing zero", "3.90", "3.9", GPA),
    ("score int", "1500", "1,500", SCORE),
    ("bool yes", "Yes", True, BOOL),
    ("bool X", "X", True, BOOL),
    ("bool checkmark", "✓", True, BOOL),
    ("bool heavy checkmark", "✔", "true", BOOL),
    ("bool acroform /Yes", "/Yes", True, BOOL),
    ("bool acroform /Off", "/Off", False, BOOL),
    ("enum case", "Very Important", "very important", ENUM),
    ("enum whitespace", "  Very   Important ", "Very Important", ENUM),
    ("text unicode dash", "2025–2026", "2025-2026", TEXT),
    ("range band", "1500 - 1560", "1500-1560", SCORE),
    ("range band en-dash", "1500–1560", "1500-1560", SCORE),
]

MUST_NOT_MATCH = [
    ("56 vs 56.3 -- precision is meaning", "56", "56.3", PCT_NUM),
    ("56.3 vs 56.30001", "56.3", "56.30001", PCT_NUM),
    ("<1% vs 0.5 -- qualifier is not a number", "<1%", "0.5", PCT_STR),
    ("<1% vs 1", "<1%", "1", PCT_STR),
    ("<1% vs >1%", "<1%", ">1%", PCT_STR),
    ("0.56 is NOT rescaled to 56", "0.56", "56", PCT_NUM),
    ("count off by one", "1234", "1235", COUNT),
    ("decimal point is meaning: 1.234 vs 1234", "1.234", "1234", COUNT),
    ("56.3 vs 563 -- the point is not decoration", "56.3", "563", PCT_NUM),
    ("substring: 123 vs 1234", "123", "1234", COUNT),
    ("substring: 3.9 vs 3.99", "3.9", "3.99", GPA),
    ("count vs blank string", "0", "", COUNT),
    ("money differs", "$59,320", "$59,321", MONEY),
    ("ratio inverted", "12:1", "1:12", RATIO),
    ("bool true vs false", "Yes", False, BOOL),
    ("bool 1 is not accepted as true", "1", True, BOOL),
    ("bool 0 is not accepted as false", "0", False, BOOL),
    ("enum differs", "Very Important", "Important", ENUM),
    ("text differs", "2025-2026", "2024-2025", TEXT),
    ("range bounds differ", "1500-1560", "1500-1570", SCORE),
    ("absent never matches absent as a VALUE", "N/A", "-", COUNT),
    ("absent never matches a real value", "N/A", "1234", COUNT),
]

ABSENT_TOKENS = ["", "-", "–", "—", "N/A", "n/a", "  ", "None", "null", "not reported"]


@pytest.mark.parametrize(("label", "a", "b", "metric"), MUST_MATCH, ids=[r[0] for r in MUST_MATCH])
def test_golden_must_match(label: str, a: Any, b: Any, metric: Mapping[str, Any]) -> None:
    """Both directions through `compare_metric`: engine=a/GT=b and the swap."""
    assert scored(a, b, metric) == "correct", f"{label}: engine {a!r} should match GT {b!r}"
    assert scored(b, a, metric) == "correct", f"{label}: engine {b!r} should match GT {a!r}"


@pytest.mark.parametrize(
    ("label", "a", "b", "metric"), MUST_NOT_MATCH, ids=[r[0] for r in MUST_NOT_MATCH]
)
def test_golden_must_not_match(label: str, a: Any, b: Any, metric: Mapping[str, Any]) -> None:
    """A non-match must never be `correct` -- in either direction.

    This is the row set that kills a substring-containment or a
    casefold-and-strip-dots equality mutant: `56.3` vs `56`, `1234` vs `123`.
    """
    assert scored(a, b, metric) != "correct", f"{label}: engine {a!r} must NOT match GT {b!r}"
    assert scored(b, a, metric) != "correct", f"{label}: engine {b!r} must NOT match GT {a!r}"


def test_golden_table_covers_the_substring_and_casefold_mutants() -> None:
    """Explicit anchors for the two comparator mutants that once survived.

    Kept as named assertions (not just table rows) so a future edit to the
    table cannot quietly remove the coverage that proves the equality line is
    strict.
    """
    assert scored("56", "56.3", PCT_NUM) == "wrong"  # substring containment
    assert scored("123", "1234", COUNT) == "wrong"  # substring containment
    assert scored("1234", "123", COUNT) == "wrong"  # substring, other direction
    assert scored("56.3", "563", PCT_NUM) == "wrong"  # casefold + strip "."
    assert scored("1.234", "1234", COUNT) == "wrong"  # casefold + strip "."


@pytest.mark.parametrize("token", ABSENT_TOKENS)
def test_absent_tokens_are_abstentions(token: str) -> None:
    for metric in (COUNT, PCT_STR, MONEY, BOOL, ENUM, TEXT, RATIO):
        assert n(token, metric).absent, f"{token!r} should be absent under {metric['unit']}"


def test_zero_is_not_absent() -> None:
    """A `0` scraped out of an empty cell is a HALLUCINATION, never an
    abstention. This assertion is what makes the zero-tolerance rule real."""
    assert not n("0", COUNT).absent
    assert not n(0, COUNT).absent
    assert not n("0", PCT_NUM).absent


def test_no_fuzzy_credit_transforms_are_logged() -> None:
    assert "ratio_implicit_denominator_1" in n("12", RATIO).transforms
    assert "acroform_export_value" in n("/Yes", BOOL).transforms
    assert "percent_fraction_suspected_not_rescaled" in n("0.56", PCT_NUM).transforms
    assert "range_bounds_normalized" in n("1500-1560", SCORE).transforms
    # Pure formatting stripping is NOT a transform -- it must stay unlogged so
    # the transforms list keeps signal.
    assert n("1,234", COUNT).transforms == ()
    assert n("$59,320", MONEY).transforms == ()
    assert n("56.30", PCT_NUM).transforms == ()


def test_unrecognized_values_are_unparseable_not_matches() -> None:
    assert n("maybe", BOOL).unparseable
    assert n("twelve", COUNT).unparseable
    assert n("about a third", PCT_NUM).unparseable
    # unparseable never self-matches, through the production comparator. The
    # bucket is `gt_error` (the GT side is unwinnable, so it is quarantined
    # rather than charged) -- the load-bearing assertion is "not correct".
    assert scored("maybe", "maybe", BOOL) == "gt_error"
    # engine-side unparseable against a GOOD GT is still charged as `wrong`
    assert scored("maybe", "true", BOOL) == "wrong"
    assert scored("twelve", "1234", COUNT) == "wrong"


def test_metric_key_accepts_both_runner_shapes() -> None:
    assert metric_key("admissions", "admissions.applicants_total") == (
        "admissions",
        "applicants_total",
    )
    assert metric_key("admissions", "applicants_total") == ("admissions", "applicants_total")
    assert metric_key(None, "admissions.applicants_total") == ("admissions", "applicants_total")
    with pytest.raises(ValueError):
        metric_key(None, "applicants_total")


def test_rule_mapping_covers_every_manifest_metric() -> None:
    """The manifest is the metric universe; every metric must land on a rule
    (never hardcode a count -- assert the mapping is total instead)."""
    universe = manifest_universe()
    assert universe, "compiled manifest produced no metrics"
    for key, metric in universe.items():
        assert rule_for_metric(metric) in {
            "count",
            "percent",
            "money",
            "ratio",
            "gpa",
            "boolean",
            "text",
            "number",
        }, key
    # The percent-semantic-but-string-typed metrics must use the percent rule.
    string_percent = [
        m for m in universe.values() if m["type"] == "string" and m["unit"] == "percent"
    ]
    assert string_percent, "expected percent-semantic string metrics in the manifest"
    assert all(rule_for_metric(m) == "percent" for m in string_percent)


# --------------------------------------------------------------------------
# outcome classification
# --------------------------------------------------------------------------


def _gt(status: str, value: Any = None, page: int | None = None) -> GroundTruthEntry:
    return GroundTruthEntry(key=("d", "m"), status=status, value=value, page=page, evidence=None)


def _find(value: Any, status: str = "reported", page: int | None = None) -> EngineFinding:
    return EngineFinding(
        key=("d", "m"), value=value, availability_status=status, page_number=page, raw={}
    )


def outcome(
    metric: Mapping[str, Any],
    findings: Sequence[EngineFinding],
    gt: GroundTruthEntry | None,
) -> Comparison:
    return compare_metric(("d", "m"), metric, findings, gt)


def test_outcome_correct() -> None:
    assert outcome(COUNT, [_find("1,234")], _gt("present", "1234")).outcome == "correct"


def test_outcome_wrong() -> None:
    assert outcome(COUNT, [_find("1235")], _gt("present", "1234")).outcome == "wrong"


def test_outcome_missed_not_correct() -> None:
    """GT present + engine silent is MISSED. If this ever reads `correct`,
    coverage numbers become a lie."""
    assert outcome(COUNT, [], _gt("present", "1234")).outcome == "missed"
    assert outcome(COUNT, [_find(None, "not_reported")], _gt("present", "1234")).outcome == "missed"
    assert outcome(COUNT, [_find("N/A")], _gt("present", "1234")).outcome == "missed"


def test_outcome_hallucinated_zero_from_blank_cell() -> None:
    assert outcome(COUNT, [_find("0")], _gt("blank")).outcome == "hallucinated"
    assert outcome(COUNT, [_find(0)], _gt("blank")).outcome == "hallucinated"
    assert outcome(COUNT, [_find("1234")], _gt("absent")).outcome == "hallucinated"
    assert outcome(BOOL, [_find("false")], _gt("blank")).outcome == "hallucinated"


def test_outcome_correct_abstention() -> None:
    for gt_status in ("blank", "absent"):
        assert outcome(COUNT, [], _gt(gt_status)).outcome == "correct_abstention"
        assert (
            outcome(COUNT, [_find(None, "not_in_template_version")], _gt(gt_status)).outcome
            == "correct_abstention"
        )
        assert outcome(COUNT, [_find("–")], _gt(gt_status)).outcome == "correct_abstention"


def test_outcome_uncovered_is_neither_pass_nor_fail() -> None:
    result = outcome(COUNT, [_find("1234")], None)
    assert result.outcome == "uncovered"
    tally_source = [result]
    assert sum(1 for c in tally_source if c.outcome in ("correct", "correct_abstention")) == 0
    assert sum(1 for c in tally_source if c.outcome in ("wrong", "missed", "hallucinated")) == 0


def test_conflicting_duplicate_findings_count_wrong() -> None:
    result = outcome(COUNT, [_find("1234"), _find("9999")], _gt("present", "1234"))
    assert result.outcome == "wrong"
    assert "duplicate_findings_conflict" in result.transforms


def test_agreeing_duplicate_findings_are_fine() -> None:
    result = outcome(COUNT, [_find("1,234"), _find("1234")], _gt("present", "1234"))
    assert result.outcome == "correct"


def test_citation_mismatch_reported_but_not_gating() -> None:
    result = outcome(COUNT, [_find("1234", page=9)], _gt("present", "1234", page=7))
    assert result.outcome == "correct"
    assert result.citation_mismatch is True


def test_unnormalizable_ground_truth_is_quarantined_as_gt_error() -> None:
    # A `present` GT value that does not normalize under its metric's rule is
    # a GT authoring bug, not an engine fault: no engine output could ever
    # satisfy it. It must be quarantined into `gt_error` -- out of every
    # accuracy/coverage denominator (see UNSCORED_OUTCOMES) -- and must never
    # be silently credited as `correct`.
    result = outcome(COUNT, [_find("1234")], _gt("present", "about 1234"))
    assert result.outcome == "gt_error"
    assert result.outcome != "correct"


# --------------------------------------------------------------------------
# end-to-end over the real manifest
# --------------------------------------------------------------------------


def test_score_run_end_to_end(tmp_path: Path) -> None:
    universe = manifest_universe()
    (domain, bare), metric = next(iter(universe.items()))
    run = {
        "config": {"label": "selftest"},
        "document": {"name": "selftest.pdf", "page_count": 1, "sha256": "x"},
        "findings": [
            {
                "domain": domain,
                "metric_id": f"{domain}.{bare}",
                "availability_status": "reported",
                "value": True if metric["type"] == "boolean" else "1",
                "raw_value": "Yes",
                "page_number": 3,
            }
        ],
        "calls": [{}],
        "cost_usd_estimate": 0.01,
        "duration_seconds": 1.0,
        "errors": [],
    }
    gt_path = tmp_path / "selftest.json"
    gt_path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "metrics": {
                    f"{domain}.{bare}": {
                        "status": "present",
                        "value": "Yes" if metric["type"] == "boolean" else "1",
                        "page": 3,
                        "evidence": "row",
                    }
                },
            }
        ),
        encoding="utf-8",
    )
    report = score_run(run, load_ground_truth(gt_path), universe=universe)
    assert report["scorer_version"] == SCORER_VERSION
    assert report["metric_universe_size"] == len(universe)
    assert report["totals"]["total"] == len(universe)
    assert report["totals"]["correct"] == 1
    assert report["totals"]["uncovered"] == len(universe) - 1
    assert report["totals"]["coverage_pct"] == 100.0
    assert report["totals"]["accuracy_pct"] == 100.0
    # every metric lands in exactly one outcome bucket
    buckets = sum(
        report["totals"][name]
        for name in OUTCOMES
    )
    assert buckets == len(universe)
    assert engine_findings(run)[(domain, bare)]


def test_nested_ground_truth_layout(tmp_path: Path) -> None:
    path = tmp_path / "nested.json"
    path.write_text(
        json.dumps(
            {"metrics": {"admissions": {"applicants_total": {"status": "present", "value": 10}}}}
        ),
        encoding="utf-8",
    )
    entries = load_ground_truth(path)
    assert entries[("admissions", "applicants_total")].status == "present"


def test_ground_truth_rejects_bad_status(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text(json.dumps({"metrics": {"a.b": {"status": "maybe"}}}), encoding="utf-8")
    with pytest.raises(ValueError):
        load_ground_truth(path)


def test_enum_values_outside_the_manifest_set_are_flagged() -> None:
    """Enum GT must carry the manifest's snake_case token, not the PDF's
    printed label. A mismatch is still `wrong`, but it is tagged so a GT
    authoring error does not read as an engine regression."""
    metric = {
        "id": "d.enum",
        "type": "enum",
        "unit": "category",
        "enums": ["very_important", "important", "considered"],
    }
    assert normalize("very_important", metric).transforms == ()
    flagged = normalize("Very Important", metric)
    assert "enum_value_not_in_manifest" in flagged.transforms
    assert flagged.canonical == "very important"  # never coerced to the token


# --------------------------------------------------------------------------
# HIGH-2: the checkbox ruling -- unticked box vs row-not-on-the-form
# --------------------------------------------------------------------------


def test_unticked_checkbox_present_on_the_form_is_present_false() -> None:
    """An unticked box that IS on the form is the institution's answer: `no`.

    GT `{"status": "present", "value": false}`. The engine agreeing with it
    (`false`) is CORRECT; the engine staying silent is a MISS; the engine
    claiming `true` is WRONG. Scoring it `blank` instead would invert two of
    those three outcomes.
    """
    gt = _gt("present", False)
    assert outcome(BOOL, [_find(False)], gt).outcome == "correct"
    assert outcome(BOOL, [_find("/Off")], gt).outcome == "correct"
    assert outcome(BOOL, [_find("No")], gt).outcome == "correct"
    assert outcome(BOOL, [], gt).outcome == "missed"
    assert outcome(BOOL, [_find(None, "not_reported")], gt).outcome == "missed"
    assert outcome(BOOL, [_find(True)], gt).outcome == "wrong"


def test_question_absent_from_this_template_edition_is_absent_not_false() -> None:
    """METRICS-KEEP.md trap #1: an unchecked box is not a `no` -- the school
    may have used an older template edition. `absent` expects silence, and an
    engine that answers anything is hallucinating."""
    gt = _gt("absent")
    assert outcome(BOOL, [], gt).outcome == "correct_abstention"
    assert outcome(BOOL, [_find(None, "not_in_template_version")], gt).outcome == (
        "correct_abstention"
    )
    assert outcome(BOOL, [_find(False)], gt).outcome == "hallucinated"
    assert outcome(BOOL, [_find(True)], gt).outcome == "hallucinated"


def test_absent_and_present_false_produce_opposite_outcomes() -> None:
    """The reason the ruling had to be written down: for the SAME engine
    behaviour the two readings disagree in both directions."""
    silent: list[EngineFinding] = []
    answered = [_find(False)]
    assert outcome(BOOL, silent, _gt("present", False)).outcome == "missed"
    assert outcome(BOOL, silent, _gt("absent")).outcome == "correct_abstention"
    assert outcome(BOOL, answered, _gt("present", False)).outcome == "correct"
    assert outcome(BOOL, answered, _gt("absent")).outcome == "hallucinated"


def test_blank_is_for_fill_in_value_cells_only() -> None:
    """`blank` = an empty fill-in cell (text/number/money). It expects silence,
    exactly like `absent`, which is why using it for an unticked checkbox would
    silently convert a real answer into an expected abstention."""
    assert outcome(COUNT, [], _gt("blank")).outcome == "correct_abstention"
    assert outcome(COUNT, [_find("0")], _gt("blank")).outcome == "hallucinated"


# --------------------------------------------------------------------------
# HIGH-3: unknown availability_status must never buy forgiveness
# --------------------------------------------------------------------------

UNKNOWN_STATUSES = ["Reported", "REPORTED", "reported ", " reported", None, "brand_new_status_v2"]


@pytest.mark.parametrize("status", UNKNOWN_STATUSES)
def test_unknown_status_does_not_forgive_a_hallucination(status: Any) -> None:
    result = outcome(COUNT, [_find("1234", status)], _gt("blank"))
    assert result.outcome == "hallucinated", f"{status!r} bought a free abstention"
    assert result.unknown_availability_status is True
    assert "unknown_availability_status" in result.transforms


@pytest.mark.parametrize("status", UNKNOWN_STATUSES)
def test_unknown_status_is_not_silently_normalized(status: Any) -> None:
    """`"Reported"` is reported as UNKNOWN, not coerced to `"reported"`.
    Silent coercion is how this bug class comes back."""
    result = outcome(COUNT, [_find("1234", status)], _gt("present", "1234"))
    assert result.unknown_availability_status is True
    assert result.availability_status == status


@pytest.mark.parametrize(
    "status", ["not_reported", "not_applicable", "suppressed", "not_in_template_version"]
)
def test_recognized_abstentions_still_abstain(status: str) -> None:
    result = outcome(COUNT, [_find(None, status)], _gt("blank"))
    assert result.outcome == "correct_abstention"
    assert result.unknown_availability_status is False


def test_unknown_status_is_counted_and_blocks_the_run(tmp_path: Path) -> None:
    universe = manifest_universe()
    (domain, bare), _metric = next(iter(universe.items()))
    run = {
        "document": {"name": "x.pdf"},
        "findings": [
            {
                "domain": domain,
                "metric_id": f"{domain}.{bare}",
                "availability_status": "Reported",
                "value": "1",
                "page_number": 1,
            }
        ],
    }
    gt_path = tmp_path / "x.json"
    gt_path.write_text(
        json.dumps({"metrics": {f"{domain}.{bare}": {"status": "blank"}}}), encoding="utf-8"
    )
    report = score_run(run, load_ground_truth(gt_path), universe=universe)
    assert report["totals"]["unknown_availability_status"] == 1
    assert report["totals"]["hallucinated"] == 1
    assert report["totals"]["correct_abstention"] == 0
    assert report["unknown_availability_statuses"]
    assert report["blocking_issues"]
    assert "unrecognized availability_status" in summarize(report)


def test_known_status_vocabulary_matches_the_engine_contract() -> None:
    """Pinned to `domain/cds/claims.py`. If the engine grows a sixth status,
    this test fails until the scorer is told about it -- which is the point."""
    from typing import get_args  # noqa: PLC0415

    from domain.cds.claims import AvailabilityStatus  # noqa: PLC0415

    expected = frozenset(get_args(AvailabilityStatus))
    assert expected == scorer_module.KNOWN_AVAILABILITY_STATUSES


# --------------------------------------------------------------------------
# MEDIUM-1: a typo'd GT key must not silently shrink the denominator
# --------------------------------------------------------------------------


def test_typoed_gt_key_is_loud_and_blocking(tmp_path: Path) -> None:
    path = tmp_path / "typo.json"
    path.write_text(
        json.dumps(
            {"metrics": {"admissions.applicants_totl": {"status": "present", "value": "1"}}}
        ),
        encoding="utf-8",
    )
    report = score_run({"findings": []}, load_ground_truth(path))
    assert report["ground_truth_outside_manifest"] == ["admissions.applicants_totl"]
    assert report["blocking_issues"]
    assert "GT keys outside manifest" in summarize(report)


def test_cli_exits_nonzero_on_a_typoed_gt_key(tmp_path: Path) -> None:
    run_path = tmp_path / "run.json"
    run_path.write_text(
        json.dumps({"document": {"name": "run.pdf"}, "findings": []}), encoding="utf-8"
    )
    gt_path = tmp_path / "run.json.gt"
    gt_path.write_text(
        json.dumps(
            {"metrics": {"admissions.applicants_totl": {"status": "present", "value": "1"}}}
        ),
        encoding="utf-8",
    )
    assert scorer_module.main([str(run_path), "--gt", str(gt_path)]) != 0


# --------------------------------------------------------------------------
# MEDIUM-2: `unreadable` -- "I checked and could not read it"
# --------------------------------------------------------------------------


def test_unreadable_is_its_own_bucket_and_never_charged() -> None:
    for findings in ([], [_find("1234")], [_find(None, "not_reported")]):
        result = outcome(COUNT, findings, _gt("unreadable"))
        assert result.outcome == "unreadable"
        assert result.outcome not in ("missed", "uncovered", "correct_abstention", "hallucinated")


def test_unreadable_stays_out_of_every_denominator(tmp_path: Path) -> None:
    universe = manifest_universe()
    keys = list(universe)[:2]
    gt_path = tmp_path / "u.json"
    gt_path.write_text(
        json.dumps(
            {
                "metrics": {
                    f"{keys[0][0]}.{keys[0][1]}": {"status": "unreadable"},
                    f"{keys[1][0]}.{keys[1][1]}": {"status": "blank"},
                }
            }
        ),
        encoding="utf-8",
    )
    report = score_run({"findings": []}, load_ground_truth(gt_path), universe=universe)
    totals = report["totals"]
    assert totals["unreadable"] == 1
    assert totals["missed"] == 0
    assert totals["present_in_document"] == 0
    assert totals["covered"] == 1  # only the `blank` metric is scoreable
    assert sum(totals[name] for name in OUTCOMES) == len(universe)


def test_unreadable_is_an_accepted_gt_status(tmp_path: Path) -> None:
    path = tmp_path / "ur.json"
    path.write_text(json.dumps({"metrics": {"a.b": {"status": "unreadable"}}}), encoding="utf-8")
    assert load_ground_truth(path)[("a", "b")].status == "unreadable"


# --------------------------------------------------------------------------
# MEDIUM-3: a `present` GT value that is an absent-token is a GT bug
# --------------------------------------------------------------------------


@pytest.mark.parametrize("token", ["None", "n/a", "-", "", "not reported", None])
def test_present_gt_with_an_absent_token_is_a_gt_error_not_engine_fault(token: Any) -> None:
    gt = _gt("present", token)
    for findings in ([], [_find("1234")], [_find("None")]):
        result = outcome(TEXT, findings, gt)
        assert result.outcome == "gt_error", f"{token!r} charged to the engine as {result.outcome}"


def test_gt_authoring_errors_are_detected_at_load_time(tmp_path: Path) -> None:
    path = tmp_path / "bad.json"
    path.write_text(
        json.dumps(
            {
                "metrics": {
                    "a.good": {"status": "present", "value": "12"},
                    "a.bad": {"status": "present", "value": "None"},
                    "a.novalue": {"status": "present"},
                    "a.falsebox": {"status": "present", "value": False},
                    "a.blank": {"status": "blank"},
                }
            }
        ),
        encoding="utf-8",
    )
    errors = gt_authoring_errors(load_ground_truth(path))
    assert [e["metric"] for e in errors] == ["a.bad", "a.novalue"]


def test_gt_authoring_error_blocks_the_run(tmp_path: Path) -> None:
    universe = manifest_universe()
    (domain, bare), _ = next(iter(universe.items()))
    gt_path = tmp_path / "g.json"
    gt_path.write_text(
        json.dumps({"metrics": {f"{domain}.{bare}": {"status": "present", "value": "None"}}}),
        encoding="utf-8",
    )
    report = score_run({"findings": []}, load_ground_truth(gt_path), universe=universe)
    assert report["totals"]["gt_error"] == 1
    assert report["totals"]["missed"] == 0
    assert report["ground_truth_authoring_errors"]
    assert report["blocking_issues"]


# --------------------------------------------------------------------------
# MEDIUM-4: bucket totality under adversarial input
# --------------------------------------------------------------------------


def _adversarial_run(keys: Sequence[tuple[str, str]]) -> dict[str, Any]:
    """Malformed findings, nulls, wrong types, unknown statuses, duplicates."""
    findings: list[dict[str, Any]] = [
        {"domain": keys[0][0], "metric_id": keys[0][1], "availability_status": "reported"},
        {"domain": keys[0][0], "metric_id": keys[0][1], "availability_status": "reported",
         "value": {"nested": "object"}},
        {"metric_id": f"{keys[1][0]}.{keys[1][1]}", "availability_status": None, "value": []},
        {"metric_id": f"{keys[2][0]}.{keys[2][1]}", "availability_status": "brand_new_v2",
         "value": 3.4028e38, "page_number": "not-a-page"},
        {"metric_id": f"{keys[3][0]}.{keys[3][1]}", "availability_status": "reported",
         "value": float("nan"), "page_number": -7},
        {"metric_id": f"{keys[4][0]}.{keys[4][1]}", "availability_status": "reported",
         "value": True},
        {"metric_id": f"{keys[4][0]}.{keys[4][1]}", "availability_status": "reported",
         "value": "wildly different"},
        {"metric_id": "no_such_domain.no_such_metric", "availability_status": "reported",
         "value": "1"},
    ]
    return {"document": {"name": "adversarial.pdf"}, "findings": findings, "errors": ["boom"]}


def test_bucket_totality_under_adversarial_input(tmp_path: Path) -> None:
    """Every manifest metric lands in EXACTLY ONE bucket and the buckets sum to
    the universe -- no matter what garbage the run and the GT contain."""
    universe = manifest_universe()
    keys = list(universe)[:8]
    run = _adversarial_run(keys)
    gt_path = tmp_path / "adv.json"
    gt_path.write_text(
        json.dumps(
            {
                "metrics": {
                    f"{keys[0][0]}.{keys[0][1]}": {"status": "present", "value": "1", "page": "x"},
                    f"{keys[1][0]}.{keys[1][1]}": {"status": "blank"},
                    f"{keys[2][0]}.{keys[2][1]}": {"status": "absent"},
                    f"{keys[3][0]}.{keys[3][1]}": {"status": "unreadable"},
                    f"{keys[4][0]}.{keys[4][1]}": {"status": "present", "value": "None"},
                    f"{keys[5][0]}.{keys[5][1]}": {"status": "present", "value": None},
                    f"{keys[6][0]}.{keys[6][1]}": {"status": "PRESENT", "value": "  12  "},
                    "totally.bogus": {"status": "present", "value": "9"},
                }
            }
        ),
        encoding="utf-8",
    )
    report = score_run(run, load_ground_truth(gt_path), universe=universe)

    seen = [f"{c['domain']}.{c['metric_id']}" for c in report["comparisons"]]
    assert len(seen) == len(universe), "a metric was dropped from the comparison loop"
    assert len(set(seen)) == len(universe), "a metric was compared twice"
    for comparison in report["comparisons"]:
        assert comparison["outcome"] in OUTCOMES

    totals = report["totals"]
    assert sum(totals[name] for name in OUTCOMES) == len(universe)
    assert totals["total"] == len(universe)
    assert totals["covered"] == sum(
        totals[name] for name in OUTCOMES if name not in UNSCORED_OUTCOMES
    )
    assert sum(
        tally[name] for tally in report["per_domain"].values() for name in OUTCOMES
    ) == len(universe)
    assert report["findings_outside_manifest"] == ["no_such_domain.no_such_metric"]
    assert report["ground_truth_outside_manifest"] == ["totally.bogus"]


def test_comparison_loop_must_not_swallow_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    """A `try/except: continue` around the comparison loop silently shrinks the
    universe. Nothing else in the suite notices, so this test is the guard."""
    universe = dict(list(manifest_universe().items())[:5])
    boom_key = next(iter(universe))
    real = scorer_module.compare_metric

    def exploding(key, metric, findings, gt):  # type: ignore[no-untyped-def]
        if key == boom_key:
            raise RuntimeError("compare_metric blew up")
        return real(key, metric, findings, gt)

    monkeypatch.setattr(scorer_module, "compare_metric", exploding)
    with pytest.raises(RuntimeError):
        score_run({"findings": []}, {}, universe=universe)


# --------------------------------------------------------------------------
# MEDIUM-5: run errors must be impossible to miss
# --------------------------------------------------------------------------


def test_run_errors_are_printed_in_the_summary(tmp_path: Path) -> None:
    universe = manifest_universe()
    (domain, bare), metric = next(iter(universe.items()))
    run = {
        "document": {"name": "partial.pdf"},
        "findings": [
            {
                "domain": domain,
                "metric_id": f"{domain}.{bare}",
                "availability_status": "reported",
                "value": True if metric["type"] == "boolean" else "1",
                "page_number": 1,
            }
        ],
        "errors": ["batch 3 failed: 503 from the model", "batch 7 timed out"],
    }
    gt_path = tmp_path / "partial.json"
    gt_path.write_text(
        json.dumps(
            {
                "metrics": {
                    f"{domain}.{bare}": {
                        "status": "present",
                        "value": "Yes" if metric["type"] == "boolean" else "1",
                    }
                }
            }
        ),
        encoding="utf-8",
    )
    report = score_run(run, load_ground_truth(gt_path), universe=universe)
    text = summarize(report)
    assert report["totals"]["accuracy_pct"] == 100.0  # the trap: looks perfect
    assert "RUN ERRORS" in text
    assert "batch 3 failed: 503 from the model" in text
    assert "batch 7 timed out" in text


# --------------------------------------------------------------------------
# MEDIUM-6: fitness is lexicographic and abstention loses
# --------------------------------------------------------------------------


def _report(
    accuracy: float | None,
    coverage: float | None,
    cost: float | None = 1.0,
    latency: float | None = 10.0,
) -> dict[str, Any]:
    return {
        "totals": {"accuracy_pct": accuracy, "coverage_pct": coverage},
        "cost": {"cost_usd_estimate": cost, "duration_seconds": latency},
    }


def test_fitness_field_order_is_pinned() -> None:
    assert FITNESS_FIELDS == ("accuracy_pct", "coverage_pct", "-cost_per_doc", "-latency_per_doc")


def test_fitness_is_lexicographic_in_the_pinned_order() -> None:
    assert compare_fitness(_report(90.0, 10.0), _report(80.0, 99.0)) == 1  # accuracy first
    assert compare_fitness(_report(90.0, 50.0), _report(90.0, 40.0)) == 1  # then coverage
    assert compare_fitness(_report(90.0, 50.0, cost=0.5), _report(90.0, 50.0, cost=2.0)) == 1
    assert (
        compare_fitness(
            _report(90.0, 50.0, cost=1.0, latency=5.0),
            _report(90.0, 50.0, cost=1.0, latency=50.0),
        )
        == 1
    )
    assert compare_fitness(_report(90.0, 50.0), _report(90.0, 50.0)) == 0


def test_zero_extraction_ranks_last_never_first() -> None:
    """`None` accuracy must sort BELOW every real accuracy, including 0.0."""
    nothing = _report(None, None, cost=0.0, latency=0.0)
    assert fitness(nothing)[0] == NO_DATA_SENTINEL
    assert NO_DATA_SENTINEL < 0.0
    assert compare_fitness(nothing, _report(0.0, 0.0, cost=99.0, latency=999.0)) == -1
    ranked = sorted([_report(50.0, 50.0), nothing, _report(10.0, 5.0)], key=fitness, reverse=True)
    assert ranked[-1] is nothing


def test_abstain_on_everything_loses_to_a_config_that_extracts(tmp_path: Path) -> None:
    """The gaming scenario, end to end over the real manifest."""
    universe = manifest_universe()
    keys = [k for k, m in universe.items() if m.get("type") != "boolean"][:4]
    gt_path = tmp_path / "fit.json"
    gt_path.write_text(
        json.dumps(
            {"metrics": {f"{d}.{b}": {"status": "present", "value": "12"} for d, b in keys}}
        ),
        encoding="utf-8",
    )
    ground_truth = load_ground_truth(gt_path)

    def run_with(count: int) -> dict[str, Any]:
        return {
            "document": {"name": "fit.pdf"},
            "cost_usd_estimate": 0.01,
            "duration_seconds": 1.0,
            "findings": [
                {
                    "domain": d,
                    "metric_id": f"{d}.{b}",
                    "availability_status": "reported",
                    "value": "12",
                    "page_number": 1,
                }
                for d, b in keys[:count]
            ],
        }

    abstain_all = score_run(run_with(0), ground_truth, universe=universe)
    one_only = score_run(run_with(1), ground_truth, universe=universe)
    extracts_all = score_run(run_with(4), ground_truth, universe=universe)

    assert abstain_all["totals"]["accuracy_pct"] is None
    assert one_only["totals"]["accuracy_pct"] == 100.0  # gamed accuracy...
    assert one_only["totals"]["coverage_pct"] == 25.0  # ...at 25% coverage
    assert compare_fitness(abstain_all, extracts_all) == -1
    assert compare_fitness(abstain_all, one_only) == -1
    assert compare_fitness(one_only, extracts_all) == -1  # coverage breaks the accuracy tie
    assert extracts_all["fitness"][0] == 100.0
    assert extracts_all["fitness"][1] == 100.0


# --------------------------------------------------------------------------
# LOW fixes
# --------------------------------------------------------------------------


def test_gt_schema_version_pin_is_enforced(tmp_path: Path) -> None:
    good = tmp_path / "good.json"
    good.write_text(
        json.dumps({"schema_version": GT_SCHEMA_VERSION, "metrics": {}}), encoding="utf-8"
    )
    assert load_ground_truth(good) == {}
    bad = tmp_path / "bad.json"
    bad.write_text(json.dumps({"schema_version": 99, "metrics": {}}), encoding="utf-8")
    with pytest.raises(ValueError, match="schema_version"):
        load_ground_truth(bad)


def test_unicode_qualifier_rewrites_are_logged() -> None:
    assert "qualifier_unicode_le_normalized" in n("≤1%", PCT_STR).transforms
    assert "qualifier_unicode_ge_normalized" in n("≥90%", PCT_STR).transforms
    # `≈` -> `~` equates two different approximation markers: never silent.
    assert "qualifier_approx_unified" in n("≈1200", SCORE).transforms
    assert n("~1200", SCORE).transforms == ()
    assert n("<1%", PCT_STR).transforms == ()


def test_decimal_rate_ratios_do_not_log_an_implicit_denominator() -> None:
    """The two `outcomes.*_rate_ratio` metrics print decimals; `0.87` already
    means 0.87 per 1, so no denominator was assumed. Scoring is unchanged."""
    assert n("0.87", RATIO).canonical == "0.87:1"
    assert n("0.87", RATIO).transforms == ()
    assert "ratio_implicit_denominator_1" in n("12", RATIO).transforms
    assert scored("0.87", "0.87", RATIO) == "correct"
    assert scored("0.87", "0.88", RATIO) == "wrong"
    assert scored("0.87", "0.87:1", RATIO) == "correct"


def test_gt_schema_doc_matches_the_rule_table() -> None:
    """LOW-3/LOW-4: the doc's unit table must describe real behaviour."""
    doc = (Path(__file__).resolve().parent / "GT-SCHEMA.md").read_text(encoding="utf-8")
    universe = manifest_universe()
    units = {str(m.get("unit")) for m in universe.values()}
    for unit in units:
        assert f"`{unit}`" in doc, f"unit {unit!r} is missing from GT-SCHEMA.md"
    # `faculty` resolves to BOTH count and number depending on `type`.
    faculty = {rule_for_metric(m) for m in universe.values() if m.get("unit") == "faculty"}
    assert faculty == {"count", "number"}
    # LOW-4: "trailing zeros stripped" must not read as "write 15 for 1500".
    assert "*fractional* trailing zeros" in doc
    assert "**`1500` stays `1500`**" in doc


def test_no_manifest_metric_falls_through_to_the_silent_text_default() -> None:
    """`rule_for_metric` ends in `return "text"`. That fallback exists for
    units the manifest may grow later; TODAY nothing may reach it silently,
    because a numeric metric quietly compared as text would compare `1,234`
    against `1234` as strings."""
    fell_through = [
        metric["id"]
        for metric in manifest_universe().values()
        if metric.get("type") != "boolean"
        and str(metric.get("unit", "")) not in scorer_module._UNIT_RULES
        and metric.get("type") not in ("integer", "number")
    ]
    assert fell_through == [], f"metrics hitting the silent text default: {fell_through}"


# --------------------------------------------------------------------------
# Multi-document aggregation: the loop decides on the N-doc eval, never on one
# --------------------------------------------------------------------------


def _doc_report(
    name: str,
    *,
    correct: int = 0,
    wrong: int = 0,
    missed: int = 0,
    hallucinated: int = 0,
    cost: float | None = 1.0,
    seconds: float | None = 10.0,
    errors: Sequence[str] = (),
    config: Mapping[str, Any] | None = None,
    blocking: Sequence[str] = (),
) -> dict[str, Any]:
    """A minimal single-document report shaped exactly like `score_run`'s."""
    counts = {
        "correct": correct,
        "wrong": wrong,
        "missed": missed,
        "hallucinated": hallucinated,
        "correct_abstention": 0,
        "uncovered": 0,
        "unreadable": 0,
        "gt_error": 0,
    }
    totals = scorer_module.ratios_from_counts(counts)
    return {
        "scorer_version": SCORER_VERSION,
        "manifest_content_sha256": "sha",
        "document": {"name": name},
        "config": dict(config or {"label": "exp", "pdf_path": f"/corpus/{name}"}),
        "cost": {"cost_usd_estimate": cost, "duration_seconds": seconds, "calls": 1},
        "totals": totals,
        "per_domain": {"faculty": totals},
        "run_errors": list(errors),
        "findings_outside_manifest": [],
        "ground_truth_outside_manifest": [],
        "ground_truth_authoring_errors": [],
        "unknown_availability_statuses": [],
        "blocking_issues": list(blocking),
    }


def _five(**kwargs: Any) -> list[dict[str, Any]]:
    return [_doc_report(f"doc{i}.pdf", **kwargs) for i in range(5)]


def test_aggregate_sums_buckets_and_emits_one_fitness_tuple() -> None:
    reports = [
        _doc_report("a.pdf", correct=90, wrong=10),
        _doc_report("b.pdf", correct=5, wrong=5),
        _doc_report("c.pdf", correct=20, wrong=0, missed=10),
        _doc_report("d.pdf", correct=1, hallucinated=1),
        _doc_report("e.pdf", correct=40, wrong=10, missed=5),
    ]
    agg = scorer_module.aggregate_reports(reports)
    assert agg["documents"] == 5
    assert agg["totals"]["correct"] == 90 + 5 + 20 + 1 + 40
    assert agg["totals"]["wrong"] == 10 + 5 + 0 + 0 + 10
    assert agg["totals"]["missed"] == 15
    assert agg["totals"]["hallucinated"] == 1
    # rates recomputed ONCE from the summed buckets
    emitted = agg["totals"]["correct"] + agg["totals"]["wrong"] + agg["totals"]["hallucinated"]
    assert agg["totals"]["accuracy_pct"] == round(100.0 * agg["totals"]["correct"] / emitted, 2)
    assert len(agg["fitness"]) == 4
    assert agg["fitness_fields"] == list(FITNESS_FIELDS)
    assert len(agg["per_document"]) == 5  # per-document reports kept alongside
    assert agg["blocking_issues"] == []


def test_summed_buckets_beat_averaged_percentages() -> None:
    """The Simpson's-paradox trap, made concrete.

    Config B is dramatically better on the 300-metric document that carries
    almost all the mass, and marginally worse on four 4-metric documents.
    Summing the buckets says B wins by 37 points. Averaging the five
    per-document percentages says A wins -- because it weights a 4-metric
    document exactly as heavily as a 300-metric one. Whichever reduction the
    loop uses decides which config gets crowned, and only one of them is
    measuring what the loop claims to measure.
    """
    config_a = [
        _doc_report("big.pdf", correct=150, wrong=150),  # 50.0% of 300 metrics
        *[_doc_report(f"tiny{i}.pdf", correct=4, wrong=0) for i in range(4)],  # 100.0% of 4
    ]
    config_b = [
        _doc_report("big.pdf", correct=270, wrong=30),  # 90.0% -- far better
        *[_doc_report(f"tiny{i}.pdf", correct=3, wrong=1) for i in range(4)],  # 75.0% -- worse
    ]

    def naive_average(reports: Sequence[Mapping[str, Any]]) -> float:
        return round(sum(float(r["totals"]["accuracy_pct"]) for r in reports) / len(reports), 2)

    agg_a = scorer_module.aggregate_reports(config_a)
    agg_b = scorer_module.aggregate_reports(config_b)
    avg_a, avg_b = naive_average(config_a), naive_average(config_b)

    # summed buckets: 166/316 vs 282/316
    assert agg_a["totals"]["correct"] == 166
    assert agg_b["totals"]["correct"] == 282
    assert agg_a["totals"]["accuracy_pct"] == 52.53
    assert agg_b["totals"]["accuracy_pct"] == 89.24
    assert scorer_module.compare_fitness(agg_b, agg_a) == 1  # what the scorer does

    # average of per-document percentages: 90.0 vs 78.0 -- the opposite verdict
    assert avg_a == 90.0
    assert avg_b == 78.0
    assert (avg_a > avg_b) != (
        agg_a["totals"]["accuracy_pct"] > agg_b["totals"]["accuracy_pct"]
    ), "the skewed pair must actually invert, or this test proves nothing"

    # and the scorer must never expose the averaged number anywhere
    assert agg_a["fitness_inputs"]["accuracy_pct"] == agg_a["totals"]["accuracy_pct"]
    assert "summed buckets" in agg_a["fitness_inputs"]["basis"]


def test_aggregate_cost_reports_total_and_mean_and_fitness_uses_the_mean() -> None:
    agg = scorer_module.aggregate_reports(
        [_doc_report(f"d{i}.pdf", correct=1, cost=2.0, seconds=30.0) for i in range(5)]
    )
    assert agg["cost"]["total_cost_usd"] == 10.0
    assert agg["cost"]["mean_cost_per_doc"] == 2.0
    assert agg["cost"]["total_duration_seconds"] == 150.0
    assert agg["cost"]["mean_latency_per_doc"] == 30.0
    assert agg["fitness_inputs"]["cost_per_doc"] == 2.0  # the MEAN, not the total
    assert agg["fitness_inputs"]["latency_per_doc"] == 30.0
    assert agg["fitness"][2] == -2.0
    assert agg["fitness"][3] == -30.0
    assert "mean per document" in agg["fitness_inputs"]["basis"]


def test_aggregate_fitness_is_lexicographic() -> None:
    def agg(correct: int, missed: int, cost: float, seconds: float) -> dict[str, Any]:
        return scorer_module.aggregate_reports(
            [
                _doc_report(f"d{i}.pdf", correct=correct, missed=missed, cost=cost, seconds=seconds)
                for i in range(5)
            ]
        )

    better_accuracy = agg(10, 0, 9.0, 900.0)
    worse_accuracy = agg(9, 0, 0.01, 1.0)
    worse_accuracy["totals"]["accuracy_pct"] = 50.0
    worse_accuracy["fitness_inputs"]["accuracy_pct"] = 50.0
    assert scorer_module.compare_fitness(better_accuracy, worse_accuracy) == 1  # accuracy first
    assert scorer_module.compare_fitness(agg(10, 0, 1.0, 10.0), agg(10, 5, 1.0, 10.0)) == 1
    assert scorer_module.compare_fitness(agg(10, 0, 0.5, 10.0), agg(10, 0, 5.0, 10.0)) == 1
    assert scorer_module.compare_fitness(agg(10, 0, 1.0, 5.0), agg(10, 0, 1.0, 50.0)) == 1


def test_aggregate_zero_extraction_ranks_last() -> None:
    """The sentinel holds at the aggregate level too."""
    nothing = scorer_module.aggregate_reports(
        [_doc_report(f"d{i}.pdf", cost=0.0, seconds=0.0) for i in range(5)]
    )
    assert nothing["totals"]["accuracy_pct"] is None
    assert nothing["fitness"][0] == NO_DATA_SENTINEL
    real = scorer_module.aggregate_reports(
        [_doc_report(f"d{i}.pdf", correct=0, wrong=10, cost=99.0, seconds=999.0) for i in range(5)]
    )
    assert real["totals"]["accuracy_pct"] == 0.0
    assert scorer_module.compare_fitness(nothing, real) == -1
    ranked = sorted([real, nothing], key=scorer_module.fitness, reverse=True)
    assert ranked[-1] is nothing


@pytest.mark.parametrize("supplied", [1, 2, 3, 4, 6])
def test_partial_eval_refuses_to_certify(supplied: int) -> None:
    agg = scorer_module.aggregate_reports(
        [_doc_report(f"d{i}.pdf", correct=10) for i in range(supplied)]
    )
    assert agg["blocking_issues"], f"{supplied} documents certified as a full eval"
    assert "PARTIAL EVAL" in agg["blocking_issues"][0]
    assert "BLOCKING" in scorer_module.summarize_aggregate(agg)


def test_aggregate_refuses_a_run_carrying_errors() -> None:
    reports = _five(correct=10)
    reports[2]["run_errors"] = ["batch 4 timed out"]
    agg = scorer_module.aggregate_reports(reports)
    assert agg["totals"]["accuracy_pct"] == 100.0  # the trap: looks perfect
    assert any("run error" in issue for issue in agg["blocking_issues"])
    text = scorer_module.summarize_aggregate(agg)
    assert "THIS EVAL IS INCOMPLETE" in text
    assert "doc2.pdf: batch 4 timed out" in text


def test_aggregate_propagates_per_document_blocking_issues() -> None:
    reports = _five(correct=10)
    reports[1]["blocking_issues"] = ["GT keys outside manifest: ['a.typo']"]
    agg = scorer_module.aggregate_reports(reports)
    assert any("a.typo" in issue for issue in agg["blocking_issues"])


def test_aggregate_rejects_duplicate_documents_and_mixed_configs() -> None:
    dupes = [_doc_report("same.pdf", correct=10) for _ in range(5)]
    dupe_issues = scorer_module.aggregate_reports(dupes)["blocking_issues"]
    assert any("duplicate documents" in i for i in dupe_issues)

    mixed = _five(correct=10)
    mixed[3]["config"] = {"label": "other-experiment", "pdf_path": "/corpus/doc3.pdf"}
    assert any(
        "distinct configs" in i for i in scorer_module.aggregate_reports(mixed)["blocking_issues"]
    )

    # the same config with per-document paths is NOT a mismatch
    assert scorer_module.aggregate_reports(_five(correct=10))["blocking_issues"] == []

    versions = _five(correct=10)
    versions[0]["scorer_version"] = "1.0.0"
    assert any(
        "mixed scorer_version" in i
        for i in scorer_module.aggregate_reports(versions)["blocking_issues"]
    )


def test_aggregate_cli_over_real_run_files(tmp_path: Path) -> None:
    """End-to-end through `main()`: two real run files, expecting five."""
    runs = Path(__file__).resolve().parent.parent / "runs" / "smoke-faculty"
    source = sorted(runs.glob("*.json"))[0]
    payload_in = json.loads(source.read_text())
    run_files = []
    for i in range(2):  # two documents from the same config
        clone = dict(payload_in)
        clone["document"] = {**payload_in["document"], "name": f"clone{i}.pdf"}
        clone["config"] = {**payload_in["config"], "pdf_path": f"/corpus/clone{i}.pdf"}
        path = tmp_path / f"run{i}.json"
        path.write_text(json.dumps(clone), encoding="utf-8")
        run_files.append(path)
    gt = tmp_path / "gt"
    gt.mkdir()
    for run_file in run_files:
        stem = Path(json.loads(run_file.read_text())["document"]["name"]).stem
        (gt / f"{stem}.json").write_text(json.dumps({"metrics": {}}), encoding="utf-8")
    out = tmp_path / "agg.json"
    code = scorer_module.main(
        [*[str(p) for p in run_files], "--gt-dir", str(gt), "--aggregate", "--out", str(out)]
    )
    assert code != 0  # 2 documents, 5 expected -> partial eval, refused
    payload = json.loads(out.read_text())
    assert payload["aggregate"]["documents"] == len(run_files)
    assert len(payload["reports"]) == len(run_files)
    assert any("PARTIAL EVAL" in i for i in payload["aggregate"]["blocking_issues"])
    code_ok = scorer_module.main(
        [*[str(p) for p in run_files], "--gt-dir", str(gt), "--aggregate",
         "--expect-documents", str(len(run_files))]
    )
    assert code_ok == 0
