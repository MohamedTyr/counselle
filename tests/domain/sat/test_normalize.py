"""Normalisation tests (plan.md §3.3, §3.6 G3/G4/G9).

Two kinds of assertion:

1. **Differential (G9), narrow by design.** ``tests/domain/sat/upstream/
   vectors/normalize.json`` records upstream's own ``normalizeQuestion`` /
   ``normalizeDisclosedQuestion`` output for the research corpus's raw
   stub+detail pairs. The harness wrapper that produced those vectors
   already decided ``module`` and pre-lettered options before calling
   upstream (``tests/domain/sat/upstream/harness/lib/wrapper.ts``) — so
   *this* test reconstructs each pair the same way (matching a stub to its
   detail file exactly as ``generate.normalize.spec.ts`` does), runs it
   through ``normalize_qbank``/``normalize_disclosed``, and compares only
   what the wrapper does *not* decide: the ``mcq``/``spr`` discriminator,
   the stimulus/stem splice, the disclosed body/prompt combination, and the
   rationale. See ``tests/domain/sat/upstream/DIFFERENCES.md`` for the full
   list of what is deliberately out of scope.
2. **Direct reject-rule / edge-case tests** for G3/G4's shapes (no id, no
   stem, malformed mcq, the "0" spr-key rule, the keys[0] cross-check, and
   ``choose_canonical``) that don't depend on the vector file at all.

Every vector case is asserted (never skipped); a genuine, unresolvable
mismatch must be reported, not silently weakened.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from domain.sat.normalize import (
    NormalizeError,
    choose_canonical,
    content_sha256,
    normalize_disclosed,
    normalize_qbank,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
RESEARCH_DIR = REPO_ROOT / "artifacts" / "sat-practice" / "research"
VECTORS_DIR = REPO_ROOT / "tests" / "domain" / "sat" / "upstream" / "vectors"

# The E1 domain codes that group under the Math test (plan §3.1's table;
# `wrapper.ts`'s `MATH_DOMAINS`). Only used here to reconstruct the module a
# real fetch pipeline would stamp onto a stub before calling normalize_*.
_MATH_DOMAINS = frozenset({"H", "P", "Q", "S"})

# The vectors' six hand-authored reject cases (plan §8.2) are asserted
# separately in test_reject_rules below, against equivalent NormalizeError
# behaviour rather than upstream's silent-null.
_REJECT_PAIR_IDS = frozenset(
    {
        "empty_stem",
        "missing_question_id",
        "mcq_no_options",
        "mcq_no_correct_answer",
        "not_a_record",
        "null_value",
    }
)


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text())


def _load_all_stubs() -> list[dict[str, Any]]:
    stubs: list[dict[str, Any]] = []
    for f in sorted((RESEARCH_DIR / "list").glob("*.json")):
        stubs.extend(_load_json(f))
    return stubs


def _stub_by_external_id(stubs: list[dict[str, Any]], external_id8: str) -> dict[str, Any] | None:
    for s in stubs:
        eid = s.get("external_id") or ""
        if eid.startswith(external_id8):
            return s
    return None


def _stub_by_ibn(stubs: list[dict[str, Any]], ibn: str) -> dict[str, Any] | None:
    for s in stubs:
        if s.get("ibn") == ibn:
            return s
    return None


def _with_module(stub: dict[str, Any]) -> dict[str, Any]:
    module = "math" if stub.get("primary_class_cd") in _MATH_DOMAINS else "reading"
    return {**stub, "module": module}


def _is_mcq_answer(answer: dict[str, Any]) -> bool:
    style = str(answer.get("style") or "").lower()
    return style in ("multiple choice", "mcq") or bool(answer.get("choices"))


def _load_normalize_vector() -> dict[str, Any]:
    vector = _load_json(VECTORS_DIR / "normalize.json")
    assert isinstance(vector, dict)
    return vector


@pytest.fixture(scope="module")
def stubs() -> list[dict[str, Any]]:
    return _load_all_stubs()


@pytest.fixture(scope="module")
def normalize_vector() -> dict[str, Any]:
    return _load_normalize_vector()


def _real_pair_cases(normalize_vector: dict[str, Any]) -> list[dict[str, Any]]:
    return [c for c in normalize_vector["cases"] if c["pairId"] not in _REJECT_PAIR_IDS]


def test_normalize_vector_has_expected_shape(normalize_vector: dict[str, Any]) -> None:
    assert normalize_vector["suite"] == "normalize"
    assert normalize_vector["count"] == len(normalize_vector["cases"]) == 39
    kinds = {c["kind"] for c in normalize_vector["cases"]}
    assert kinds == {"community", "disclosed"}


def test_normalize_qbank_and_disclosed_match_upstream_in_scope_fields(
    stubs: list[dict[str, Any]], normalize_vector: dict[str, Any]
) -> None:
    """G9: every non-reject case's ``type``, stimulus/stem splice and
    rationale must match upstream's ``normalized`` output exactly."""
    failures: list[str] = []

    for case in _real_pair_cases(normalize_vector):
        pair_id = case["pairId"]
        expected = case["normalized"]
        assert expected is not None, f"{pair_id}: expected a normalized question, got None"

        if pair_id.startswith("ibn_"):
            _check_disclosed_ibn(stubs, pair_id, expected, failures)
        elif case["kind"] == "community":
            _check_community(stubs, pair_id, expected, failures)
        else:
            _check_disclosed_sample(stubs, pair_id, expected, failures)

    if failures:
        pytest.fail("normalize G9 mismatches:\n" + "\n".join(failures), pytrace=False)


