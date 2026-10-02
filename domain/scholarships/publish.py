"""What a record must satisfy to be published (plan §4, D10, D13).

The server decides publishability with `publish_problems`; the admin editor's
checklist uses the same ids and rules as live feedback. A fixed deadline that
has already passed is not a problem here: the student page files it under
"Closed this cycle", and an admin must be able to record a recurring
scholarship before next year's date is out.
"""

from __future__ import annotations

import datetime as dt
from typing import Literal

from domain.scholarships.types import Award, Deadline, ScholarshipDraft, is_web_url

PublishCheck = Literal[
    "basics", "apply_url", "award", "rules_complete", "deadline", "source_url", "fresh"
]

#: A record not checked against its source for longer than this is stale.
#: Part of the honesty rule, not a deploy setting.
STALE_AFTER_DAYS = 180

_CHOICE_RULE_KINDS = frozenset({"citizenship", "state", "grade", "major"})


def _award_is_set(award: Award) -> bool:
    if award.kind == "fixed":
        return award.amount is not None and award.amount >= 1
    if award.kind == "range":
        return (
            award.min is not None
            and award.max is not None
            and award.max >= 1
            and award.min <= award.max
        )
    return True


def _rules_complete(draft: ScholarshipDraft) -> bool:
    return all(
        getattr(rule, "any_of", None) != []
        for rule in draft.eligibility
        if rule.kind in _CHOICE_RULE_KINDS
    )


def is_stale(last_checked_on: dt.date | None, today: dt.date) -> bool:
    """Never checked, or checked more than `STALE_AFTER_DAYS` ago."""
    return last_checked_on is None or (today - last_checked_on).days > STALE_AFTER_DAYS


def deadline_passed(deadline: Deadline, today: dt.date) -> bool:
    """A fixed deadline before today. Rolling deadlines never pass."""
    return deadline.kind == "fixed" and deadline.date is not None and deadline.date < today


def publish_problems(draft: ScholarshipDraft, today: dt.date) -> list[PublishCheck]:
    """The failing checks, in checklist order; empty means publishable."""
    checks: list[tuple[PublishCheck, bool]] = [
        ("basics", draft.name != "" and draft.sponsor != ""),
        ("apply_url", is_web_url(draft.apply_url)),
        ("award", _award_is_set(draft.award)),
        ("rules_complete", _rules_complete(draft)),
        ("deadline", draft.deadline.kind == "rolling" or draft.deadline.date is not None),
        ("source_url", is_web_url(draft.source_url)),
        ("fresh", not is_stale(draft.last_checked_on, today)),
    ]
    return [check for check, ok in checks if not ok]


__all__ = [
    "STALE_AFTER_DAYS",
    "PublishCheck",
    "deadline_passed",
    "is_stale",
    "publish_problems",
]
