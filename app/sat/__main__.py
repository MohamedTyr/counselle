"""`python -m app.sat` — the SAT practice bank pipeline CLI (plan
plans/sat-practice/plan.md §3.2).

    python -m app.sat fetch [--run <name>] [--root <dir>]
    python -m app.sat build --run-dir <dir> [--bank <path>]
    python -m app.sat audit --run-dir <dir> [--bank <path>]
    python -m app.sat bank-sync
    python -m app.sat export-liprep-json --bank <path> --out <path>

Subparsers so each stage of the pipeline is one `add_parser(...)` block
dispatching to its own function -- no shared argument-parsing to fight.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import sys
from collections.abc import Callable, Coroutine
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, cast

from app.sat.fetch import run_fetch
from config.settings import get_settings, load_yaml_asset

logger = logging.getLogger(__name__)

#: Default root for `fetch`'s output (plan §3.2) -- gitignored, lossless.
_DEFAULT_FETCH_ROOT = Path("artifacts/sat-practice/raw")
_DEFAULT_BANK_PATH = Path("deploy/seed/sat/bank.jsonl.gz")
_DEFAULT_RAW_ARCHIVE_DIR = Path("artifacts/sat-practice")
_MANIFEST_PATH = Path("deploy/seed/sat/MANIFEST.json")
_AUDIT_MD_PATH = Path("deploy/seed/sat/AUDIT.md")
_G5_REPORT_PATH = Path("artifacts/sat-practice/g5-report.json")
_BLUEBOOK_IDS_PATH = Path("config/assets/sat/bluebook_ids.json")
_HARNESS_STAMP_PATH = Path("tests/domain/sat/upstream/vectors/normalize.json")


def _default_run_name() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


async def _run_fetch_command(args: argparse.Namespace) -> int:
    run_dir = Path(args.root) / (args.run or _default_run_name())
    settings = get_settings()
    summary = await run_fetch(settings, run_dir)
    print(f"run: {run_dir}")
    print(
        f"stubs={summary.stub_count} unique_content_ids={summary.unique_content_ids} "
        f"fetched={summary.details_fetched} skipped={summary.details_skipped} "
        f"failed={summary.details_failed}"
    )
    if not summary.ok:
        print(
            f"FAILED: {len(summary.failures)} detail(s) failed, see {run_dir / 'failures.json'}",
            file=sys.stderr,
        )
        return 1
    return 0


def _load_spr_keys_asset() -> dict[str, Any]:
    from app.sat.bank_build import load_spr_keys

    return load_spr_keys(load_yaml_asset("sat/spr_keys") or {})


def _load_bluebook_ids() -> frozenset[str]:
    with _BLUEBOOK_IDS_PATH.open(encoding="utf-8") as handle:
        return frozenset(json.load(handle))


def _load_harness_stamp() -> dict[str, Any] | None:
    if not _HARNESS_STAMP_PATH.exists():
        return None
    with _HARNESS_STAMP_PATH.open(encoding="utf-8") as handle:
        return cast("dict[str, Any]", json.load(handle))


def _load_previous_manifest() -> dict[str, Any] | None:
    if not _MANIFEST_PATH.exists():
        return None
    with _MANIFEST_PATH.open(encoding="utf-8") as handle:
        return cast("dict[str, Any]", json.load(handle))


def _run_build_or_audit(run_dir: Path, bank_path: Path) -> int:
    """Shared by `build` and `audit` (plan §3.2: "`audit`, run by `build`")
    -- both derive the same deterministic outcome from the raw run dir and
    write `bank.jsonl.gz` + the raw archive + `MANIFEST.json`/`AUDIT.md`.
    `audit` is `build` invoked directly, for re-running the gates without
    re-fetching, per the plan's own pipeline diagram."""
    from app.sat.bank_audit import run_audit
    from app.sat.bank_build import (
        load_raw_bank,
        qbank_spr_cross_check,
        run_build,
        write_bank_file,
        write_raw_archive,
    )
    from domain.sat.taxonomy import Taxonomy

    raw = load_raw_bank(run_dir)
    spr_keys = _load_spr_keys_asset()
    bluebook_ids = _load_bluebook_ids()
    taxonomy = Taxonomy.model_validate(load_yaml_asset("sat/taxonomy"))

    outcome = run_build(raw, spr_keys=spr_keys, liprep_bluebook_ids=bluebook_ids)
    _, bank_sha256 = write_bank_file(bank_path, outcome)

    tmp_archive = _DEFAULT_RAW_ARCHIVE_DIR / "raw.tmp.tar.gz"
    raw_archive_sha256 = write_raw_archive(run_dir, tmp_archive)
    final_archive = _DEFAULT_RAW_ARCHIVE_DIR / f"raw-{raw_archive_sha256}.tar.gz"
    tmp_archive.replace(final_archive)

    cross_check_findings = qbank_spr_cross_check(outcome)
    ok = run_audit(
        raw,
        outcome,
        taxonomy=taxonomy,
        liprep_bluebook_ids=bluebook_ids,
        spr_keys=spr_keys,
        cross_check_findings=cross_check_findings,
        bank_sha256=bank_sha256,
        raw_archive_sha256=raw_archive_sha256,
        manifest_path=_MANIFEST_PATH,
        audit_md_path=_AUDIT_MD_PATH,
        spr_adjudication_note=(
            "Keys adjudicated by an AI agent on 2026-09-19; owner spot-check pending (R11)."
        ),
        previous_manifest=_load_previous_manifest(),
        harness_stamp=_load_harness_stamp(),
        g5_report_path=_G5_REPORT_PATH,
    )

    print(f"questions={len(outcome.questions)} failures={len(outcome.failures)}")
    for failure in outcome.failures:
        print(f"  FAIL {failure.question_id}: {failure.reason}", file=sys.stderr)
    print(f"bank: {bank_path} sha256={bank_sha256}")
    print(f"raw archive: {final_archive}")
    print(f"manifest: {_MANIFEST_PATH}")
    print(f"audit: {_AUDIT_MD_PATH}")
    if not ok:
        print("FAILED: one or more audit gates did not pass, see AUDIT.md", file=sys.stderr)
        return 1
    return 0


