"""Tests for app/sat/bank_audit.py (plan plans/sat-practice/plan.md §3.6):
each gate is asserted to fail on a crafted fixture that violates it, and to
pass on a clean one. G5 itself never runs here -- it's a separate
`npm run sat:audit-html` step under jsdom -- but this module reads and
records that command's JSON report when one is present, which is exercised
below.
"""

from __future__ import annotations

import json
from pathlib import Path
from uuid import UUID

from app.sat.bank_audit import compute_gates, render_audit_md, run_audit
from app.sat.bank_build import BuildFailure, BuildOutcome, RawBank, SprKeyEntry, load_spr_keys
from domain.sat.taxonomy import Taxonomy
from domain.sat.types import AnswerOption, SatQuestion

_TAXONOMY = Taxonomy.model_validate(
    {
        "modules": [
            {
                "code": "reading",
                "short_label": "EBRW",
                "long_label": "Reading and Writing",
                "order": 1,
                "domains": [
                    {
                        "code": "INI",
                        "name": "Information and Ideas",
                        "order": 1,
                        "skills": [{"code": "CID", "name": "Central Ideas", "order": 1}],
                    }
                ],
            },
            {
                "code": "math",
                "short_label": "Math",
                "long_label": "Math",
                "order": 2,
                "domains": [
                    {
                        "code": "H",
                        "name": "Algebra",
                        "order": 1,
                        "skills": [{"code": "H.A.", "name": "Linear equations", "order": 1}],
                    }
                ],
            },
        ],
        "band_tiers": [
            {"name": "Easy", "bands": [1, 2, 3]},
            {"name": "Medium", "bands": [4, 5]},
            {"name": "Hard", "bands": [6, 7]},
        ],
    }
)


def _mcq_question(
    question_id: str,
    *,
    module: str = "reading",
    domain_cd: str = "INI",
    skill_cd: str = "CID",
    n_options: int = 4,
    source: str = "qbank",
    in_bluebook: bool = False,
) -> SatQuestion:
    options = tuple(AnswerOption(label=chr(65 + i), content=f"opt {i}") for i in range(n_options))
    return SatQuestion(
        question_id=question_id,
        external_id=UUID("11111111-1111-1111-1111-111111111111") if source == "qbank" else None,
        ibn=None if source == "qbank" else "disc-1",
        u_id=UUID("00000000-0000-0000-0000-000000000001"),
        source=source,  # type: ignore[arg-type]
        module=module,  # type: ignore[arg-type]
        domain_cd=domain_cd,
        skill_cd=skill_cd,
        score_band=3,
        difficulty="M",
        program="SAT",
        item_type="mcq",
        in_bluebook=in_bluebook,
        cb_created_at=None,
        cb_updated_at=None,
        content_sha256="x" * 64,
        stimulus=None,
        stem="stem",
        answer_options=options,
        correct_answers=("A",),
        rationale="rationale",
    )


def _spr_question(
    question_id: str, *, keys: tuple[str, ...] = ("4",), source: str = "qbank"
) -> SatQuestion:
    return SatQuestion(
        question_id=question_id,
        external_id=UUID("22222222-2222-2222-2222-222222222222") if source == "qbank" else None,
        ibn=None if source == "qbank" else "disc-2",
        u_id=UUID("00000000-0000-0000-0000-000000000002"),
        source=source,  # type: ignore[arg-type]
        module="math",
        domain_cd="H",
        skill_cd="H.A.",
        score_band=3,
        difficulty="M",
        program="SAT",
        item_type="spr",
        in_bluebook=False,
        cb_created_at=None,
        cb_updated_at=None,
        content_sha256="y" * 64,
        stimulus=None,
        stem="stem",
        answer_options=(),
        correct_answers=keys,
        rationale="rationale",
    )


def _raw_bank(
    *,
    stubs_99: list[dict[str, object]] | None = None,
    superset_extra: dict[str, object] | None = None,
) -> RawBank:
    stubs = stubs_99 or [
        {"questionId": "aaaaaaaa", "external_id": "11111111-1111-1111-1111-111111111111"}
    ]
    superset: dict[tuple[int, int], list[dict[str, object]]] = {
        (100, 1): [],
        (100, 2): [],
        (102, 1): [],
        (102, 2): [],
    }
    if superset_extra:
        superset[(100, 1)] = [superset_extra]
    return RawBank(
        run_dir=Path("/nonexistent"),
        primary_stubs={(99, 1): stubs, (99, 2): []},
        superset_stubs=superset,
        live_external_ids=frozenset({"11111111-1111-1111-1111-111111111111"}),
        robots_outcomes=[
            {"host": "qbank-api.collegeboard.org", "status_code": 404, "decision": "allowed"}
        ],
        run_summary={"started_at": "2026-09-19T00:00:00Z", "counts": {"details_failed": 0}},
    )


