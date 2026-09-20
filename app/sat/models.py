"""Request / response models for `/v1/sat/...` (plan.md §4.2).

`frontend/src/api/sat/types.ts` is this module's hand-maintained mirror — a
field renamed or added here must be renamed or added there too; nothing
generates one from the other.

Every endpoint's wire shape stays plain snake_case, matching every other
`app/*/models.py` in this repo, **except `GET /stats`**: the plan calls for
"UserStats (liprep's exact shape)" (§4.2), and the practice dashboard is a
close port of liprep's own analytics screens, which read the upstream
camelCase field names directly (`totalAttemptsCount`, `avgTimeSeconds`, ...).
`SatStatsResponse` and its nested models therefore declare a camelCase
`alias_generator` — the one deliberate exception in this file, not a house
convention change. `populate_by_name=True` throughout means a caller may
still construct them with the snake_case (domain) field names.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel

from domain.sat.types import AnswerOption, Difficulty, ItemType, Module, Source, UserStats

# --- GET /taxonomy, GET /counts --------------------------------------------
#
# `domain.sat.taxonomy.Taxonomy` is returned as-is (plan §4.2: no adaptation
# needed). `/counts` is a plain skill-code -> count map, zero-filled to all
# 29 skills (F13) — a bare dict needs no wrapper class.

type SatCounts = dict[str, int]


# --- GET /session, GET /session?question= ----------------------------------


class SatSessionRow(BaseModel):
    """One light session row (plan §4.2): `id`/`content_sha` are the wire
    names for `sat_questions.question_id`/`content_sha256`."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: str
    score_band: int
    content_sha: str
    bookmarked: bool
    ever_correct: bool
    ever_incorrect: bool


# --- GET /questions/{id} ----------------------------------------------------


class SatQuestionPublic(BaseModel):
    """`domain.sat.types.SatQuestion` minus `correct_answers`/`rationale`
    (plan §4.2: "one question without correct_answers / rationale")."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    question_id: str
    external_id: UUID | None
    ibn: str | None
    u_id: UUID
    source: Source
    module: Module
    domain_cd: str
    skill_cd: str
    score_band: int
    difficulty: Difficulty
    program: str
    item_type: ItemType
    in_bluebook: bool
    cb_created_at: datetime | None
    cb_updated_at: datetime | None
    content_sha256: str
    retired_at: datetime | None
    stimulus: str | None
    stem: str
    answer_options: tuple[AnswerOption, ...]


# --- POST /questions/{id}/attempts, GET /questions/{id}/attempts -----------


class SatAttemptSubmit(BaseModel):
    """Request body of `POST /questions/{id}/attempts` (plan §4.2, §4.3)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    client_attempt_id: UUID
    answer: str
    time_spent_seconds: int
    local_date: date


class SatAttemptOut(BaseModel):
    """One attempt row on the wire — `domain.sat.types.Attempt` minus
    `user_id`/`client_attempt_id` (internal, never returned)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: int
    question_id: str
    module: str
    domain_cd: str
    skill_cd: str
    score_band: int
    user_answer: str
    is_correct: bool
    time_spent_seconds: int
    solved_at: datetime
    local_date: date


class SatSubmitResult(BaseModel):
    """Response of `POST /questions/{id}/attempts` (plan §4.3): verdict, key,
    rationale and the attempt list, oldest first, the new attempt last
    (Q28), all in one round trip."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    is_correct: bool
    correct_answers: tuple[str, ...]
    rationale: str
    attempts: tuple[SatAttemptOut, ...]


# --- PUT /progress -----------------------------------------------------


