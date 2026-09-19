"""Statistics parity + direct tests (plan.md §4.4, §8.2; parity-inventory
S1-S22).

The 300-case vector suite is captured from liprep's own
``getUserStatistics()`` (``tests/domain/sat/upstream/harness/generate.stats.spec.ts``);
every case is asserted individually by deep-equality on the reconstructed
``UserStats`` object, so a mismatch names its own failing case id. No float
tolerance is used anywhere — every quantity ``compute_user_stats`` produces
is an integer (a count, or a percentage/average already rounded by
``_js_round``), so exact equality is possible and is what's asserted.
"""

from __future__ import annotations

import gzip
import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

import pytest
import yaml

from domain.sat.stats import compute_heatmap, compute_user_stats
from domain.sat.taxonomy import Taxonomy
from domain.sat.types import (
    Attempt,
    DifficultyBandStat,
    DomainPerformance,
    ModuleSectionStats,
    SkillPerformance,
    SkillRanking,
    TodayStats,
    UserStats,
)

REPO_ROOT = Path(__file__).resolve().parents[3]
VECTORS_DIR = REPO_ROOT / "tests" / "domain" / "sat" / "upstream" / "vectors"
TAXONOMY_PATH = REPO_ROOT / "config" / "assets" / "sat" / "taxonomy.yaml"

_FIXED_USER_ID = uuid4()


def _taxonomy() -> Taxonomy:
    data = yaml.safe_load(TAXONOMY_PATH.read_text())
    return Taxonomy.model_validate(data)


def _load_cases() -> list[dict[str, Any]]:
    for name in ("stats.json", "stats.json.gz"):
        path = VECTORS_DIR / name
        if not path.exists():
            continue
        raw = gzip.decompress(path.read_bytes()) if name.endswith(".gz") else path.read_bytes()
        cases: list[dict[str, Any]] = json.loads(raw)["cases"]
        return cases
    raise FileNotFoundError(f"no stats vector file in {VECTORS_DIR}")


_TAXONOMY = _taxonomy()
_CASES = _load_cases()


# --- converting a vector case into domain inputs / expected output -------


def _to_attempt(index: int, record: dict[str, Any]) -> Attempt:
    # Dexie's `++id` assigns increasing ids in insertion (= array) order —
    # the harness seeds attempts in the array's own order, so the index is
    # the id (plan §4.6: "import assigns ids in file order").
    solved_at = datetime.fromtimestamp(record["solvedAt"] / 1000, tz=UTC)
    local_date = date.fromisoformat(record["dateKey"])
    return Attempt(
        id=index,
        user_id=_FIXED_USER_ID,
        client_attempt_id=uuid5(NAMESPACE_URL, f"attempt-{index}"),
        question_id=record["questionId"],
        module=record["module"],
        domain_cd=record["primary_class_cd"] or "",
        skill_cd=record["skill_cd"] or "",
        score_band=record["score_band_range_cd"],
        user_answer=record["userAnswer"],
        is_correct=record["isCorrect"],
        time_spent_seconds=record["timeSpentSeconds"],
        solved_at=solved_at,
        local_date=local_date,
    )


def _band_map(raw: dict[str, Any]) -> dict[int, DifficultyBandStat]:
    return {
        int(band): DifficultyBandStat(
            attempted=v["attempted"],
            correct=v["correct"],
            accuracy_pct=v["accuracyPct"],
            avg_time_seconds=v["avgTimeSeconds"],
        )
        for band, v in raw.items()
    }


def _domain_perf(raw: dict[str, Any]) -> DomainPerformance:
    # `raw["skills"]` is upstream's unported field (S22) — dropped here.
    return DomainPerformance(
        code=raw["code"],
        name=raw["name"],
        module=raw["module"],
        total_attempts=raw["totalAttempts"],
        unique_questions=raw["uniqueQuestions"],
        first_try_correct=raw["firstTryCorrect"],
        first_try_accuracy_pct=raw["firstTryAccuracyPct"],
        overall_accuracy_pct=raw["overallAccuracyPct"],
        avg_time_seconds=raw["avgTimeSeconds"],
    )


def _domain_map(raw: dict[str, Any]) -> dict[str, DomainPerformance]:
    return {code: _domain_perf(v) for code, v in raw.items()}


