"""Validate a scholarship research batch (or the merged file) against the record model.

    uv run python plans/scholarship-seed/validate.py plans/scholarship-seed/batch-1.json
"""

from __future__ import annotations

import datetime as dt
import json
import sys
from pathlib import Path

from pydantic import ValidationError

from domain.scholarships.publish import publish_problems
from domain.scholarships.types import ScholarshipDraft

TODAY = dt.date(2026, 10, 2)

ENTRY_KEYS = {"row", "outcome", "skip_reason", "notes", "record"}


def check(path: Path, publishable: bool) -> list[str]:
    errors: list[str] = []
    entries = json.loads(path.read_text())
    if not isinstance(entries, list):
        return ["top level must be a JSON array"]
    for i, entry in enumerate(entries):
        where = f"entry {i} (row {entry.get('row')})"
        if set(entry) != ENTRY_KEYS:
            errors.append(f"{where}: keys must be exactly {sorted(ENTRY_KEYS)}")
            continue
        if entry["outcome"] == "skip":
            if entry["record"] is not None or not entry["skip_reason"]:
                errors.append(f"{where}: a skip has record null and a skip_reason")
            continue
        if entry["outcome"] != "record":
            errors.append(f"{where}: outcome must be 'record' or 'skip'")
            continue
        try:
            draft = ScholarshipDraft.model_validate(entry["record"])
        except ValidationError as exc:
            errors.append(f"{where}: {exc}")
            continue
        if not draft.name or not draft.sponsor or not draft.source_url:
            errors.append(f"{where}: name, sponsor and source_url are required")
        if publishable and (problems := publish_problems(draft, TODAY)):
            errors.append(f"{where}: not publishable, failing checks {problems}")
    return errors


def main(argv: list[str]) -> int:
    publishable = "--publishable" in argv
    failed = False
    for arg in [a for a in argv if a != "--publishable"]:
        errors = check(Path(arg), publishable)
        for error in errors:
            print(error)
        failed = failed or bool(errors)
    print("FAILED" if failed else "OK")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