def _check_community(
    stubs: list[dict[str, Any]], pair_id: str, expected: dict[str, Any], failures: list[str]
) -> None:
    detail = _load_json(RESEARCH_DIR / "detail" / pair_id)
    stub = _stub_by_external_id(stubs, detail["externalid"][:8])
    assert stub is not None, f"{pair_id}: no matching stub for externalid {detail['externalid']}"

    try:
        got = normalize_qbank(_with_module(stub), detail, live_external_ids=frozenset())
    except NormalizeError as exc:
        failures.append(f"{pair_id}: raised {exc} but upstream normalized it")
        return

    exp_type = "spr" if expected["type"] == "spr" else "mcq"
    if got.item_type != exp_type:
        failures.append(f"{pair_id}: item_type {got.item_type!r} != {exp_type!r}")
    if (got.stimulus or None) != (expected["stimulus"] or None):
        failures.append(
            f"{pair_id}: stimulus mismatch\n  got={got.stimulus!r}\n  exp={expected['stimulus']!r}"
        )
    if got.stem != expected["stem"]:
        failures.append(f"{pair_id}: stem mismatch\n  got={got.stem!r}\n  exp={expected['stem']!r}")
    if got.rationale != expected["rationale"]:
        failures.append(f"{pair_id}: rationale mismatch")


def _check_disclosed_ibn(
    stubs: list[dict[str, Any]], pair_id: str, expected: dict[str, Any], failures: list[str]
) -> None:
    arr = _load_json(RESEARCH_DIR / "detail" / pair_id)
    ibn = pair_id.removeprefix("ibn_").removesuffix(".json")
    stub = _stub_by_ibn(stubs, ibn)
    assert stub is not None, f"{pair_id}: no matching stub for ibn {ibn}"

    entry = arr[0]
    answer = entry.get("answer") or {}
    reviewed = None if _is_mcq_answer(answer) else [expected["correct_answer"][0]]

    try:
        got = normalize_disclosed(_with_module(stub), entry, reviewed_spr_keys=reviewed)
    except NormalizeError as exc:
        failures.append(f"{pair_id}: raised {exc} but upstream normalized it")
        return

    if got.item_type != expected["type"]:
        failures.append(f"{pair_id}: item_type {got.item_type!r} != {expected['type']!r}")
    if (got.stimulus or None) != (expected["stimulus"] or None):
        failures.append(
            f"{pair_id}: stimulus mismatch got={got.stimulus!r} exp={expected['stimulus']!r}"
        )
    if got.stem != expected["stem"]:
        failures.append(f"{pair_id}: stem mismatch\n  got={got.stem!r}\n  exp={expected['stem']!r}")