def _skill_perf(raw: dict[str, Any]) -> SkillPerformance:
    return SkillPerformance(
        code=raw["code"],
        name=raw["name"],
        domain_code=raw["domainCode"],
        module=raw["module"],
        total_attempts=raw["totalAttempts"],
        unique_questions=raw["uniqueQuestions"],
        first_try_correct=raw["firstTryCorrect"],
        first_try_accuracy_pct=raw["firstTryAccuracyPct"],
        overall_accuracy_pct=raw["overallAccuracyPct"],
        avg_time_seconds=raw["avgTimeSeconds"],
    )


def _skill_map(raw: dict[str, Any]) -> dict[str, SkillPerformance]:
    return {code: _skill_perf(v) for code, v in raw.items()}


def _module_stats(raw: dict[str, Any]) -> ModuleSectionStats:
    return ModuleSectionStats(
        unique_attempted=raw["uniqueAttempted"],
        unique_correct=raw["uniqueCorrect"],
        unique_incorrect=raw["uniqueIncorrect"],
        upsolved_count=raw["upsolvedCount"],
        first_try_accuracy_pct=raw["firstTryAccuracyPct"],
        overall_accuracy_pct=raw["overallAccuracyPct"],
        avg_time_seconds=raw["avgTimeSeconds"],
        total_time_seconds=raw["totalTimeSeconds"],
        domains=_domain_map(raw["domains"]),
        difficulty_stats=_band_map(raw["difficultyStats"]),
    )


def _skill_rankings(raw: list[dict[str, Any]]) -> tuple[SkillRanking, ...]:
    return tuple(
        SkillRanking(
            code=x["code"],
            name=x["name"],
            module=x["module"],
            accuracy_pct=x["accuracyPct"],
            attempted=x["attempted"],
            avg_time=x["avgTime"],
        )
        for x in raw
    )


def _expected_user_stats(raw: dict[str, Any]) -> UserStats:
    return UserStats(
        total_attempts_count=raw["totalAttemptsCount"],
        unique_questions_attempted=raw["uniqueQuestionsAttempted"],
        unique_correct=raw["uniqueCorrect"],
        unique_incorrect=raw["uniqueIncorrect"],
        total_upsolved_count=raw["totalUpsolvedCount"],
        first_try_overall_accuracy_pct=raw["firstTryOverallAccuracyPct"],
        overall_accuracy_pct=raw["overallAccuracyPct"],
        avg_time_seconds=raw["avgTimeSeconds"],
        current_streak_days=raw["currentStreakDays"],
        today=TodayStats(
            ebrw_solved=raw["today"]["ebrwSolved"],
            math_solved=raw["today"]["mathSolved"],
            total_time_seconds=raw["today"]["totalTimeSeconds"],
        ),
        ebrw=_module_stats(raw["ebrw"]),
        math=_module_stats(raw["math"]),
        difficulty_stats=_band_map(raw["difficultyStats"]),
        domain_stats=_domain_map(raw["domainStats"]),
        skill_stats=_skill_map(raw["skillStats"]),
        weakest_skills=_skill_rankings(raw["weakestSkills"]),
        strongest_skills=_skill_rankings(raw["strongestSkills"]),
    )


def _case_id(index: int, case: dict[str, Any]) -> str:
    return f"{index}:{case['scenario']}:n={case['attemptCount']}"


@pytest.mark.parametrize("case", _CASES, ids=[_case_id(i, c) for i, c in enumerate(_CASES)])
def test_stats_vector(case: dict[str, Any]) -> None:
    attempts = [_to_attempt(i, r) for i, r in enumerate(case["attempts"])]
    today = datetime.fromisoformat(case["today"]).date()

    actual = compute_user_stats(attempts, today, _TAXONOMY)
    expected = _expected_user_stats(case["stats"])

    assert actual == expected, (
        f"case {case['index']} ({case['scenario']}, today={today}, "
        f"n={case['attemptCount']}) mismatched"
    )


def test_stats_vector_suite_is_nonempty() -> None:
    # A guard against a silently-empty vector file passing this module
    # vacuously (300 cases at the time this suite was captured).
    assert len(_CASES) >= 250


# --- direct tests: rounding, empty log, streak, DST-adjacent dates -------


