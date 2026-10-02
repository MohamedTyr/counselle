"""Scholarship value models (plan §4).

Pure stdlib + pydantic (ADR 0017). These are the editable shape of a record,
shared by `app/scholarships/` and the agent tool. Every string is trimmed and
every list de-duplicated; a violation is a 422 at the API edge whether the
record is a draft or published.

Only criteria the student profile can answer are structured rules. Anything
else, including ethnicity, gender or religion restrictions, goes in
`other_eligibility` as text and is never matched (owner decision D4).
"""

from __future__ import annotations

import datetime as dt
import re
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    StringConstraints,
    model_validator,
)

AwardKind = Literal["fixed", "range", "varies", "full_tuition", "full_ride"]
DeadlineKind = Literal["fixed", "rolling"]
Basis = Literal["merit", "need"]
CitizenshipOption = Literal["us_citizen", "permanent_resident", "daca", "international"]
GradeOption = Literal["9", "10", "11", "12"]
ScholarshipStatus = Literal["draft", "published", "archived"]

#: The 50 states plus DC, as USPS codes. The frontend's `us-states.ts` holds
#: the same set with display names.
US_STATE_CODES: tuple[str, ...] = (
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "DC", "FL", "GA", "HI", "ID",
    "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO",
    "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA",
    "RI", "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
)  # fmt: skip

MAX_AWARD_DOLLARS = 10_000_000
MAX_RENEWAL_YEARS = 8
MAX_URL_CHARS = 2048
MAX_RULES = 7
MAX_AWARDS_COUNT = 1_000_000

# An http(s) URL with a host and no whitespace. Links are rendered into
# `href`/`src` for every student, so this is the guard against
# `javascript:`/`data:` URLs. The editor checklist uses the same pattern.
_WEB_URL = re.compile(r"https?://[^\s/?#]+[^\s]*", re.IGNORECASE)


def is_web_url(value: str) -> bool:
    return _WEB_URL.fullmatch(value) is not None


def _url_or_blank(value: str) -> str:
    if value and not is_web_url(value):
        raise ValueError("must be blank or an http(s) web address")
    return value


def _dedupe[T](items: list[T]) -> list[T]:
    seen: list[T] = []
    for item in items:
        if item not in seen and item != "":
            seen.append(item)
    return seen


def _known_state(code: str) -> str:
    upper = code.upper()
    if upper not in US_STATE_CODES:
        raise ValueError(f"unknown state code {code!r}")
    return upper


def _trimmed(max_length: int) -> StringConstraints:
    # No NUL: Postgres text cannot store it.
    return StringConstraints(strip_whitespace=True, max_length=max_length, pattern=r"^[^\x00]*$")


Name = Annotated[str, _trimmed(200)]
Summary = Annotated[str, _trimmed(200)]
ShortItem = Annotated[str, _trimmed(100)]
OtherLine = Annotated[str, _trimmed(300)]
Prompt = Annotated[str, _trimmed(1000)]
WebUrl = Annotated[str, _trimmed(MAX_URL_CHARS), AfterValidator(_url_or_blank)]
StateCode = Annotated[str, StringConstraints(strip_whitespace=True), AfterValidator(_known_state)]
Dollars = Annotated[int, Field(ge=0, le=MAX_AWARD_DOLLARS)]

CitizenshipList = Annotated[list[CitizenshipOption], Field(max_length=4), AfterValidator(_dedupe)]
StateList = Annotated[
    list[StateCode], Field(max_length=len(US_STATE_CODES)), AfterValidator(_dedupe)
]
GradeList = Annotated[list[GradeOption], Field(max_length=4), AfterValidator(_dedupe)]
MajorList = Annotated[list[ShortItem], Field(max_length=60), AfterValidator(_dedupe)]
BasisList = Annotated[list[Basis], Field(max_length=2), AfterValidator(_dedupe)]
FieldList = Annotated[list[ShortItem], Field(max_length=50), AfterValidator(_dedupe)]
OtherList = Annotated[list[OtherLine], Field(max_length=10), AfterValidator(_dedupe)]