def _check_disclosed_sample(
    stubs: list[dict[str, Any]], pair_id: str, expected: dict[str, Any], failures: list[str]
) -> None:
    arr = _load_json(RESEARCH_DIR / "disclosed_sample" / pair_id)
    entry = arr[0]
    stub = _stub_by_ibn(stubs, entry["item_id"])
    if stub is None:
        # Mirrors generate.normalize.spec.ts's synthesized minimal stub for a
        # disclosed sample with no stub in this small research corpus — the
        # module/domain fields it carries are stub-derived and out of G9
        # scope regardless.
        stub = {
            "questionId": entry["item_id"],
            "uId": entry["item_id"],
            "ibn": entry["item_id"],
            "primary_class_cd": "H",
            "skill_cd": "H.A.",
            "score_band_range_cd": 3,
            "difficulty": "M",
            "program": "SAT",
            "module": "math",
        }
    else:
        stub = _with_module(stub)

    answer = entry.get("answer") or {}
    is_mcq = _is_mcq_answer(answer)
    reviewed = None if is_mcq else [expected["correct_answer"][0]]

    try:
        got = normalize_disclosed(stub, entry, reviewed_spr_keys=reviewed)
    except NormalizeError as exc:
        failures.append(f"{pair_id}: raised {exc} but upstream normalized it")
        return

    if got.item_type != expected["type"]:
        failures.append(f"{pair_id}: item_type {got.item_type!r} != {expected['type']!r}")
    if (got.stimulus or None) != (expected["stimulus"] or None):
        failures.append(
            f"{pair_id}: stimulus mismatch got={got.stimulus!r} exp={expected['stimulus']!r}"
        )
    if got.stem != expected["stem"]:
        failures.append(f"{pair_id}: stem mismatch\n  got={got.stem!r}\n  exp={expected['stem']!r}")
    if is_mcq and list(got.correct_answers) != expected["correct_answer"]:
        failures.append(
            f"{pair_id}: correct_answer mismatch "
            f"got={got.correct_answers} exp={expected['correct_answer']}"
        )


# --- Direct reject-rule tests (G3/G4's shapes; plan §8.2's "hand-derived,
# upstream cannot produce them" cases) -------------------------------------


def _valid_stub(**overrides: Any) -> dict[str, Any]:
    base = {
        "questionId": "deadbeef",
        "uId": "00000000-0000-0000-0000-000000000001",
        "external_id": "00000000-0000-0000-0000-000000000002",
        "ibn": None,
        "primary_class_cd": "H",
        "skill_cd": "H.A.",
        "score_band_range_cd": 3,
        "difficulty": "M",
        "program": "SAT",
        "module": "math",
    }
    base.update(overrides)
    return base


def test_normalize_qbank_rejects_no_stem() -> None:
    with pytest.raises(NormalizeError, match="no stem"):
        normalize_qbank(
            _valid_stub(),
            {"type": "spr", "stem": "", "correct_answer": ["1"]},
            live_external_ids=frozenset(),
        )


def test_normalize_qbank_rejects_missing_question_id() -> None:
    with pytest.raises(NormalizeError, match="no questionId"):
        normalize_qbank(
            _valid_stub(questionId=""),
            {"type": "spr", "stem": "x", "correct_answer": ["1"]},
            live_external_ids=frozenset(),
        )


def test_normalize_qbank_rejects_non_numeric_score_band() -> None:
    with pytest.raises(NormalizeError, match="score_band_range_cd must be an integer"):
        normalize_qbank(
            _valid_stub(score_band_range_cd="not-a-number"),
            {"type": "spr", "stem": "x", "correct_answer": ["1"], "rationale": "r"},
            live_external_ids=frozenset(),
        )


def test_normalize_qbank_rejects_missing_score_band() -> None:
    """A missing band is not a plausible ``0`` (``SatQuestion.score_band``
    requires 1-7) — it's a data problem to surface, not paper over."""
    with pytest.raises(NormalizeError, match="score_band_range_cd must be an integer"):
        normalize_qbank(
            _valid_stub(score_band_range_cd=None),
            {"type": "spr", "stem": "x", "correct_answer": ["1"], "rationale": "r"},
            live_external_ids=frozenset(),
        )


def test_normalize_qbank_rejects_mcq_without_four_options() -> None:
    with pytest.raises(NormalizeError, match="options, expected 4"):
        normalize_qbank(
            _valid_stub(),
            {
                "type": "mcq",
                "stem": "x",
                "correct_answer": ["A"],
                "answerOptions": [{"id": "a", "content": "one"}],
            },
            live_external_ids=frozenset(),
        )


def test_normalize_qbank_rejects_mcq_without_correct_answer() -> None:
    with pytest.raises(NormalizeError, match="correct answers, expected 1"):
        normalize_qbank(
            _valid_stub(),
            {
                "type": "mcq",
                "stem": "x",
                "correct_answer": [],
                "answerOptions": [{"id": i, "content": i} for i in "abcd"],
            },
            live_external_ids=frozenset(),
        )