def test_js_round_half_up_at_point_five() -> None:
    # JS `Math.round` rounds .5 up, unlike Python's round-half-to-even
    # (plan §4.4). 1 correct of 8 => 12.5% must round to 13, not 12.
    attempts = [
        Attempt(
            id=i,
            user_id=_FIXED_USER_ID,
            client_attempt_id=uuid4(),
            question_id=f"q{i}",
            module="math",
            domain_cd="H",
            skill_cd="H.A.",
            score_band=3,
            user_answer="x",
            is_correct=(i == 0),
            time_spent_seconds=15,
            solved_at=datetime(2026, 1, 1, tzinfo=UTC) + timedelta(minutes=i),
            local_date=date(2026, 1, 1),
        )
        for i in range(8)
    ]
    stats = compute_user_stats(attempts, date(2026, 1, 2), _TAXONOMY)
    assert stats.skill_stats["H.A."].overall_accuracy_pct == 13


def test_empty_log_is_all_zero_never_null() -> None:
    stats = compute_user_stats([], date(2026, 1, 1), _TAXONOMY)
    assert stats.total_attempts_count == 0
    assert stats.current_streak_days == 0
    assert stats.overall_accuracy_pct == 0
    assert stats.skill_stats == {}
    assert stats.weakest_skills == ()
    assert set(stats.domain_stats) == {"CAS", "EOI", "INI", "SEC", "H", "P", "Q", "S"}
    assert all(band.attempted == 0 for band in stats.difficulty_stats.values())
    assert compute_heatmap([]) == {}


def _attempt_on(day: date, index: int) -> Attempt:
    return Attempt(
        id=index,
        user_id=_FIXED_USER_ID,
        client_attempt_id=uuid4(),
        question_id=f"q-{day.isoformat()}-{index}",
        module="reading",
        domain_cd="CAS",
        skill_cd="TSP",
        score_band=4,
        user_answer="x",
        is_correct=True,
        time_spent_seconds=20,
        solved_at=datetime(day.year, day.month, day.day, 12, tzinfo=UTC),
        local_date=day,
    )


def test_streak_across_a_month_boundary() -> None:
    # Jan 30, 31, Feb 1 — a 3-day streak that crosses a month boundary.
    days = [date(2026, 1, 30), date(2026, 1, 31), date(2026, 2, 1)]
    attempts = [_attempt_on(d, i) for i, d in enumerate(days)]
    stats = compute_user_stats(attempts, date(2026, 2, 1), _TAXONOMY)
    assert stats.current_streak_days == 3


def test_streak_counts_yesterday_when_nothing_solved_today() -> None:
    attempts = [_attempt_on(date(2026, 3, 9), 0)]
    stats = compute_user_stats(attempts, date(2026, 3, 10), _TAXONOMY)
    assert stats.current_streak_days == 1


def test_streak_is_zero_when_gap_before_today_and_yesterday() -> None:
    attempts = [_attempt_on(date(2026, 3, 1), 0)]
    stats = compute_user_stats(attempts, date(2026, 3, 10), _TAXONOMY)
    assert stats.current_streak_days == 0


@pytest.mark.parametrize(
    "today",
    [
        date(2026, 3, 8),  # US spring-forward day (2:00am -> 3:00am)
        date(2026, 3, 9),  # the day after
        date(2026, 11, 1),  # US fall-back day (2:00am -> 1:00am)
        date(2026, 11, 2),  # the day after
    ],
)
def test_streak_is_stable_across_dst_transition_days(today: date) -> None:
    # Our calendar-day streak (S21, ADAPTED) never double-counts or skips a
    # day around a DST transition the way upstream's fixed 86,400,000ms
    # step can — a 3-day run ending "today" is always exactly 3, regardless
    # of which local clock change falls inside it.
    days = [today - timedelta(days=2), today - timedelta(days=1), today]
    attempts = [_attempt_on(d, i) for i, d in enumerate(days)]
    stats = compute_user_stats(attempts, today, _TAXONOMY)
    assert stats.current_streak_days == 3


def test_heatmap_counts_attempts_per_calendar_day() -> None:
    attempts = [
        _attempt_on(date(2026, 1, 1), 0),
        _attempt_on(date(2026, 1, 1), 1),
        _attempt_on(date(2026, 1, 2), 2),
    ]
    heatmap = compute_heatmap(attempts)
    assert heatmap == {date(2026, 1, 1): 2, date(2026, 1, 2): 1}