async def _run_build_command(args: argparse.Namespace) -> int:
    return _run_build_or_audit(Path(args.run_dir), Path(args.bank))


async def _run_audit_command(args: argparse.Namespace) -> int:
    return _run_build_or_audit(Path(args.run_dir), Path(args.bank))


async def _run_bank_sync_command(args: argparse.Namespace) -> int:
    from app.sat.bank_sync import run_bank_sync

    settings = get_settings()
    return await run_bank_sync(settings)


async def _run_export_liprep_json_command(args: argparse.Namespace) -> int:
    from app.sat.bank_build import export_liprep_json
    from domain.sat.types import SatQuestion

    bank_path = Path(args.bank)
    questions: list[SatQuestion] = []
    import gzip as gzip_module

    with gzip_module.open(bank_path, "rt", encoding="utf-8") as handle:
        for line in handle:
            row = json.loads(line)
            questions.append(SatQuestion.model_validate(row["question"]))

    payload = export_liprep_json(questions)
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(f"exported {len(payload)} question(s) to {out_path}")
    return 0


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="python -m app.sat")
    subparsers = parser.add_subparsers(dest="command", required=True)

    fetch_parser = subparsers.add_parser("fetch", help="download the raw question bank")
    fetch_parser.add_argument("--run", default=None, help="run name (default: UTC timestamp)")
    fetch_parser.add_argument("--root", default=str(_DEFAULT_FETCH_ROOT), help="output root dir")
    fetch_parser.set_defaults(handler=_run_fetch_command)

    build_parser = subparsers.add_parser("build", help="raw run dir -> bank.jsonl.gz + audit")
    build_parser.add_argument("--run-dir", required=True, help="a `fetch` run directory")
    build_parser.add_argument("--bank", default=str(_DEFAULT_BANK_PATH), help="bank.jsonl.gz path")
    build_parser.set_defaults(handler=_run_build_command)

    audit_parser = subparsers.add_parser("audit", help="re-run the audit gates (run by `build`)")
    audit_parser.add_argument("--run-dir", required=True, help="a `fetch` run directory")
    audit_parser.add_argument("--bank", default=str(_DEFAULT_BANK_PATH), help="bank.jsonl.gz path")
    audit_parser.set_defaults(handler=_run_audit_command)

    bank_sync_parser = subparsers.add_parser(
        "bank-sync", help="sync bank.jsonl.gz into counselle.*"
    )
    bank_sync_parser.set_defaults(handler=_run_bank_sync_command)

    export_parser = subparsers.add_parser(
        "export-liprep-json", help="bank.jsonl.gz -> liprep-importable JSON (plan §8.4)"
    )
    export_parser.add_argument("--bank", default=str(_DEFAULT_BANK_PATH), help="bank.jsonl.gz path")
    export_parser.add_argument("--out", required=True, help="output JSON path")
    export_parser.set_defaults(handler=_run_export_liprep_json_command)

    return parser


def main(argv: list[str] | None = None) -> int:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    parser = _build_parser()
    args = parser.parse_args(argv)
    handler = cast("Callable[[argparse.Namespace], Coroutine[Any, Any, int]]", args.handler)
    return asyncio.run(handler(args))


if __name__ == "__main__":
    raise SystemExit(main())