def test_normalize_qbank_rejects_mcq_key_position_mismatch() -> None:
    """G4's cross-check: ``correct_answer`` must agree with the position of
    ``keys[0]`` among the raw options."""
    detail = {
        "type": "mcq",
        "stem": "x",
        "correct_answer": ["A"],
        "keys": ["opt-c"],
        "answerOptions": [
            {"id": "opt-a", "content": "1"},
            {"id": "opt-b", "content": "2"},
            {"id": "opt-c", "content": "3"},
            {"id": "opt-d", "content": "4"},
        ],
    }
    with pytest.raises(NormalizeError, match="does not match keys\\[0\\]"):
        normalize_qbank(_valid_stub(), detail, live_external_ids=frozenset())


def test_normalize_qbank_accepts_matching_key_position() -> None:
    detail = {
        "type": "mcq",
        "stem": "x",
        "correct_answer": ["C"],
        "keys": ["opt-c"],
        "rationale": "r",
        "answerOptions": [
            {"id": "opt-a", "content": "1"},
            {"id": "opt-b", "content": "2"},
            {"id": "opt-c", "content": "3"},
            {"id": "opt-d", "content": "4"},
        ],
    }
    got = normalize_qbank(_valid_stub(), detail, live_external_ids=frozenset())
    assert got.correct_answers == ("C",)


def test_normalize_qbank_rejects_keys_zero_matching_no_option() -> None:
    """G4: ``keys[0]`` must resolve to one of the raw options' positions —
    an id that matches nothing is a hard reject, not a silent no-op."""
    detail = {
        "type": "mcq",
        "stem": "x",
        "correct_answer": ["A"],
        "keys": ["garbage-id"],
        "answerOptions": [
            {"id": "opt-a", "content": "1"},
            {"id": "opt-b", "content": "2"},
            {"id": "opt-c", "content": "3"},
            {"id": "opt-d", "content": "4"},
        ],
    }
    with pytest.raises(NormalizeError, match="does not match any option"):
        normalize_qbank(_valid_stub(), detail, live_external_ids=frozenset())


def test_normalize_qbank_rejects_mcq_with_no_keys() -> None:
    """A real E2 detail always carries ``keys`` (plan §3.6 G4); an mcq
    detail missing the field entirely is rejected rather than silently
    skipping the cross-check."""
    detail = {
        "type": "mcq",
        "stem": "x",
        "correct_answer": ["A"],
        "answerOptions": [
            {"id": "opt-a", "content": "1"},
            {"id": "opt-b", "content": "2"},
            {"id": "opt-c", "content": "3"},
            {"id": "opt-d", "content": "4"},
        ],
    }
    with pytest.raises(NormalizeError, match="no keys to cross-check"):
        normalize_qbank(_valid_stub(), detail, live_external_ids=frozenset())


def test_spr_key_of_zero_is_a_real_answer_not_missing() -> None:
    """Deliberate difference from upstream (§3.3): upstream treats an
    all-"0" key as "missing" (community dumps use "0" as filler); a real
    College Board key of "0" is a genuine answer and must survive."""
    detail = {"type": "spr", "stem": "x", "correct_answer": ["0"], "rationale": "r"}
    got = normalize_qbank(_valid_stub(), detail, live_external_ids=frozenset())
    assert got.correct_answers == ("0",)


def test_normalize_qbank_rejects_spr_with_no_correct_answer() -> None:
    with pytest.raises(NormalizeError, match="no correct_answer"):
        normalize_qbank(
            _valid_stub(),
            {"type": "spr", "stem": "x", "correct_answer": []},
            live_external_ids=frozenset(),
        )


def test_normalize_qbank_applies_spr_additions() -> None:
    detail = {"type": "spr", "stem": "x", "correct_answer": ["1/2"], "rationale": "r"}
    got = normalize_qbank(
        _valid_stub(), detail, live_external_ids=frozenset(), spr_additions=("0.5", "1/2")
    )
    assert got.correct_answers == ("1/2", "0.5")


def test_normalize_qbank_sets_in_bluebook_from_live_external_ids() -> None:
    detail = {
        "type": "mcq",
        "stem": "x",
        "correct_answer": ["A"],
        "keys": ["a"],
        "rationale": "r",
        "answerOptions": [{"id": i, "content": i} for i in "abcd"],
    }
    live = frozenset({"00000000-0000-0000-0000-000000000002"})
    got = normalize_qbank(_valid_stub(), detail, live_external_ids=live)
    assert got.in_bluebook is True

    got_not_live = normalize_qbank(_valid_stub(), detail, live_external_ids=frozenset())
    assert got_not_live.in_bluebook is False