class SatImportResult(BaseModel):
    """Response of `PUT /progress` (A13a banner: "Imported N attempts & M
    bookmarks.")."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    attempts_imported: int
    bookmarks_imported: int


# --- GET /stats --------------------------------------------------------
#
# liprep's exact camelCase shape (see module docstring). Each class below
# mirrors one of domain/sat/types.py's stats models field-for-field, so
# `stats_response_from_domain` can round-trip through `model_dump()` /
# `model_validate()` rather than hand-copying ~30 field names.

_CAMEL_CONFIG = ConfigDict(
    alias_generator=to_camel, populate_by_name=True, extra="forbid", frozen=True
)


class SatDifficultyBandStat(BaseModel):
    model_config = _CAMEL_CONFIG

    attempted: int
    correct: int
    accuracy_pct: int
    avg_time_seconds: int


class SatSkillPerformance(BaseModel):
    model_config = _CAMEL_CONFIG

    code: str
    name: str
    domain_code: str
    module: str
    total_attempts: int
    unique_questions: int
    first_try_correct: int
    first_try_accuracy_pct: int
    overall_accuracy_pct: int
    avg_time_seconds: int


class SatDomainPerformance(BaseModel):
    model_config = _CAMEL_CONFIG

    code: str
    name: str
    module: str
    total_attempts: int
    unique_questions: int
    first_try_correct: int
    first_try_accuracy_pct: int
    overall_accuracy_pct: int
    avg_time_seconds: int


class SatModuleSectionStats(BaseModel):
    model_config = _CAMEL_CONFIG

    unique_attempted: int
    unique_correct: int
    unique_incorrect: int
    upsolved_count: int
    first_try_accuracy_pct: int
    overall_accuracy_pct: int
    avg_time_seconds: int
    total_time_seconds: int
    domains: Mapping[str, SatDomainPerformance]
    difficulty_stats: Mapping[int, SatDifficultyBandStat]


class SatTodayStats(BaseModel):
    model_config = _CAMEL_CONFIG

    ebrw_solved: int
    math_solved: int
    total_time_seconds: int


class SatSkillRanking(BaseModel):
    model_config = _CAMEL_CONFIG

    code: str
    name: str
    module: str
    accuracy_pct: int
    attempted: int
    avg_time: int


class SatStatsResponse(BaseModel):
    """`GET /stats`'s full response: `UserStats` (camelCase) plus the
    activity heatmap, which is not part of upstream's `UserStats` at all
    (plan §4.2, §4.4) — keyed by ISO date string, count of attempts."""

    model_config = _CAMEL_CONFIG

    total_attempts_count: int
    unique_questions_attempted: int
    unique_correct: int
    unique_incorrect: int
    total_upsolved_count: int
    first_try_overall_accuracy_pct: int
    overall_accuracy_pct: int
    avg_time_seconds: int
    current_streak_days: int
    today: SatTodayStats
    ebrw: SatModuleSectionStats
    math: SatModuleSectionStats
    difficulty_stats: Mapping[int, SatDifficultyBandStat]
    domain_stats: Mapping[str, SatDomainPerformance]
    skill_stats: Mapping[str, SatSkillPerformance]
    weakest_skills: tuple[SatSkillRanking, ...]
    strongest_skills: tuple[SatSkillRanking, ...]
    heatmap: Mapping[str, int]


def stats_response_from_domain(
    stats: UserStats, heatmap: Mapping[date, int]
) -> SatStatsResponse:
    """Builds the wire-shaped `SatStatsResponse` from the domain `UserStats`
    plus the separately-computed heatmap (`domain.sat.stats.compute_heatmap`).
    Every field name matches its domain counterpart 1:1 (see the class
    docstrings above and `domain/sat/types.py`), so a generic dict round-trip
    is exact — no per-field mapping to keep in sync by hand."""
    return SatStatsResponse.model_validate(
        {**stats.model_dump(), "heatmap": {d.isoformat(): n for d, n in heatmap.items()}}
    )


def question_public_from_domain(question: object) -> SatQuestionPublic:
    """Strips `correct_answers`/`rationale` off a loaded `SatQuestion`
    (plan §4.2). Typed `object` only to avoid a hard import cycle risk with
    `domain.sat.types.SatQuestion` at module load; callers always pass one."""
    return SatQuestionPublic.model_validate(question, from_attributes=True)


__all__ = [
    "SatAttemptOut",
    "SatAttemptSubmit",
    "SatCounts",
    "SatDifficultyBandStat",
    "SatDomainPerformance",
    "SatImportResult",
    "SatModuleSectionStats",
    "SatQuestionPublic",
    "SatSessionRow",
    "SatSkillPerformance",
    "SatSkillRanking",
    "SatStatsResponse",
    "SatSubmitResult",
    "SatTodayStats",
    "question_public_from_domain",
    "stats_response_from_domain",
]
