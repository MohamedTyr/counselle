"""`python -m app.sat audit` — writes `deploy/seed/sat/{MANIFEST.json,AUDIT.md}`
and exits non-zero on failure (plan plans/sat-practice/plan.md §3.6).

Runs the executable gates G1-G4, G6-G10 against a `RawBank` snapshot and a
`BuildOutcome` (both from `app/sat/bank_build.py`). G5 (the real-renderer
DOMPurify pass, `npm run sat:audit-html`) needs a browser-like DOM and is a
separate step; this module only records its result as pending in
`AUDIT.md`.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from app.sat.bank_build import BuildFailure, BuildOutcome, RawBank, SprKeyEntry
from domain.sat.grading import parse_numeric
from domain.sat.taxonomy import Taxonomy

__all__ = ["AUDIT_ENDPOINTS", "GateResult", "compute_gates", "render_audit_md", "run_audit"]

_QUESTION_ID_RE = re.compile(r"^[0-9a-f]{8}$")

# A `NormalizeError` this exact shape (`domain/sat/normalize.py`,
# `_disclosed_mcq_correct_answers`) means the legacy disclosed item's
# `answer` object carries none of `correct_choice` / `correct_answer` /
# `correctChoice` at all -- verified against the raw E3 responses: the
# correct option is stated only in the rationale's prose (e.g. "Choice C
# is correct."). That is a genuine upstream data gap in the structured
# field, not a build-side bug, and there is currently no reviewed-override
# path for it (unlike `reviewed_spr_keys` for legacy disclosed SPR, plan
# §3.5) -- fixing it needs a `domain/sat/normalize.py` change, out of this
# module's scope.
_DISCLOSED_MCQ_NO_ANSWER_FIELD_RE = re.compile(r"^mcq has 0 correct answers, expected 1$")

# plan §3.1's table -- fixed documentation, never derived from the raw data
# itself (there is nothing in a `fetch` run that names the endpoint shape).
AUDIT_ENDPOINTS: tuple[dict[str, str], ...] = (
    {
        "id": "E1",
        "call": (
            "POST qbank-api.collegeboard.org/msreportingquestionbank-prod/"
            "questionbank/digital/get-questions"
        ),
    },
    {"id": "E2", "call": "POST .../questionbank/digital/get-question"},
    {"id": "E3", "call": "GET saic.collegeboard.org/disclosed/{ibn}.json"},
    {"id": "E4", "call": "GET .../questionbank/lookup"},
)


class GateResult:
    def __init__(self, name: str, passed: bool, findings: Sequence[str] = ()) -> None:
        self.name = name
        self.passed = passed
        self.findings = list(findings)


def _gate_g1(raw: RawBank, outcome: BuildOutcome) -> GateResult:
    findings: list[str] = []
    if not outcome.ok:
        findings.append(f"{len(outcome.failures)} build failure(s), see the Failures section below")
    if raw.run_summary.get("counts", {}).get("details_failed", 0):
        findings.append(
            f"fetch run recorded {raw.run_summary['counts']['details_failed']} detail failure(s)"
        )
    passed = not outcome.failures and not raw.run_summary.get("counts", {}).get("details_failed", 0)
    return GateResult("G1 coverage", passed, findings)


def _stub_content_ids(stubs: Sequence[Mapping[str, Any]]) -> set[str]:
    ids: set[str] = set()
    for stub in stubs:
        external_id = stub.get("external_id")
        ibn = stub.get("ibn")
        if isinstance(external_id, str) and external_id.strip():
            ids.add(external_id.strip())
        elif isinstance(ibn, str) and ibn.strip():
            ids.add(ibn.strip())
    return ids


def _gate_g2(raw: RawBank) -> GateResult:
    ids_99 = _stub_content_ids(raw.primary_stubs[(99, 1)]) | _stub_content_ids(
        raw.primary_stubs[(99, 2)]
    )
    findings: list[str] = []
    passed = True
    for key, stubs in raw.superset_stubs.items():
        ids = _stub_content_ids(stubs)
        missing = ids - ids_99
        if missing:
            passed = False
            findings.append(
                f"assessment {key[0]} test {key[1]}: {len(missing)} content id(s) not under 99"
            )

    qids_99 = {
        str(s["questionId"])
        for lst in (raw.primary_stubs[(99, 1)], raw.primary_stubs[(99, 2)])
        for s in lst
    }
    for key, stubs in raw.superset_stubs.items():
        overlap = qids_99 & {str(s["questionId"]) for s in stubs}
        if overlap:
            findings.append(
                f"assessment {key[0]} test {key[1]}: {len(overlap)} questionId(s) collide "
                "with assessment 99 (companion check -- questionIds are expected disjoint "
                "across assessments)"
            )
    return GateResult("G2 superset", passed, findings)


def _gate_g3(raw: RawBank, outcome: BuildOutcome) -> GateResult:
    stubs = raw.primary_stubs[(99, 1)] + raw.primary_stubs[(99, 2)]
    findings: list[str] = []
    passed = True

    bad_shape = [
        str(s.get("questionId"))
        for s in stubs
        if not _QUESTION_ID_RE.match(str(s.get("questionId", "")))
    ]
    if bad_shape:
        passed = False
        findings.append(
            f"{len(bad_shape)} questionId(s) do not match ^[0-9a-f]{{8}}$: {bad_shape[:10]}"
        )

    duplicate_groups = {qid: aliases for qid, aliases in outcome.aliases.items() if aliases}
    findings.append(
        f"{len(duplicate_groups)} duplicate content-id group(s), each resolved to one canonical id"
    )
    for canonical, aliases in sorted(duplicate_groups.items()):
        findings.append(f"  canonical={canonical} aliases={list(aliases)}")

    group_sizes = sum(len(aliases) + 1 for aliases in duplicate_groups.values())
    expected_unique = len(stubs) - (group_sizes - len(duplicate_groups))
    findings.append(
        f"unique = stubs ({len(stubs)}) - sum(group-1) = {expected_unique}; "
        f"unique content ids observed = {outcome.unique_content_id_count}"
    )
    if expected_unique != outcome.unique_content_id_count:
        passed = False

    return GateResult("G3 identity", passed, findings)


def _gate_g4(outcome: BuildOutcome) -> GateResult:
    findings: list[str] = []
    passed = True
    for question in outcome.questions:
        if question.item_type == "mcq" and len(question.answer_options) != 4:
            passed = False
            findings.append(
                f"{question.question_id}: mcq has {len(question.answer_options)} options, "
                "expected 4"
            )
        if question.item_type == "spr":
            if not question.correct_answers:
                passed = False
                findings.append(f"{question.question_id}: spr has no keys")
            for key in question.correct_answers:
                if parse_numeric(key) is None:
                    passed = False
                    findings.append(
                        f"{question.question_id}: spr key {key!r} does not parse as numeric"
                    )
    findings.append(
        f"{sum(1 for q in outcome.questions if q.item_type == 'mcq')} mcq, "
        f"{sum(1 for q in outcome.questions if q.item_type == 'spr')} spr"
    )
    return GateResult("G4 keys", passed, findings)


def _gate_g6(outcome: BuildOutcome, taxonomy: Taxonomy) -> GateResult:
    bank_triples = {(q.module, q.domain_cd, q.skill_cd) for q in outcome.questions}
    taxonomy_triples = taxonomy.skill_triples()
    missing_from_taxonomy = bank_triples - taxonomy_triples
    findings: list[str] = []
    passed = not missing_from_taxonomy
    if missing_from_taxonomy:
        findings.append(
            f"{len(missing_from_taxonomy)} bank triple(s) not in taxonomy.yaml: "
            f"{sorted(missing_from_taxonomy)[:10]}"
        )
    findings.append(f"bank triples={len(bank_triples)} taxonomy triples={len(taxonomy_triples)}")
    return GateResult("G6 taxonomy", passed, findings)


def _gate_g7(
    raw: RawBank, outcome: BuildOutcome, liprep_bluebook_ids: frozenset[str]
) -> GateResult:
    stubs_99 = raw.primary_stubs[(99, 1)] + raw.primary_stubs[(99, 2)]
    stub_by_qid = {str(s["questionId"]): s for s in stubs_99}
    external_id_by_qid = {
        qid: s["external_id"]
        for qid, s in stub_by_qid.items()
        if isinstance(s.get("external_id"), str) and s["external_id"].strip()
    }
    stub_external_ids = set(external_id_by_qid.values())

    e4_live_no_stub = sorted(raw.live_external_ids - stub_external_ids)
    e4_live_stub_matched = raw.live_external_ids & stub_external_ids

    liprep_ids_off_live = sorted(
        qid
        for qid in liprep_bluebook_ids
        if qid in external_id_by_qid and external_id_by_qid[qid] not in raw.live_external_ids
    )
    qid_by_external_id = {v: k for k, v in external_id_by_qid.items()}
    live_matched_not_in_liprep = sorted(
        external_id
        for external_id in e4_live_stub_matched
        if qid_by_external_id.get(external_id) not in liprep_bluebook_ids
    )

    disclosed_flagged = [
        q.question_id for q in outcome.questions if q.source == "disclosed" and q.in_bluebook
    ]

    findings = [
        f"E4-live external_ids with no matching stub: "
        f"{len(e4_live_no_stub)} {e4_live_no_stub[:10]}",
        f"liprep bluebook questionIds whose stub is not E4-live: "
        f"{len(liprep_ids_off_live)} {liprep_ids_off_live[:10]}",
        f"E4-live, stub-matched external_ids absent from liprep's list: "
        f"{len(live_matched_not_in_liprep)} {live_matched_not_in_liprep[:10]}",
    ]
    passed = not disclosed_flagged
    if disclosed_flagged:
        findings.append(
            f"{len(disclosed_flagged)} disclosed item(s) incorrectly flagged in_bluebook: "
            f"{disclosed_flagged[:10]}"
        )
    return GateResult("G7 bluebook", passed, findings)


def _gate_g8(previous_manifest: Mapping[str, Any] | None, outcome: BuildOutcome) -> GateResult:
    if previous_manifest is None:
        return GateResult("G8 drift", True, ["first build -- no previous manifest to diff against"])
    previous_count = previous_manifest.get("question_count")
    findings = [f"previous question_count={previous_count}, current={len(outcome.questions)}"]
    return GateResult("G8 drift", True, findings)


def _gate_g9(harness_stamp: Mapping[str, Any] | None) -> GateResult:
    if harness_stamp is None:
        return GateResult(
            "G9 normaliser parity",
            False,
            ["tests/domain/sat/upstream/vectors/normalize.json not found"],
        )
    findings = [
        f"suite={harness_stamp.get('suite')} "
        f"upstream_commit={harness_stamp.get('upstream_commit')} "
        f"patch_sha256={harness_stamp.get('patch_sha256')} "
        f"generated_at={harness_stamp.get('generated_at')} "
        f"count={harness_stamp.get('count')}",
        "asserted by tests/domain/sat/test_normalize.py -- see DIFFERENCES.md for scope",
    ]
    return GateResult("G9 normaliser parity", True, findings)


def _gate_g10(
    outcome: BuildOutcome,
    spr_keys: Mapping[str, SprKeyEntry],
    cross_check_findings: Sequence[str],
) -> GateResult:
    legacy_spr_ids = [
        q.question_id
        for q in outcome.questions
        if q.source == "disclosed" and q.item_type == "spr"
    ]
    unconfirmed = [qid for qid in legacy_spr_ids if qid not in spr_keys]
    findings = [
        f"{len(legacy_spr_ids)} legacy disclosed spr item(s), all confirmed"
        if not unconfirmed
        else f"{len(unconfirmed)} unconfirmed legacy spr key(s): {unconfirmed[:10]}",
        f"{len(cross_check_findings)} G10 cross-check finding(s) "
        f"(qbank spr rationale vs. official key)",
        *[f"  {line}" for line in cross_check_findings],
    ]
    passed = not unconfirmed
    return GateResult("G10 spr", passed, findings)


def compute_gates(
    raw: RawBank,
    outcome: BuildOutcome,
    *,
    taxonomy: Taxonomy,
    liprep_bluebook_ids: frozenset[str],
    spr_keys: Mapping[str, SprKeyEntry],
    cross_check_findings: Sequence[str],
    previous_manifest: Mapping[str, Any] | None,
    harness_stamp: Mapping[str, Any] | None,
) -> list[GateResult]:
    return [
        _gate_g1(raw, outcome),
        _gate_g2(raw),
        _gate_g3(raw, outcome),
        _gate_g4(outcome),
        _gate_g6(outcome, taxonomy),
        _gate_g7(raw, outcome, liprep_bluebook_ids),
        _gate_g8(previous_manifest, outcome),
        _gate_g9(harness_stamp),
        _gate_g10(outcome, spr_keys, cross_check_findings),
    ]


def _bank_counts(outcome: BuildOutcome) -> dict[str, Any]:
    return {
        "total": len(outcome.questions),
        "qbank": sum(1 for q in outcome.questions if q.source == "qbank"),
        "disclosed": sum(1 for q in outcome.questions if q.source == "disclosed"),
        "mcq": sum(1 for q in outcome.questions if q.item_type == "mcq"),
        "spr": sum(1 for q in outcome.questions if q.item_type == "spr"),
        "reading": sum(1 for q in outcome.questions if q.module == "reading"),
        "math": sum(1 for q in outcome.questions if q.module == "math"),
        "in_bluebook": sum(1 for q in outcome.questions if q.in_bluebook),
        "aliases": sum(len(a) for a in outcome.aliases.values()),
    }


def build_manifest(
    *,
    outcome: BuildOutcome,
    bank_sha256: str,
    raw_archive_sha256: str,
    fetched_at: str,
    robots_outcomes: Sequence[Mapping[str, Any]],
    harness_stamp: Mapping[str, Any] | None,
) -> dict[str, Any]:
    return {
        "content_sha256": bank_sha256,
        "question_count": len(outcome.questions),
        "fetched_at": fetched_at,
        "raw_archive_sha256": raw_archive_sha256,
        "counts": _bank_counts(outcome),
        "endpoints": list(AUDIT_ENDPOINTS),
        "robots": list(robots_outcomes),
        "upstream_pin": {
            "commit": harness_stamp.get("upstream_commit") if harness_stamp else None,
            "patch_sha256": harness_stamp.get("patch_sha256") if harness_stamp else None,
        },
    }


def _render_g5_section(g5_report: Mapping[str, Any] | None) -> str:
    """G5 (the real-renderer DOMPurify pass, `npm run sat:audit-html`) runs
    under jsdom, not this process -- so its result is recorded, not computed,
    from the JSON report that command writes (plan §3.6, §8.3's runtime
    figure). Absent, it's still pending.

    A student-facing honesty artifact, not a scorecard (2026-09-20 G5
    audit): when the report carries `reviewedIgnoredCount` (fields
    DOMPurify *did* remove something from, but a reviewed
    `REMOVAL_IGNORE_LIST` entry in `sat-html.corpus.test.ts` explains why
    nothing a student sees is lost), that count is stated rather than
    letting a PASS silently imply nothing was ever removed. When failures
    remain, the categorised breakdown is listed by tag/attribute and field
    count so a genuine gap is legible here, not just in the JSON report."""
    if g5_report is None:
        return "### G5 render: PENDING (run `npm run sat:audit-html`)"
    failure_count = g5_report.get("failureCount", 1)
    status = "PASS" if failure_count == 0 else "FAIL"
    duration_s = g5_report.get("durationMs", 0) / 1000
    lines = [
        f"### G5 render: {status}\n",
        f"- fields checked: {g5_report.get('fieldsChecked')}",
        f"- failures: {failure_count}",
        f"- measured wall-clock: {duration_s:.1f}s (budget: 2-5 min, plan §8.3)",
    ]
    reviewed_ignored = g5_report.get("reviewedIgnoredCount")
    if reviewed_ignored:
        lines.append(
            f"- reviewed exceptions (removed something, documented as safe in "
            f"`REMOVAL_IGNORE_LIST`): {reviewed_ignored}"
        )
    if failure_count:
        lines.append("")
        lines.append(
            "**Unresolved -- a real gap, not a scorecard.** Categorised breakdown "
            "of what DOMPurify or the figure-style rewrite removed, by distinct "
            "tag/attribute:"
        )
        for entry in g5_report.get("categorySummary") or []:
            sample_ids = ", ".join(entry.get("sampleQuestionIds", []))
            lines.append(
                f"  - {entry.get('kind')} `{entry.get('name')}`: "
                f"{entry.get('instanceCount')} instance(s) across "
                f"{entry.get('fieldCount')} field(s) -- e.g. {sample_ids}"
            )
    return "\n".join(lines)


def render_audit_md(
    *,
    gates: Sequence[GateResult],
    manifest: dict[str, Any],
    spr_adjudication_note: str,
    failures: Sequence[BuildFailure] = (),
    extra_sections: Sequence[str] = (),
    g5_report: Mapping[str, Any] | None = None,
) -> str:
    lines: list[str] = ["# SAT question bank audit", ""]
    lines.append(f"Generated {datetime.now(UTC).isoformat()}.")
    lines.append("")
    lines.append("## Counts")
    lines.append("")
    for key, value in manifest["counts"].items():
        lines.append(f"- {key}: {value}")
    lines.append(f"- bank sha256: {manifest['content_sha256']}")
    lines.append(f"- raw archive sha256: {manifest['raw_archive_sha256']}")
    lines.append("")
    lines.append("## Robots outcomes")
    lines.append("")
    for outcome in manifest["robots"]:
        lines.append(
            f"- {outcome.get('host')}: status={outcome.get('status_code')} "
            f"decision={outcome.get('decision')}"
        )
    lines.append("")
    lines.append("## Gates")
    lines.append("")
    for gate in gates:
        status = "PASS" if gate.passed else "FAIL"
        lines.append(f"### {gate.name}: {status}")
        lines.append("")
        for finding in gate.findings:
            lines.append(f"- {finding}")
        lines.append("")
    if failures:
        lines.append("## Failures")
        lines.append("")
        lines.append(f"{len(failures)} build failure(s) (G1 coverage):")
        lines.append("")
        for failure in sorted(failures, key=lambda f: f.question_id):
            lines.append(f"- {failure.question_id}: {failure.reason}")
        lines.append("")
        no_answer_field = [
            f for f in failures if _DISCLOSED_MCQ_NO_ANSWER_FIELD_RE.match(f.reason)
        ]
        if no_answer_field:
            lines.append(
                f"{len(no_answer_field)} of the above are legacy disclosed items whose "
                "`answer` object carries none of `correct_choice` / `correct_answer` / "
                "`correctChoice` -- verified against the raw E3 response, not a build bug: "
                "the correct option is stated only in the rationale's prose (e.g. \"Choice "
                "C is correct.\"). This is a genuine upstream data gap in the structured "
                "field. There is currently no reviewed-override path for a disclosed mcq "
                "answer (unlike `reviewed_spr_keys` for legacy disclosed spr, plan §3.5); "
                "closing this gate requires a `domain/sat/normalize.py` change, which is "
                "outside this module's scope and is not made here."
            )
            lines.append("")
    lines.append(_render_g5_section(g5_report))
    lines.append("")
    lines.append("## SPR key adjudication")
    lines.append("")
    lines.append(spr_adjudication_note)
    lines.append("")
    for section in extra_sections:
        lines.append(section)
        lines.append("")
    return "\n".join(lines)


def run_audit(
    raw: RawBank,
    outcome: BuildOutcome,
    *,
    taxonomy: Taxonomy,
    liprep_bluebook_ids: frozenset[str],
    spr_keys: Mapping[str, SprKeyEntry],
    cross_check_findings: Sequence[str],
    bank_sha256: str,
    raw_archive_sha256: str,
    manifest_path: Path,
    audit_md_path: Path,
    spr_adjudication_note: str,
    previous_manifest: Mapping[str, Any] | None = None,
    harness_stamp: Mapping[str, Any] | None = None,
    extra_sections: Sequence[str] = (),
    g5_report_path: Path | None = None,
) -> bool:
    """Computes every gate, writes `MANIFEST.json` + `AUDIT.md`, and returns
    whether every executable gate passed. G5 is never part of that return
    value -- it runs separately under jsdom (`npm run sat:audit-html`) -- but
    when `g5_report_path` names an existing report from that command, its
    result is read and recorded in `AUDIT.md` instead of "pending"."""
    g5_report: Mapping[str, Any] | None = None
    if g5_report_path is not None and g5_report_path.exists():
        g5_report = json.loads(g5_report_path.read_text(encoding="utf-8"))
    gates = compute_gates(
        raw,
        outcome,
        taxonomy=taxonomy,
        liprep_bluebook_ids=liprep_bluebook_ids,
        spr_keys=spr_keys,
        cross_check_findings=cross_check_findings,
        previous_manifest=previous_manifest,
        harness_stamp=harness_stamp,
    )
    manifest = build_manifest(
        outcome=outcome,
        bank_sha256=bank_sha256,
        raw_archive_sha256=raw_archive_sha256,
        fetched_at=raw.run_summary.get("started_at", ""),
        robots_outcomes=raw.robots_outcomes,
        harness_stamp=harness_stamp,
    )
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8"
    )
    audit_md_path.write_text(
        render_audit_md(
            gates=gates,
            manifest=manifest,
            spr_adjudication_note=spr_adjudication_note,
            failures=outcome.failures,
            extra_sections=extra_sections,
            g5_report=g5_report,
        ),
        encoding="utf-8",
    )
    return all(gate.passed for gate in gates)