class _Value(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class Award(_Value):
    """`fixed` reads `amount`; `range` reads `min`/`max`. Whole dollars."""

    kind: AwardKind = "fixed"
    amount: Dollars | None = None
    min: Dollars | None = None
    max: Dollars | None = None
    renewable: bool = False
    #: Years the award renews for, including the first. Only when renewable.
    years: Annotated[int, Field(ge=1, le=MAX_RENEWAL_YEARS)] | None = None
    #: How many are given each cycle; null when the sponsor doesn't say.
    awards_count: Annotated[int, Field(ge=1, le=MAX_AWARDS_COUNT)] | None = None

    @model_validator(mode="after")
    def _years_only_when_renewable(self) -> Award:
        if self.years is not None and not self.renewable:
            raise ValueError("years is only set for a renewable award")
        return self


class Deadline(_Value):
    kind: DeadlineKind = "fixed"
    #: Only a fixed deadline has a date; a rolling one drops any it is sent.
    date: dt.date | None = None
    opens_on: dt.date | None = None
    recurs_annually: bool = False

    @model_validator(mode="before")
    @classmethod
    def _rolling_has_no_date(cls, data: object) -> object:
        if isinstance(data, dict) and data.get("kind") == "rolling":
            return {**data, "date": None}
        return data


class CitizenshipRule(_Value):
    kind: Literal["citizenship"]
    any_of: CitizenshipList


class StateRule(_Value):
    kind: Literal["state"]
    any_of: StateList


class GradeRule(_Value):
    kind: Literal["grade"]
    any_of: GradeList


class GpaMinRule(_Value):
    kind: Literal["gpa_min"]
    value: Annotated[float, Field(gt=0, le=4.0)]


class FirstGenRule(_Value):
    kind: Literal["first_gen"]


class FinancialNeedRule(_Value):
    kind: Literal["financial_need"]


class MajorRule(_Value):
    kind: Literal["major"]
    any_of: MajorList


EligibilityRule = Annotated[
    CitizenshipRule
    | StateRule
    | GradeRule
    | GpaMinRule
    | FirstGenRule
    | FinancialNeedRule
    | MajorRule,
    Field(discriminator="kind"),
]


class EssayRequirement(_Value):
    prompt: Prompt = ""
    #: Word limit; null when the sponsor gives none.
    words: Annotated[int, Field(ge=1, le=5000)] | None = None


class Requirements(_Value):
    essays: Annotated[list[EssayRequirement], Field(max_length=10)] = []
    recommendations: Annotated[int, Field(ge=0, le=10)] = 0
    transcript: bool = False
    financial_documents: bool = False
    interview: bool = False


class ScholarshipDraft(_Value):
    """Every editable field of a record. Status is not part of the draft."""

    name: Name = ""
    sponsor: Name = ""
    summary: Summary = ""
    apply_url: WebUrl = ""
    source_url: WebUrl = ""
    #: An image URL for the sponsor's logo; blank uses the source site's icon.
    logo_url: WebUrl = ""
    award: Award = Award()
    deadline: Deadline = Deadline()
    basis: BasisList = []
    #: Empty means any field of study.
    fields: FieldList = []
    eligibility: Annotated[list[EligibilityRule], Field(max_length=MAX_RULES)] = []
    other_eligibility: OtherList = []
    requirements: Requirements = Requirements()
    #: Null means never checked against the source.
    last_checked_on: dt.date | None = None

    @model_validator(mode="after")
    def _one_rule_per_kind(self) -> ScholarshipDraft:
        kinds = [rule.kind for rule in self.eligibility]
        if len(kinds) != len(set(kinds)):
            raise ValueError("at most one eligibility rule of each kind")
        return self


__all__ = [
    "US_STATE_CODES",
    "Award",
    "AwardKind",
    "Basis",
    "CitizenshipOption",
    "Deadline",
    "DeadlineKind",
    "EligibilityRule",
    "EssayRequirement",
    "GradeOption",
    "Requirements",
    "ScholarshipDraft",
    "ScholarshipStatus",
    "is_web_url",
]