class TestG1Coverage:
    def test_passes_with_no_failures(self) -> None:
        raw = _raw_bank()
        outcome = BuildOutcome(questions=[_mcq_question("aaaaaaaa")])
        gates = compute_gates(
            raw,
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g1 = next(g for g in gates if g.name == "G1 coverage")
        assert g1.passed

    def test_fails_when_a_build_failure_exists(self) -> None:
        raw = _raw_bank()
        outcome = BuildOutcome(failures=[BuildFailure("aaaaaaaa", "boom")])
        gates = compute_gates(
            raw,
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g1 = next(g for g in gates if g.name == "G1 coverage")
        assert not g1.passed


class TestG2Superset:
    def test_fails_when_100_carries_a_content_id_not_under_99(self) -> None:
        raw = _raw_bank(
            superset_extra={
                "questionId": "zzzzzzzz",
                "external_id": "99999999-9999-9999-9999-999999999999",
            }
        )
        outcome = BuildOutcome(questions=[_mcq_question("aaaaaaaa")])
        gates = compute_gates(
            raw,
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g2 = next(g for g in gates if g.name == "G2 superset")
        assert not g2.passed


class TestG3Identity:
    def test_fails_on_a_malformed_question_id(self) -> None:
        raw = _raw_bank(stubs_99=[{"questionId": "NOT-HEX", "external_id": "x"}])
        outcome = BuildOutcome(unique_content_id_count=1)
        gates = compute_gates(
            raw,
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g3 = next(g for g in gates if g.name == "G3 identity")
        assert not g3.passed


class TestG4Keys:
    def test_fails_on_an_mcq_with_the_wrong_option_count(self) -> None:
        outcome = BuildOutcome(questions=[_mcq_question("aaaaaaaa", n_options=3)])
        gates = compute_gates(
            _raw_bank(),
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g4 = next(g for g in gates if g.name == "G4 keys")
        assert not g4.passed

    def test_fails_on_a_non_numeric_spr_key(self) -> None:
        outcome = BuildOutcome(questions=[_spr_question("bbbbbbbb", keys=("not-a-number",))])
        gates = compute_gates(
            _raw_bank(),
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g4 = next(g for g in gates if g.name == "G4 keys")
        assert not g4.passed

    def test_passes_on_a_clean_bank(self) -> None:
        outcome = BuildOutcome(questions=[_mcq_question("aaaaaaaa"), _spr_question("bbbbbbbb")])
        gates = compute_gates(
            _raw_bank(),
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g4 = next(g for g in gates if g.name == "G4 keys")
        assert g4.passed


class TestG6Taxonomy:
    def test_fails_when_the_bank_has_a_triple_outside_the_taxonomy(self) -> None:
        outcome = BuildOutcome(
            questions=[_mcq_question("aaaaaaaa", domain_cd="INI", skill_cd="NOT-IN-TAXONOMY")]
        )
        gates = compute_gates(
            _raw_bank(),
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g6 = next(g for g in gates if g.name == "G6 taxonomy")
        assert not g6.passed

    def test_passes_when_every_triple_is_in_the_taxonomy(self) -> None:
        outcome = BuildOutcome(questions=[_mcq_question("aaaaaaaa")])
        gates = compute_gates(
            _raw_bank(),
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g6 = next(g for g in gates if g.name == "G6 taxonomy")
        assert g6.passed


class TestG7Bluebook:
    def test_fails_when_a_disclosed_item_is_incorrectly_flagged_in_bluebook(self) -> None:
        outcome = BuildOutcome(
            questions=[_mcq_question("aaaaaaaa", source="disclosed", in_bluebook=True)]
        )
        gates = compute_gates(
            _raw_bank(),
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g7 = next(g for g in gates if g.name == "G7 bluebook")
        assert not g7.passed


class TestG9NormaliserParity:
    def test_fails_when_the_harness_stamp_is_missing(self) -> None:
        gates = compute_gates(
            _raw_bank(),
            BuildOutcome(questions=[_mcq_question("aaaaaaaa")]),
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g9 = next(g for g in gates if g.name == "G9 normaliser parity")
        assert not g9.passed

    def test_passes_when_a_stamp_is_present(self) -> None:
        gates = compute_gates(
            _raw_bank(),
            BuildOutcome(questions=[_mcq_question("aaaaaaaa")]),
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp={"suite": "normalize", "upstream_commit": "c84d3dc", "count": 39},
        )
        g9 = next(g for g in gates if g.name == "G9 normaliser parity")
        assert g9.passed


class TestG10Spr:
    def test_fails_on_an_unconfirmed_legacy_spr_question(self) -> None:
        outcome = BuildOutcome(questions=[_spr_question("cccccccc", source="disclosed")])
        gates = compute_gates(
            _raw_bank(),
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g10 = next(g for g in gates if g.name == "G10 spr")
        assert not g10.passed

    def test_passes_when_the_legacy_spr_question_is_confirmed(self) -> None:
        outcome = BuildOutcome(questions=[_spr_question("cccccccc", source="disclosed")])
        spr_keys: dict[str, SprKeyEntry] = load_spr_keys(
            {"cccccccc": {"keys": ["4"], "source": "manual", "note": "quoted"}}
        )
        gates = compute_gates(
            _raw_bank(),
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys=spr_keys,
            cross_check_findings=[],
            previous_manifest=None,
            harness_stamp=None,
        )
        g10 = next(g for g in gates if g.name == "G10 spr")
        assert g10.passed


class TestRunAudit:
    def test_writes_manifest_and_audit_md_and_reports_g5_pending(self, tmp_path: Path) -> None:
        raw = _raw_bank()
        outcome = BuildOutcome(questions=[_mcq_question("aaaaaaaa")], unique_content_id_count=1)
        manifest_path = tmp_path / "MANIFEST.json"
        audit_path = tmp_path / "AUDIT.md"

        ok = run_audit(
            raw,
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            bank_sha256="deadbeef",
            raw_archive_sha256="cafef00d",
            manifest_path=manifest_path,
            audit_md_path=audit_path,
            spr_adjudication_note="Keys adjudicated by an AI agent on 2026-09-19.",
            harness_stamp={"suite": "normalize", "upstream_commit": "c84d3dc", "count": 39},
        )

        assert ok
        manifest = json.loads(manifest_path.read_text())
        assert manifest["content_sha256"] == "deadbeef"
        assert manifest["raw_archive_sha256"] == "cafef00d"
        assert manifest["question_count"] == 1
        audit_md = audit_path.read_text()
        assert "G5: PENDING" in audit_md or "G5 render: PENDING" in audit_md
        assert "npm run sat:audit-html" in audit_md

    def test_reads_and_records_a_g5_report_when_one_exists(self, tmp_path: Path) -> None:
        raw = _raw_bank()
        outcome = BuildOutcome(questions=[_mcq_question("aaaaaaaa")], unique_content_id_count=1)
        audit_path = tmp_path / "AUDIT.md"
        g5_report_path = tmp_path / "g5-report.json"
        g5_report_path.write_text(
            json.dumps({"fieldsChecked": 22525, "failureCount": 218, "durationMs": 158599}),
            encoding="utf-8",
        )

        run_audit(
            raw,
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            bank_sha256="deadbeef",
            raw_archive_sha256="cafef00d",
            manifest_path=tmp_path / "MANIFEST.json",
            audit_md_path=audit_path,
            spr_adjudication_note="note",
            harness_stamp={"suite": "normalize", "upstream_commit": "c84d3dc", "count": 39},
            g5_report_path=g5_report_path,
        )

        audit_md = audit_path.read_text()
        assert "G5 render: FAIL" in audit_md
        assert "22525" in audit_md
        assert "218" in audit_md
        assert "158.6s" in audit_md

    def test_a_missing_g5_report_path_still_reports_pending(self, tmp_path: Path) -> None:
        raw = _raw_bank()
        outcome = BuildOutcome(questions=[_mcq_question("aaaaaaaa")], unique_content_id_count=1)
        audit_path = tmp_path / "AUDIT.md"

        run_audit(
            raw,
            outcome,
            taxonomy=_TAXONOMY,
            liprep_bluebook_ids=frozenset(),
            spr_keys={},
            cross_check_findings=[],
            bank_sha256="deadbeef",
            raw_archive_sha256="cafef00d",
            manifest_path=tmp_path / "MANIFEST.json",
            audit_md_path=audit_path,
            spr_adjudication_note="note",
            harness_stamp={"suite": "normalize", "upstream_commit": "c84d3dc", "count": 39},
            g5_report_path=tmp_path / "does-not-exist.json",
        )

        assert "G5 render: PENDING" in audit_path.read_text()


def test_render_audit_md_reports_g5_pass_when_the_report_has_no_failures() -> None:
    gates = compute_gates(
        _raw_bank(),
        BuildOutcome(questions=[_mcq_question("aaaaaaaa")]),
        taxonomy=_TAXONOMY,
        liprep_bluebook_ids=frozenset(),
        spr_keys={},
        cross_check_findings=[],
        previous_manifest=None,
        harness_stamp=None,
    )
    manifest = {
        "content_sha256": "x",
        "raw_archive_sha256": "y",
        "counts": {"total": 1},
        "robots": [],
    }
    rendered = render_audit_md(
        gates=gates,
        manifest=manifest,
        spr_adjudication_note="note",
        g5_report={"fieldsChecked": 100, "failureCount": 0, "durationMs": 5000},
    )
    assert "G5 render: PASS" in rendered


def test_render_audit_md_includes_every_gate_name() -> None:
    gates = compute_gates(
        _raw_bank(),
        BuildOutcome(questions=[_mcq_question("aaaaaaaa")]),
        taxonomy=_TAXONOMY,
        liprep_bluebook_ids=frozenset(),
        spr_keys={},
        cross_check_findings=[],
        previous_manifest=None,
        harness_stamp=None,
    )
    manifest = {
        "content_sha256": "x",
        "raw_archive_sha256": "y",
        "counts": {"total": 1},
        "robots": [],
    }
    rendered = render_audit_md(gates=gates, manifest=manifest, spr_adjudication_note="note")
    for gate in gates:
        assert gate.name in rendered


def test_render_audit_md_lists_each_failure_by_id_and_reason() -> None:
    gates = compute_gates(
        _raw_bank(),
        BuildOutcome(failures=[BuildFailure("aaaaaaaa", "boom")]),
        taxonomy=_TAXONOMY,
        liprep_bluebook_ids=frozenset(),
        spr_keys={},
        cross_check_findings=[],
        previous_manifest=None,
        harness_stamp=None,
    )
    manifest = {
        "content_sha256": "x",
        "raw_archive_sha256": "y",
        "counts": {"total": 1},
        "robots": [],
    }
    rendered = render_audit_md(
        gates=gates,
        manifest=manifest,
        spr_adjudication_note="note",
        failures=[BuildFailure("aaaaaaaa", "boom"), BuildFailure("bbbbbbbb", "bang")],
    )
    assert "## Failures" in rendered
    assert "- aaaaaaaa: boom" in rendered
    assert "- bbbbbbbb: bang" in rendered


def test_render_audit_md_flags_the_disclosed_mcq_missing_answer_field_pattern() -> None:
    gates = compute_gates(
        _raw_bank(),
        BuildOutcome(),
        taxonomy=_TAXONOMY,
        liprep_bluebook_ids=frozenset(),
        spr_keys={},
        cross_check_findings=[],
        previous_manifest=None,
        harness_stamp=None,
    )
    manifest = {
        "content_sha256": "x",
        "raw_archive_sha256": "y",
        "counts": {"total": 1},
        "robots": [],
    }
    rendered = render_audit_md(
        gates=gates,
        manifest=manifest,
        spr_adjudication_note="note",
        failures=[BuildFailure("000259aa", "mcq has 0 correct answers, expected 1")],
    )
    assert "genuine upstream data gap" in rendered
    assert "domain/sat/normalize.py" in rendered


def test_render_audit_md_omits_the_failures_section_when_there_are_none() -> None:
    gates = compute_gates(
        _raw_bank(),
        BuildOutcome(questions=[_mcq_question("aaaaaaaa")]),
        taxonomy=_TAXONOMY,
        liprep_bluebook_ids=frozenset(),
        spr_keys={},
        cross_check_findings=[],
        previous_manifest=None,
        harness_stamp=None,
    )
    manifest = {
        "content_sha256": "x",
        "raw_archive_sha256": "y",
        "counts": {"total": 1},
        "robots": [],
    }
    rendered = render_audit_md(gates=gates, manifest=manifest, spr_adjudication_note="note")
    assert "## Failures" not in rendered
