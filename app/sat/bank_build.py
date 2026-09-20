"""`python -m app.sat build` — raw run dir -> `deploy/seed/sat/bank.jsonl.gz`
(plan plans/sat-practice/plan.md §3.2 "build", §3.3, §3.6 G1/G3).

Pure and deterministic: no network, no npm call. Reads a `fetch`-produced
raw run directory (`artifacts/sat-practice/raw/<run>/`), groups stubs by
content id, resolves duplicates to one canonical question + aliases (§3.3),
calls `domain/sat/normalize.py` for each, and writes the bank file plus the
lossless raw archive. Gate computation and `MANIFEST.json`/`AUDIT.md` live
in `app/sat/bank_audit.py` — this module only produces the bank and the
raw archive, and the `RawBank` snapshot audit reads gates from.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import tarfile
from collections import defaultdict
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from domain.sat.grading import is_correct
from domain.sat.normalize import (
    NormalizeError,
    choose_canonical,
    normalize_disclosed,
    normalize_qbank,
)
from domain.sat.spr_answers import cross_check, extract_spr_candidates
from domain.sat.types import SatQuestion

__all__ = [
    "MAX_BANK_BYTES",
    "BuildFailure",
    "BuildOutcome",
    "RawBank",
    "SprKeyEntry",
    "bank_line",
    "export_liprep_json",
    "load_raw_bank",
    "load_spr_keys",
    "qbank_spr_cross_check",
    "run_build",
    "write_bank_file",
    "write_raw_archive",
]

# plan §3.2: "A bank > 25 MB stops the build and asks." Not a settings knob
# (§9 R7): it's a plan-stated stop threshold, not something an operator
# tunes independently of the plan itself.
MAX_BANK_BYTES = 25 * 1024 * 1024

_GZIP_MTIME = 0
_TAR_MTIME = 0


@dataclass(frozen=True)
class SprKeyEntry:
    """One `config/assets/sat/spr_keys.yaml` entry (plan §3.5)."""

    keys: tuple[str, ...]
    source: str  # "rationale" | "manual" | "added"
    note: str | None = None


def load_spr_keys(raw: Mapping[str, Any]) -> dict[str, SprKeyEntry]:
    """Parses the loaded `spr_keys.yaml` mapping into `SprKeyEntry` values,
    keyed by the canonical `question_id` a duplicate group resolves to
    (§3.3's `choose_canonical`; §3.5's adjudication)."""
    entries: dict[str, SprKeyEntry] = {}
    for question_id, value in raw.items():
        if not isinstance(value, Mapping):
            raise ValueError(f"spr_keys.yaml entry for {question_id!r} is not a mapping")
        keys_value = value.get("keys")
        if not isinstance(keys_value, Sequence) or isinstance(keys_value, str) or not keys_value:
            raise ValueError(f"spr_keys.yaml entry for {question_id!r} has no keys")
        entries[question_id] = SprKeyEntry(
            keys=tuple(str(k) for k in keys_value),
            source=str(value.get("source", "")),
            note=(str(value["note"]) if value.get("note") is not None else None),
        )
    return entries


@dataclass(frozen=True)
class RawBank:
    """Everything `load_raw_bank` reads out of a `fetch` run directory that
    `run_build` and `app/sat/bank_audit.py`'s gates both need — parsed once,
    shared, never re-read from disk twice."""

    run_dir: Path
    primary_stubs: dict[tuple[int, int], list[dict[str, Any]]]  # (assessment, test) -> stubs
    superset_stubs: dict[tuple[int, int], list[dict[str, Any]]]
    live_external_ids: frozenset[str]
    robots_outcomes: list[dict[str, Any]]
    run_summary: dict[str, Any]


def _read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_raw_bank(run_dir: Path) -> RawBank:
    """Loads every list-level file a `fetch` run wrote (plan §3.2's
    layout) -- never the per-question `detail`/`disclosed` files, which
    `run_build` reads lazily per content id."""
    primary = {
        (99, 1): _read_json(run_dir / "list" / "asmt99_test1.json"),
        (99, 2): _read_json(run_dir / "list" / "asmt99_test2.json"),
    }
    superset = {
        (assessment, test): _read_json(run_dir / "list" / f"asmt{assessment}_test{test}.json")
        for assessment in (100, 102)
        for test in (1, 2)
    }
    lookup = _read_json(run_dir / "lookup.json")
    live_external_ids = frozenset(
        [*lookup.get("mathLiveItems", []), *lookup.get("readingLiveItems", [])]
    )
    robots_path = run_dir / "robots.json"
    robots_outcomes = _read_json(robots_path) if robots_path.exists() else []
    run_summary = _read_json(run_dir / "run.json")
    return RawBank(
        run_dir=run_dir,
        primary_stubs=primary,
        superset_stubs=superset,
        live_external_ids=live_external_ids,
        robots_outcomes=robots_outcomes,
        run_summary=run_summary,
    )


def _content_key(stub: Mapping[str, Any]) -> str | None:
    """§3.1: `external_id`/`ibn` arrive as `null` *or* `""` for the absent
    one; both normalise to `None`. Returns `None` when neither is set --
    the caller records that as a build failure rather than raising, so one
    malformed stub doesn't abort the whole grouping pass."""
    external_id = stub.get("external_id")
    if isinstance(external_id, str) and external_id.strip():
        return external_id.strip()
    ibn = stub.get("ibn")
    if isinstance(ibn, str) and ibn.strip():
        return ibn.strip()
    return None