def test_normalize_qbank_math_merges_stimulus_and_nulls_it() -> None:
    detail = {
        "type": "mcq",
        "stimulus": "Context paragraph.",
        "stem": "What is x?",
        "correct_answer": ["A"],
        "keys": ["a"],
        "rationale": "r",
        "answerOptions": [{"id": i, "content": i} for i in "abcd"],
    }
    got = normalize_qbank(_valid_stub(module="math"), detail, live_external_ids=frozenset())
    assert got.stimulus is None
    assert got.stem == "Context paragraph.\nWhat is x?"


def test_normalize_qbank_rw_strips_leading_stimulus_copy() -> None:
    detail = {
        "type": "mcq",
        "stimulus": "Shared passage text.",
        "stem": "Shared passage text. Which choice completes it?",
        "correct_answer": ["A"],
        "keys": ["a"],
        "rationale": "r",
        "answerOptions": [{"id": i, "content": i} for i in "abcd"],
    }
    got = normalize_qbank(_valid_stub(module="reading"), detail, live_external_ids=frozenset())
    assert got.stimulus == "Shared passage text."
    assert got.stem == "Which choice completes it?"


def test_normalize_qbank_rejects_external_id_and_ibn_both_set() -> None:
    with pytest.raises(NormalizeError, match="exactly one of external_id or ibn"):
        normalize_qbank(
            _valid_stub(ibn="022222-DC"),
            {
                "type": "mcq",
                "stem": "x",
                "correct_answer": ["A"],
                "keys": ["a"],
                "rationale": "r",
                "answerOptions": [{"id": i, "content": i} for i in "abcd"],
            },
            live_external_ids=frozenset(),
        )


def test_normalize_qbank_rejects_external_id_and_ibn_both_missing() -> None:
    with pytest.raises(NormalizeError, match="exactly one of external_id or ibn"):
        normalize_qbank(
            _valid_stub(external_id=None, ibn=None),
            {
                "type": "mcq",
                "stem": "x",
                "correct_answer": ["A"],
                "keys": ["a"],
                "rationale": "r",
                "answerOptions": [{"id": i, "content": i} for i in "abcd"],
            },
            live_external_ids=frozenset(),
        )


def test_normalize_disclosed_rejects_legacy_spr_without_reviewed_key() -> None:
    item = {
        "item_id": "070908-DC",
        "prompt": "<p>What is the percent decrease?</p>",
        "answer": {"style": "SPR", "rationale": "The correct answer is 75."},
    }
    with pytest.raises(NormalizeError, match="no reviewed key"):
        normalize_disclosed(
            _valid_stub(external_id=None, ibn="070908-DC"), item, reviewed_spr_keys=None
        )


def test_normalize_disclosed_accepts_confirmed_legacy_spr_key() -> None:
    item = {
        "item_id": "070908-DC",
        "prompt": "<p>What is the percent decrease?</p>",
        "answer": {"style": "SPR", "rationale": "The correct answer is 75."},
    }
    got = normalize_disclosed(
        _valid_stub(external_id=None, ibn="070908-DC"), item, reviewed_spr_keys=["75"]
    )
    assert got.correct_answers == ("75",)
    assert got.item_type == "spr"
    assert got.source == "disclosed"
    assert got.in_bluebook is False


def test_normalize_disclosed_math_combines_body_and_prompt() -> None:
    item = {
        "item_id": "abc123",
        "body": "<p>A cargo helicopter...</p>",
        "prompt": "<p>What is the maximum number of packages?</p>",
        "answer": {
            "style": "Multiple Choice",
            "choices": {
                "a": {"body": "2"},
                "b": {"body": "4"},
                "c": {"body": "5"},
                "d": {"body": "6"},
            },
            "correct_choice": "c",
            "rationale": "Choice C is correct.",
        },
    }
    got = normalize_disclosed(
        _valid_stub(external_id=None, ibn="abc123"), item, reviewed_spr_keys=None
    )
    assert got.stimulus is None
    assert (
        got.stem == "<p>A cargo helicopter...</p>\n<p>What is the maximum number of packages?</p>"
    )
    assert got.correct_answers == ("C",)
    assert [o.label for o in got.answer_options] == ["A", "B", "C", "D"]


