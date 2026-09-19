"""SAT practice data models (plan.md §3.3, §3.4, §4.1, §4.4; parity-inventory
F/S/A-rows).

Pure stdlib + pydantic (ADR 0017): no I/O. ``SatQuestion`` is
``domain/sat/normalize.py``'s output shape (plan §3.3) and mirrors the split
schema of migration ``0021_sat_practice.sql`` (plan §3.4) — one model here,
built from a join of ``sat_questions`` + ``sat_question_content`` on read.
``UserStats`` reproduces liprep's ``getUserStatistics()`` return shape
(``src/types/questions.ts``) field for field, quirks included — see its own
docstring for the upstream camelCase name of every field.
"""

from __future__ import annotations

from collections.abc import Mapping
from datetime import date, datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, model_validator

# --- shared literals -------------------------------------------------------

Module = Literal["reading", "math"]
ItemType = Literal["mcq", "spr"]
Difficulty = Literal["E", "M", "H"]
Source = Literal["qbank", "disclosed"]

# Upstream `FilterState.solvedStatus` (`src/types/questions.ts`) is
# `"all" | "unsolved" | "incorrect" | "bookmarked"` — the UI's "Mistakes"
# label (F3/F4) maps to the internal value "incorrect". "all" is upstream's
# literal, not "any"; kept verbatim so a filter payload round-trips.
SolvedStatus = Literal["all", "unsolved", "incorrect", "bookmarked"]


# --- question bank -----------------------------------------------------


class AnswerOption(BaseModel):
    """One MCQ option (plan §3.3: ``label`` = position letter A-D)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    label: str
    content: str


class SatQuestion(BaseModel):
    """One normalized question — ``normalize.py``'s output (plan §3.3),
    joining ``sat_questions`` (metadata) and ``sat_question_content`` (the
    wide HTML columns, plan §3.4) into the shape services and the API read.

    ``question_id`` is the assessment-99 stub id, 8 lower-case hex characters
    (G3); ``external_id`` xor ``ibn`` identifies the content (§3.1, §3.3).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    question_id: str
    external_id: UUID | None
    ibn: str | None
    u_id: UUID
    source: Source
    module: Module
    domain_cd: str
    skill_cd: str
    score_band: int = Field(ge=1, le=7)
    difficulty: Difficulty
    program: str
    item_type: ItemType
    in_bluebook: bool
    cb_created_at: datetime | None
    cb_updated_at: datetime | None
    content_sha256: str
    retired_at: datetime | None = None
    stimulus: str | None
    stem: str
    answer_options: tuple[AnswerOption, ...] = ()
    correct_answers: tuple[str, ...] = Field(min_length=1)
    rationale: str

    @model_validator(mode="after")
    def _check_external_id_xor_ibn(self) -> SatQuestion:
        if (self.external_id is None) == (self.ibn is None):
            raise ValueError(
                "exactly one of external_id or ibn must be set (plan §3.4)"
            )
        return self


# --- attempts / bookmarks ------------------------------------------------


class Attempt(BaseModel):
    """One row of ``counselle.sat_attempts`` (plan §3.4). ``module``,
    ``domain_cd`` and ``skill_cd`` are the question's classification *at the
    time of the attempt*, denormalised deliberately (plan §3.4: attempts have
    no FK to questions) — free text, not the ``Module``/skill-code literals,
    because an imported ``.liprep`` file may carry unknown or empty codes
    (S17, S18, A13a).
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    id: int | None = None
    user_id: UUID
    client_attempt_id: UUID
    question_id: str
    module: str
    domain_cd: str = ""
    skill_cd: str = ""
    score_band: int
    user_answer: str
    is_correct: bool
    time_spent_seconds: int = Field(ge=1)
    solved_at: datetime
    local_date: date


class Bookmark(BaseModel):
    """One row of ``counselle.sat_bookmarks`` (plan §3.4)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    user_id: UUID
    question_id: str
    bookmarked_at: datetime


class SatFilter(BaseModel):
    """The launched filter (plan §5.3; F3, F6, F7, F12, F20). ``skills`` and
    ``bands`` empty means *all* (F20) — never validated as non-empty here.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    skills: tuple[str, ...] = ()
    bands: tuple[int, ...] = ()
    status: SolvedStatus = "all"
    exclude_bluebook: bool = True


# --- statistics (plan §4.4; parity-inventory S1-S22) ------------------


class DifficultyBandStat(BaseModel):
    """One score-band (1-7) bucket — upstream ``difficultyStats[band]``, on
    both the top-level ``UserStats`` and each ``ModuleSectionStats`` (S8,
    S19: attempt-level, bands 1-7 only). Field names are the snake_case of
    upstream's camelCase."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    attempted: int
    correct: int
    accuracy_pct: int
    avg_time_seconds: int