def _group_by_content_id(
    stub_lists: Sequence[list[dict[str, Any]]],
) -> tuple[dict[str, list[dict[str, Any]]], list[dict[str, str]]]:
    """Groups every assessment-99 stub by content id (§3.3 "Duplicates").
    A stub with neither id is reported as a failure, never silently
    dropped (house rules)."""
    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    failures: list[dict[str, str]] = []
    for stubs in stub_lists:
        for stub in stubs:
            key = _content_key(stub)
            question_id = str(stub.get("questionId") or "<unknown>")
            if key is None:
                failures.append(
                    {
                        "question_id": question_id,
                        "reason": "stub has neither external_id nor ibn",
                    }
                )
                continue
            groups[key].append(stub)
    return groups, failures


@dataclass(frozen=True)
class BuildFailure:
    question_id: str
    reason: str


@dataclass
class BuildOutcome:
    questions: list[SatQuestion] = field(default_factory=list)
    aliases: dict[str, tuple[str, ...]] = field(default_factory=dict)
    failures: list[BuildFailure] = field(default_factory=list)
    stub_count: int = 0
    unique_content_id_count: int = 0

    @property
    def ok(self) -> bool:
        return not self.failures


def _load_disclosed_item(path: Path, *, question_id: str) -> Mapping[str, Any]:
    """G1: an E3 response must be a single-element array -- upstream reads
    `[0]` and discards the rest, so a longer response would be content
    silently lost. Raises `NormalizeError` naming the id (§3.6 G1) rather
    than the domain layer, since this is a build-level shape gate, not a
    normalisation decision."""
    raw = _read_json(path)
    if not isinstance(raw, list) or len(raw) != 1:
        raise NormalizeError(
            question_id,
            f"E3 response for {path.name} is not a single-element array "
            f"(got {len(raw) if isinstance(raw, list) else type(raw).__name__})",
        )
    item = raw[0]
    if not isinstance(item, Mapping):
        raise NormalizeError(
            question_id, f"E3 response for {path.name}'s single element is not an object"
        )
    return item