def test_normalize_disclosed_reading_keeps_body_as_stimulus() -> None:
    item = {
        "item_id": "rw001",
        "body": "<p>A passage about birds.</p>",
        "prompt": "<p>Which choice best completes the text?</p>",
        "answer": {
            "style": "Multiple Choice",
            "choices": {
                "a": {"body": "1"},
                "b": {"body": "2"},
                "c": {"body": "3"},
                "d": {"body": "4"},
            },
            "correct_choice": "a",
            "rationale": "r",
        },
    }
    got = normalize_disclosed(
        _valid_stub(module="reading", external_id=None, ibn="rw001"), item, reviewed_spr_keys=None
    )
    assert got.stimulus == "<p>A passage about birds.</p>"
    assert got.stem == "<p>Which choice best completes the text?</p>"


def test_normalize_disclosed_rejects_no_stem() -> None:
    item = {"item_id": "x1", "answer": {"style": "SPR", "rationale": "r"}}
    with pytest.raises(NormalizeError, match="no stem"):
        normalize_disclosed(_valid_stub(external_id=None, ibn="x1"), item, reviewed_spr_keys=["1"])


def test_normalize_disclosed_rejects_mcq_without_four_options() -> None:
    item = {
        "item_id": "x2",
        "prompt": "<p>q</p>",
        "answer": {
            "style": "Multiple Choice",
            "choices": {"a": {"body": "1"}, "b": {"body": "2"}},
            "correct_choice": "a",
            "rationale": "r",
        },
    }
    with pytest.raises(NormalizeError, match="options, expected 4"):
        normalize_disclosed(_valid_stub(external_id=None, ibn="x2"), item, reviewed_spr_keys=None)


def test_normalize_qbank_and_disclosed_raise_on_non_mapping_detail() -> None:
    with pytest.raises(NormalizeError, match="not a JSON object"):
        normalize_qbank(_valid_stub(), "just a string", live_external_ids=frozenset())  # type: ignore[arg-type]
    with pytest.raises(NormalizeError, match="not a JSON object"):
        normalize_disclosed(_valid_stub(), "just a string", reviewed_spr_keys=["1"])  # type: ignore[arg-type]


def test_normalize_qbank_and_disclosed_raise_without_module() -> None:
    stub = _valid_stub()
    del stub["module"]
    detail = {"type": "spr", "stem": "x", "correct_answer": ["1"], "rationale": "r"}
    with pytest.raises(NormalizeError, match="neither 'module' nor 'test'"):
        normalize_qbank(stub, detail, live_external_ids=frozenset())


def test_normalize_qbank_accepts_test_field_in_place_of_module() -> None:
    stub = _valid_stub()
    del stub["module"]
    stub["test"] = 2
    detail = {"type": "spr", "stem": "x", "correct_answer": ["1"], "rationale": "r"}
    got = normalize_qbank(stub, detail, live_external_ids=frozenset())
    assert got.module == "math"

    stub["test"] = 1
    got_reading = normalize_qbank(stub, detail, live_external_ids=frozenset())
    assert got_reading.module == "reading"


# --- choose_canonical / content_sha256 -------------------------------------


def test_choose_canonical_prefers_bluebook_id() -> None:
    canonical, aliases = choose_canonical(["zzzzzzzz", "aaaaaaaa"], frozenset({"zzzzzzzz"}))
    assert canonical == "zzzzzzzz"
    assert aliases == ("aaaaaaaa",)


def test_choose_canonical_falls_back_to_lexicographically_smaller() -> None:
    canonical, aliases = choose_canonical(["bbbbbbbb", "aaaaaaaa"], frozenset())
    assert canonical == "aaaaaaaa"
    assert aliases == ("bbbbbbbb",)


def test_choose_canonical_requires_at_least_one_id() -> None:
    with pytest.raises(ValueError, match="at least one"):
        choose_canonical([], frozenset())


def test_content_sha256_is_stable_and_content_sensitive() -> None:
    def _hash(stem: str) -> str:
        return content_sha256(
            stimulus=None,
            stem=stem,
            answer_options=[{"label": "A", "content": "2"}],
            correct_answers=["A"],
            rationale="Because.",
        )

    first = _hash("What is 1+1?")
    second = _hash("What is 1+1?")
    assert first == second
    assert len(first) == 64

    changed = _hash("What is 1+2?")
    assert changed != first