class SkillPerformance(BaseModel):
    """Upstream ``SkillPerformance`` (S9, S16-S18): keyed by skill code in
    ``UserStats.skill_stats``; ``name`` falls back to the raw code for a code
    outside the taxonomy (S18). Field names are the snake_case of upstream's
    camelCase."""

    model_config = ConfigDict(extra="forbid", frozen=True)

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


class DomainPerformance(BaseModel):
    """Upstream ``DomainPerformance`` (S17): only the eight known domain
    codes ever appear as keys in ``UserStats.domain_stats`` / a module's
    ``domains``. Upstream's optional ``skills`` field is **not ported**
    (S22: computed by a fallback clause that can never be true, and read by
    nothing). Field names are the snake_case of upstream's camelCase."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    name: str
    module: str
    total_attempts: int
    unique_questions: int
    first_try_correct: int
    first_try_accuracy_pct: int
    overall_accuracy_pct: int
    avg_time_seconds: int


class ModuleSectionStats(BaseModel):
    """Upstream ``ModuleSectionStats`` — one of ``UserStats.ebrw`` /
    ``UserStats.math`` (S7: the module split is strictly ``== "math"``;
    anything else counts as EBRW). Field names are the snake_case of
    upstream's camelCase."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    unique_attempted: int
    unique_correct: int
    unique_incorrect: int
    upsolved_count: int
    first_try_accuracy_pct: int
    overall_accuracy_pct: int
    avg_time_seconds: int
    total_time_seconds: int
    domains: Mapping[str, DomainPerformance]
    difficulty_stats: Mapping[int, DifficultyBandStat]


class TodayStats(BaseModel):
    """Upstream ``UserStats.today`` (F17: EBRW/Math attempts today, total
    time today). Field names are the snake_case of upstream's camelCase."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    ebrw_solved: int
    math_solved: int
    total_time_seconds: int


class SkillRanking(BaseModel):
    """One entry of ``UserStats.weakest_skills`` / ``strongest_skills``
    (S9: stable-sorted by first-try accuracy ascending; strongest is the
    weakest list reversed, first four of each). Field names are the
    snake_case of upstream's camelCase."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    name: str
    module: str
    accuracy_pct: int
    attempted: int
    avg_time: int


class UserStats(BaseModel):
    """Reproduces liprep's ``getUserStatistics()`` return shape
    (``UserStats`` in ``src/types/questions.ts``) field for field, quirks
    included — they are the product (plan §4.4). Field names here are
    snake_case; each line below names the upstream camelCase field this one
    mirrors, so the API layer can alias back to camelCase if the wire
    contract ever needs it.

    - ``total_attempts_count``           <- ``totalAttemptsCount``
    - ``unique_questions_attempted``     <- ``uniqueQuestionsAttempted``
    - ``unique_correct``                 <- ``uniqueCorrect``
    - ``unique_incorrect``               <- ``uniqueIncorrect``
    - ``total_upsolved_count``           <- ``totalUpsolvedCount``
    - ``first_try_overall_accuracy_pct`` <- ``firstTryOverallAccuracyPct``
    - ``overall_accuracy_pct``           <- ``overallAccuracyPct``
    - ``avg_time_seconds``               <- ``avgTimeSeconds``
    - ``current_streak_days``            <- ``currentStreakDays``
    - ``today``                          <- ``today`` (``TodayStats``)
    - ``ebrw`` / ``math``                <- ``ebrw`` / ``math`` (``ModuleSectionStats``)
    - ``difficulty_stats``               <- ``difficultyStats``
    - ``domain_stats``                   <- ``domainStats``
    - ``skill_stats``                    <- ``skillStats``
    - ``weakest_skills``                 <- ``weakestSkills``
    - ``strongest_skills``               <- ``strongestSkills``

    Not part of upstream's ``UserStats`` at all: the activity-heatmap
    ``{date: n}`` map (F14-F15) is a separate query upstream and a separate
    field on the ``GET /stats`` response here (plan §4.2) — never folded
    into this type.
    """

    model_config = ConfigDict(extra="forbid", frozen=True)

    total_attempts_count: int
    unique_questions_attempted: int
    unique_correct: int
    unique_incorrect: int
    total_upsolved_count: int
    first_try_overall_accuracy_pct: int
    overall_accuracy_pct: int
    avg_time_seconds: int
    current_streak_days: int
    today: TodayStats
    ebrw: ModuleSectionStats
    math: ModuleSectionStats
    difficulty_stats: Mapping[int, DifficultyBandStat]
    domain_stats: Mapping[str, DomainPerformance]
    skill_stats: Mapping[str, SkillPerformance]
    weakest_skills: tuple[SkillRanking, ...]
    strongest_skills: tuple[SkillRanking, ...]