def _normalize_group(
    content_id: str,
    stubs: list[dict[str, Any]],
    *,
    raw: RawBank,
    spr_keys: Mapping[str, SprKeyEntry],
    liprep_bluebook_ids: frozenset[str],
) -> tuple[SatQuestion, tuple[str, ...]]:
    """One content-id group -> the canonical `SatQuestion` + its alias
    question ids (§3.3). Raises `NormalizeError` naming the canonical id on
    any reject; the caller collects these as build failures."""
    question_ids = [str(s["questionId"]) for s in stubs]
    canonical_id, aliases = choose_canonical(question_ids, liprep_bluebook_ids)
    canonical_stub = next(s for s in stubs if str(s["questionId"]) == canonical_id)
    spr_entry = spr_keys.get(canonical_id)

    is_qbank = any(
        isinstance(s.get("external_id"), str) and s["external_id"].strip() for s in stubs
    )
    if is_qbank:
        detail = _read_json(raw.run_dir / "detail" / f"{content_id}.json")
        spr_additions = spr_entry.keys if spr_entry and spr_entry.source == "added" else ()
        question = normalize_qbank(
            canonical_stub,
            detail,
            live_external_ids=raw.live_external_ids,
            spr_additions=spr_additions,
        )
    else:
        item = _load_disclosed_item(
            raw.run_dir / "disclosed" / f"{content_id}.json", question_id=canonical_id
        )
        reviewed = (
            spr_entry.keys if spr_entry and spr_entry.source in ("rationale", "manual") else None
        )
        question = normalize_disclosed(canonical_stub, item, reviewed_spr_keys=reviewed)

    return question, aliases


def run_build(
    raw: RawBank,
    *,
    spr_keys: Mapping[str, SprKeyEntry],
    liprep_bluebook_ids: frozenset[str],
) -> BuildOutcome:
    """Raw stub/detail/disclosed data -> the full set of `SatQuestion`s plus
    alias groups (plan §3.3). Every reject is collected as a `BuildFailure`
    naming the id, never raised immediately -- one bad id must not hide
    every other failure in the same run (house rules, plan §3.3 "nothing is
    dropped silently")."""
    stub_lists = [raw.primary_stubs[(99, 1)], raw.primary_stubs[(99, 2)]]
    groups, ungrouped_failures = _group_by_content_id(stub_lists)

    outcome = BuildOutcome(
        stub_count=sum(len(stubs) for stubs in stub_lists),
        unique_content_id_count=len(groups),
    )
    outcome.failures.extend(BuildFailure(f["question_id"], f["reason"]) for f in ungrouped_failures)

    for content_id in sorted(groups):
        stubs = groups[content_id]
        try:
            question, aliases = _normalize_group(
                content_id,
                stubs,
                raw=raw,
                spr_keys=spr_keys,
                liprep_bluebook_ids=liprep_bluebook_ids,
            )
        except NormalizeError as exc:
            outcome.failures.append(BuildFailure(exc.question_id, exc.reason))
            continue
        outcome.questions.append(question)
        outcome.aliases[question.question_id] = aliases

    outcome.questions.sort(key=lambda q: q.question_id)
    return outcome


def bank_line(question: SatQuestion, aliases: Sequence[str]) -> str:
    """One `bank.jsonl.gz` line: `{"question": ..., "aliases": [...]}`,
    sorted keys, stable across runs (plan §3.2's committed-contract)."""
    payload = {
        "question": question.model_dump(mode="json"),
        "aliases": list(aliases),
    }
    return json.dumps(payload, sort_keys=True, ensure_ascii=True, separators=(",", ":"))


def write_bank_file(path: Path, outcome: BuildOutcome) -> tuple[int, str]:
    """Writes `bank.jsonl.gz`: sorted by `question_id`, fixed gzip mtime
    (plan §3.2). Returns `(size_bytes, sha256)`; raises when the file would
    exceed `MAX_BANK_BYTES` (plan: "A bank > 25 MB stops the build and
    asks.")."""
    body_lines = [
        bank_line(question, outcome.aliases.get(question.question_id, ()))
        for question in outcome.questions
    ]
    body = ("\n".join(body_lines) + "\n").encode("utf-8") if body_lines else b""

    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with gzip.GzipFile(
        filename="", mode="wb", fileobj=open(tmp_path, "wb"), mtime=_GZIP_MTIME
    ) as gz:
        gz.write(body)

    size_bytes = tmp_path.stat().st_size
    if size_bytes > MAX_BANK_BYTES:
        tmp_path.unlink()
        raise ValueError(
            f"bank.jsonl.gz would be {size_bytes} bytes, over the {MAX_BANK_BYTES} byte "
            "stop (plan §3.2) -- stopping the build"
        )
    tmp_path.replace(path)
    sha256 = hashlib.sha256(path.read_bytes()).hexdigest()
    return size_bytes, sha256


