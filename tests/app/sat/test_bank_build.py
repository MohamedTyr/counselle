"""Tests for app/sat/bank_build.py (plan plans/sat-practice/plan.md §3.2
"build", §3.3, §3.6 G1/G3). A tiny crafted raw run dir stands in for a real
`fetch` output -- these pin determinism and the build-level reject rules
(G1's E3 single-element check, a stub with a duplicate content id) that
`domain/sat/normalize.py` itself doesn't own.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.sat.bank_build import (
    RawBank,
    load_raw_bank,
    load_spr_keys,
    qbank_spr_cross_check,
    run_build,
    write_bank_file,
    write_raw_archive,
)

_MCQ_DETAIL = {
    "type": "mcq",
    "stem": "<p>Pick one.</p>",
    "keys": ["opt-b-uuid"],
    "answerOptions": [
        {"id": "opt-a-uuid", "content": "<p>A</p>"},
        {"id": "opt-b-uuid", "content": "<p>B</p>"},
        {"id": "opt-c-uuid", "content": "<p>C</p>"},
        {"id": "opt-d-uuid", "content": "<p>D</p>"},
    ],
    "correct_answer": ["B"],
    "rationale": "<p>B is correct.</p>",
}

_SPR_DETAIL = {
    "type": "spr",
    "stem": "<p>What is 2+2?</p>",
    "correct_answer": ["4"],
    "rationale": "<p>The answer is 4.</p>",
}


def _stub(
    question_id: str,
    *,
    test: int,
    domain: str,
    skill: str = "SKL",
    external_id: str | None = None,
    ibn: str | None = None,
    band: int = 3,
) -> dict[str, object]:
    return {
        "questionId": question_id,
        "external_id": external_id,
        "ibn": ibn,
        "uId": "00000000-0000-0000-0000-00000000000" + question_id[-1],
        "primary_class_cd": domain,
        "skill_cd": skill,
        "score_band_range_cd": band,
        "difficulty": "M",
        "program": "SAT",
        "createDate": 1691007959325,
        "updateDate": 1691007959325,
        "test": test,
        "module": "reading" if test == 1 else "math",
    }


def _write_run_dir(root: Path) -> Path:
    """A minimal raw run dir with one R&W mcq (qbank), one Math mcq
    (qbank), one Math spr (qbank), one disclosed mcq, and one disclosed spr
    -- plus a duplicate content id filed under two questionIds (§3.3)."""
    run_dir = root / "run"
    (run_dir / "list").mkdir(parents=True)
    (run_dir / "detail").mkdir()
    (run_dir / "disclosed").mkdir()

    rw_mcq = _stub(
        "aaaaaaaa", test=1, domain="INI", external_id="11111111-1111-1111-1111-111111111111"
    )
    math_mcq_1 = _stub(
        "bbbbbbbb", test=2, domain="H", external_id="22222222-2222-2222-2222-222222222222"
    )
    math_mcq_2 = _stub(
        "cccccccc", test=2, domain="P", external_id="22222222-2222-2222-2222-222222222222"
    )
    math_spr = _stub(
        "dddddddd", test=2, domain="H", external_id="33333333-3333-3333-3333-333333333333"
    )

    (run_dir / "list" / "asmt99_test1.json").write_text(json.dumps([rw_mcq]))
    (run_dir / "list" / "asmt99_test2.json").write_text(
        json.dumps([math_mcq_1, math_mcq_2, math_spr])
    )
    for assessment in (100, 102):
        for test in (1, 2):
            (run_dir / "list" / f"asmt{assessment}_test{test}.json").write_text("[]")

    (run_dir / "detail" / "11111111-1111-1111-1111-111111111111.json").write_text(
        json.dumps(_MCQ_DETAIL)
    )
    (run_dir / "detail" / "22222222-2222-2222-2222-222222222222.json").write_text(
        json.dumps(_MCQ_DETAIL)
    )
    (run_dir / "detail" / "33333333-3333-3333-3333-333333333333.json").write_text(
        json.dumps(_SPR_DETAIL)
    )

    (run_dir / "lookup.json").write_text(
        json.dumps(
            {
                "mathLiveItems": ["22222222-2222-2222-2222-222222222222"],
                "readingLiveItems": ["11111111-1111-1111-1111-111111111111"],
            }
        )
    )
    (run_dir / "robots.json").write_text(
        json.dumps(
            [{"host": "qbank-api.collegeboard.org", "status_code": 404, "decision": "allowed"}]
        )
    )
    (run_dir / "run.json").write_text(
        json.dumps(
            {
                "started_at": "2026-09-19T00:00:00+00:00",
                "finished_at": "2026-09-19T00:01:00+00:00",
                "counts": {
                    "stubs": 4,
                    "unique_content_ids": 3,
                    "details_fetched": 3,
                    "details_skipped": 0,
                    "details_failed": 0,
                },
            }
        )
    )
    return run_dir


def _add_disclosed(run_dir: Path, *, question_id: str, ibn: str, spr: bool) -> None:
    stub = _stub(question_id, test=2, domain="H", ibn=ibn)
    test2 = json.loads((run_dir / "list" / "asmt99_test2.json").read_text())
    test2.append(stub)
    (run_dir / "list" / "asmt99_test2.json").write_text(json.dumps(test2))

    if spr:
        item = [
            {
                "item_id": ibn,
                "section": "Math",
                "prompt": "<p>Disclosed spr prompt.</p>",
                "answer": {"style": "Grid-In", "rationale": "<p>The correct answer is 5.</p>"},
            }
        ]
    else:
        item = [
            {
                "item_id": ibn,
                "section": "Math",
                "prompt": "<p>Disclosed mcq prompt.</p>",
                "answer": {
                    "style": "Multiple Choice",
                    "choices": {
                        "a": {"body": "1"},
                        "b": {"body": "2"},
                        "c": {"body": "3"},
                        "d": {"body": "4"},
                    },
                    "correct_choice": "b",
                    "rationale": "<p>B.</p>",
                },
            }
        ]
    (run_dir / "disclosed" / f"{ibn}.json").write_text(json.dumps(item))


class TestRunBuild:
    def test_builds_every_question_and_resolves_the_duplicate(self, tmp_path: Path) -> None:
        run_dir = _write_run_dir(tmp_path)
        raw = load_raw_bank(run_dir)

        outcome = run_build(raw, spr_keys={}, liprep_bluebook_ids=frozenset())

        assert outcome.ok, outcome.failures
        assert outcome.stub_count == 4
        assert outcome.unique_content_id_count == 3
        assert len(outcome.questions) == 3
        # bbbbbbbb/cccccccc share a content id; lexicographically smaller wins.
        canonical_ids = {q.question_id for q in outcome.questions}
        assert canonical_ids == {"aaaaaaaa", "bbbbbbbb", "dddddddd"}
        assert outcome.aliases["bbbbbbbb"] == ("cccccccc",)

    def test_bluebook_duplicate_prefers_the_liprep_id(self, tmp_path: Path) -> None:
        run_dir = _write_run_dir(tmp_path)
        raw = load_raw_bank(run_dir)

        outcome = run_build(raw, spr_keys={}, liprep_bluebook_ids=frozenset({"cccccccc"}))

        canonical_ids = {q.question_id for q in outcome.questions}
        assert "cccccccc" in canonical_ids
        assert outcome.aliases["cccccccc"] == ("bbbbbbbb",)

    def test_e3_response_not_a_single_element_array_is_a_failure(self, tmp_path: Path) -> None:
        run_dir = _write_run_dir(tmp_path)
        _add_disclosed(run_dir, question_id="eeeeeeee", ibn="disc-mcq", spr=False)
        (run_dir / "disclosed" / "disc-mcq.json").write_text(
            json.dumps([{"item_id": "x"}, {"item_id": "y"}])
        )
        raw = load_raw_bank(run_dir)

        outcome = run_build(raw, spr_keys={}, liprep_bluebook_ids=frozenset())

        assert not outcome.ok
        assert any("single-element array" in f.reason for f in outcome.failures)

    def test_legacy_disclosed_spr_without_a_reviewed_key_is_a_failure(self, tmp_path: Path) -> None:
        run_dir = _write_run_dir(tmp_path)
        _add_disclosed(run_dir, question_id="ffffffff", ibn="disc-spr", spr=True)
        raw = load_raw_bank(run_dir)

        outcome = run_build(raw, spr_keys={}, liprep_bluebook_ids=frozenset())

        assert not outcome.ok
        assert any(f.question_id == "ffffffff" for f in outcome.failures)

    def test_legacy_disclosed_spr_with_a_reviewed_key_succeeds(self, tmp_path: Path) -> None:
        run_dir = _write_run_dir(tmp_path)
        _add_disclosed(run_dir, question_id="ffffffff", ibn="disc-spr", spr=True)
        raw = load_raw_bank(run_dir)
        spr_keys = load_spr_keys(
            {"ffffffff": {"keys": ["5"], "source": "manual", "note": "quoted"}}
        )

        outcome = run_build(raw, spr_keys=spr_keys, liprep_bluebook_ids=frozenset())

        assert outcome.ok, outcome.failures
        spr_question = next(q for q in outcome.questions if q.question_id == "ffffffff")
        assert spr_question.correct_answers == ("5",)

    def test_a_stub_with_neither_id_is_a_failure_not_a_crash(self, tmp_path: Path) -> None:
        run_dir = _write_run_dir(tmp_path)
        test1 = json.loads((run_dir / "list" / "asmt99_test1.json").read_text())
        test1.append(_stub("gggggggg", test=1, domain="INI"))
        (run_dir / "list" / "asmt99_test1.json").write_text(json.dumps(test1))
        raw = load_raw_bank(run_dir)

        outcome = run_build(raw, spr_keys={}, liprep_bluebook_ids=frozenset())

        assert not outcome.ok
        assert any(f.question_id == "gggggggg" for f in outcome.failures)


class TestDeterminism:
    def test_write_bank_file_is_byte_identical_across_runs(self, tmp_path: Path) -> None:
        run_dir = _write_run_dir(tmp_path)
        raw = load_raw_bank(run_dir)
        outcome = run_build(raw, spr_keys={}, liprep_bluebook_ids=frozenset())

        first = tmp_path / "bank1.jsonl.gz"
        second = tmp_path / "bank2.jsonl.gz"
        _, sha1 = write_bank_file(first, outcome)
        _, sha2 = write_bank_file(second, outcome)

        assert sha1 == sha2
        assert first.read_bytes() == second.read_bytes()

    def test_write_raw_archive_is_byte_identical_across_runs(self, tmp_path: Path) -> None:
        run_dir = _write_run_dir(tmp_path)

        sha1 = write_raw_archive(run_dir, tmp_path / "archive1.tar.gz")
        sha2 = write_raw_archive(run_dir, tmp_path / "archive2.tar.gz")

        assert sha1 == sha2
        assert (tmp_path / "archive1.tar.gz").read_bytes() == (
            tmp_path / "archive2.tar.gz"
        ).read_bytes()


class TestBankOverMaxSize:
    def test_a_bank_over_the_byte_cap_stops_the_build(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        import app.sat.bank_build as bank_build_module

        run_dir = _write_run_dir(tmp_path)
        raw = load_raw_bank(run_dir)
        outcome = run_build(raw, spr_keys={}, liprep_bluebook_ids=frozenset())
        monkeypatch.setattr(bank_build_module, "MAX_BANK_BYTES", 10)

        with pytest.raises(ValueError, match="stopping the build"):
            write_bank_file(tmp_path / "bank.jsonl.gz", outcome)
        assert not (tmp_path / "bank.jsonl.gz").exists()


class TestQbankSprCrossCheck:
    def test_a_rationale_naming_a_second_answer_is_a_residue(self, tmp_path: Path) -> None:
        run_dir = _write_run_dir(tmp_path)
        detail = dict(_SPR_DETAIL)
        detail["rationale"] = "<p>The correct answers are 4 and 5.</p>"
        (run_dir / "detail" / "33333333-3333-3333-3333-333333333333.json").write_text(
            json.dumps(detail)
        )
        raw = load_raw_bank(run_dir)
        outcome = run_build(raw, spr_keys={}, liprep_bluebook_ids=frozenset())

        findings = qbank_spr_cross_check(outcome)

        assert any("dddddddd" in f and "5" in f for f in findings)


def test_load_raw_bank_reads_every_list_and_lookup_file(tmp_path: Path) -> None:
    run_dir = _write_run_dir(tmp_path)
    raw = load_raw_bank(run_dir)
    assert isinstance(raw, RawBank)
    assert len(raw.primary_stubs[(99, 1)]) == 1
    assert len(raw.primary_stubs[(99, 2)]) == 3
    assert raw.live_external_ids == {
        "22222222-2222-2222-2222-222222222222",
        "11111111-1111-1111-1111-111111111111",
    }