def write_raw_archive(run_dir: Path, archive_path: Path) -> str:
    """Deterministic tar.gz of the whole raw run directory (plan §3.2's
    lossless archive, never committed -- only its sha256 is). Fixed mtimes,
    sorted entry order, no uid/gid/uname metadata, so the same run directory
    always produces byte-identical archive bytes."""
    archive_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = archive_path.with_suffix(archive_path.suffix + ".tmp")

    file_paths = sorted(p for p in run_dir.rglob("*") if p.is_file())
    with gzip.GzipFile(
        filename="", mode="wb", fileobj=open(tmp_path, "wb"), mtime=_TAR_MTIME
    ) as gz, tarfile.open(fileobj=gz, mode="w") as tar:
        for file_path in file_paths:
            info = tar.gettarinfo(file_path, arcname=str(file_path.relative_to(run_dir)))
            info.mtime = _TAR_MTIME
            info.uid = 0
            info.gid = 0
            info.uname = ""
            info.gname = ""
            with file_path.open("rb") as fh:
                tar.addfile(info, fh)

    tmp_path.replace(archive_path)
    return hashlib.sha256(archive_path.read_bytes()).hexdigest()


def _make_accepts(keys: tuple[str, ...]) -> Callable[[str], bool]:
    def accepts(candidate: str) -> bool:
        return is_correct("spr", keys, candidate)

    return accepts


def qbank_spr_cross_check(outcome: BuildOutcome) -> list[str]:
    """G10: for every qbank spr question, the candidates
    `extract_spr_candidates` mines from the rationale that the grader would
    **not** already accept against the official key (plan §3.5) -- one
    human-readable finding line per question with a residue."""
    findings: list[str] = []
    for question in outcome.questions:
        if question.source != "qbank" or question.item_type != "spr":
            continue
        candidates = extract_spr_candidates(question.rationale)
        residue = cross_check(
            question.correct_answers,
            candidates,
            _make_accepts(question.correct_answers),
        )
        if residue:
            findings.append(
                f"{question.question_id}: official={list(question.correct_answers)} "
                f"residue={residue}"
            )
    return findings


_DIFFICULTY_WORDS = {"E": "Easy", "M": "Medium", "H": "Hard"}


def _liprep_question(question: SatQuestion) -> dict[str, Any]:
    """One question in liprep's own `SatQuestion` shape
    (`artifacts/sat-practice/liprep/src/types/questions.ts`) -- flat,
    `answerOptions`/`correct_answer` -- so `parseAndIngestJSON` can import
    it directly (plan §8.4: "which also proves the bank is
    liprep-importable")."""
    payload: dict[str, Any] = {
        "questionId": question.question_id,
        "primary_class_cd": question.domain_cd,
        "skill_cd": question.skill_cd,
        "score_band_range_cd": question.score_band,
        "difficulty": _DIFFICULTY_WORDS[question.difficulty],
        "module": question.module,
        "type": question.item_type,
        "stimulus": question.stimulus,
        "stem": question.stem,
        "answerOptions": [{"id": o.label, "content": o.content} for o in question.answer_options],
        "correct_answer": list(question.correct_answers),
        "rationale": question.rationale,
    }
    if question.cb_created_at is not None:
        payload["createDate"] = int(question.cb_created_at.timestamp() * 1000)
    if question.cb_updated_at is not None:
        payload["updateDate"] = int(question.cb_updated_at.timestamp() * 1000)
    return payload


def export_liprep_json(questions: Sequence[SatQuestion]) -> list[dict[str, Any]]:
    """The whole bank, in liprep's importable shape (plan §8.4). Aliases are
    not exported -- liprep's own store has no alias concept, and the
    parity pass only needs one deep-linkable id per question."""
    return [_liprep_question(question) for question in questions]
