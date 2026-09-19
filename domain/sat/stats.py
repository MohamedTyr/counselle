"""SAT practice statistics — ports liprep's ``getUserStatistics()``
(``tests/domain/sat/upstream/harness/.upstream/src/db.ts``) number for
number, quirks included (plan.md §4.4; parity-inventory S1-S22). Pure stdlib
+ pydantic (ADR 0017): no I/O, no clock reads — ``today`` is always a
parameter.

Every parity-inventory S-row this module implements:

- **S1** attempts are ordered by ``solved_at``; per question, *first* is the
  earliest attempt and *latest* the most recent.
- **S2** first-try accuracy (global/module/domain/skill) = first-attempt
  correct ÷ unique questions attempted, in that scope.
- **S3** overall accuracy = correct attempts ÷ all attempts, in scope.
- **S4** unique correct/incorrect are keyed off each question's *latest*
  attempt.
- **S5** upsolved = the question had an incorrect attempt at some point
  *and* its latest attempt is correct.
- **S6** avg time = total seconds ÷ attempt count, per scope; total time is
  the sum.
- **S7** two disjoint kinds of quantity read two different attempts: the
  **per-question** quantities (module bucket, domain/skill unique counts,
  first-try correctness) read the question's **first** attempt; the
  **per-attempt** quantities (attempt totals, overall accuracy, times, band
  stats) read **each attempt's own** fields. The module split is strictly
  ``== "math"``; anything else is EBRW.
- **S8** / **S19** band stats are per attempt, not per unique question, and
  count only attempts whose band is 1-7.
- **S9** ranking: skills with >= 1 attempt, stable-sorted by first-try
  accuracy ascending; weakest = first 4, strongest = that list *reversed*
  (not re-sorted), first 4. A skill first seen on a question's non-first
  attempt is appended after every skill seen on a first attempt, in
  whatever order the per-attempt pass reaches it.
- **S10** every percentage/average is rounded to an integer with
  ``_js_round`` (see below).
- **S11** the calendar-day key used for "today" and the streak is each
  attempt's own ``local_date`` — never derived from ``solved_at`` here.
- **S12** "latest attempt" is ``ORDER BY solved_at, id`` — used everywhere,
  including here.
- **S17** only the taxonomy's known domain codes ever accumulate into a
  domain scope; an attempt with an unknown or empty domain code still
  counts in global/module/band scopes but in no domain.
- **S18** skills are keyed by code; a code outside the taxonomy still
  accumulates (using the raw code as its name) but is dropped when empty.
  A skill's ``domain_code``/``module`` come from whichever attempt first
  created its entry (first-attempt pass, else the per-attempt pass).
- **S20** every empty scope's numbers are 0, never null — every division
  below is guarded, and every known domain/band is always present with
  zero defaults even when no attempt ever touched it.
- **S21 (ADAPTED)** upstream walks back in fixed 86,400,000ms steps over
  local date keys, so a DST day can be double-counted or skipped; we walk
  by calendar day instead — identical on every other day.
- **S22** upstream's ``DomainPerformance.skills`` (computed by a fallback
  clause that can never be true, read by nothing) is not ported.

Porting trap: JS ``Math.round`` rounds half **up**; Python's ``round``
rounds half to even. ``js_round`` (``domain/sat/_rounding.py``) matches
upstream for every non-negative quantity computed here (every rounded
quantity in this module is a count, percentage, or average of non-negative
numbers).
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, timedelta

from domain.sat._rounding import js_round as _js_round
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

_MATH = "math"
_BANDS = range(1, 8)


def _pct(numerator: int, denominator: int) -> int:
    return _js_round(100 * numerator / denominator) if denominator else 0


def _avg(total: int, denominator: int) -> int:
    return _js_round(total / denominator) if denominator else 0


# --- taxonomy lookups (pure; no I/O — Taxonomy is already an in-memory
# value object per ADR 0017) -------------------------------------------


@dataclass(frozen=True)
class _TaxonomyLookup:
    domain_module: Mapping[str, str]
    domain_name: Mapping[str, str]
    taxonomy: Taxonomy

    def skill_name(self, code: str) -> str:
        """Taxonomy name for ``code``, else the raw code (S18)."""
        found = self.taxonomy.find_skill(code)
        return found[2].name if found else code


def _build_lookup(taxonomy: Taxonomy) -> _TaxonomyLookup:
    domain_module: dict[str, str] = {}
    domain_name: dict[str, str] = {}
    for mod in taxonomy.modules:
        for dom in mod.domains:
            domain_module[dom.code] = mod.code
            domain_name[dom.code] = dom.name
    return _TaxonomyLookup(domain_module=domain_module, domain_name=domain_name, taxonomy=taxonomy)


# --- accumulators (mutable, internal only) ------------------------------


@dataclass
class _ModuleAgg:
    unique_attempted: int = 0
    unique_correct: int = 0
    unique_incorrect: int = 0
    upsolved_count: int = 0
    first_try_correct: int = 0
    total_time: int = 0
    attempts_total: int = 0
    correct_total: int = 0
    bands: dict[int, _BandAgg] = field(default_factory=lambda: {b: _BandAgg() for b in _BANDS})


@dataclass
class _BandAgg:
    attempted: int = 0
    correct: int = 0
    total_time: int = 0


@dataclass
class _DomainAgg:
    module: str
    total_attempts: int = 0
    unique_count: int = 0
    first_try_correct: int = 0
    total_correct: int = 0
    total_time: int = 0


@dataclass
class _SkillAgg:
    name: str
    domain_code: str
    module: str
    attempts: int = 0
    unique_count: int = 0
    first_try_correct: int = 0
    correct: int = 0
    total_time: int = 0


def _order_attempts(attempts: Sequence[Attempt]) -> list[Attempt]:
    """``ORDER BY solved_at, id`` (S12)."""
    return sorted(attempts, key=lambda a: (a.solved_at, a.id if a.id is not None else -1))


def _group_by_question(sorted_attempts: Sequence[Attempt]) -> dict[str, list[Attempt]]:
    groups: dict[str, list[Attempt]] = {}
    for a in sorted_attempts:
        groups.setdefault(a.question_id, []).append(a)
    return groups


def _module_agg(is_math: bool, ebrw: _ModuleAgg, math_: _ModuleAgg) -> _ModuleAgg:
    return math_ if is_math else ebrw


@dataclass
class _QuestionTotals:
    unique_correct: int = 0
    unique_incorrect: int = 0
    upsolved: int = 0
    first_try_correct: int = 0


def _apply_question(
    group: list[Attempt],
    totals: _QuestionTotals,
    ebrw: _ModuleAgg,
    math_: _ModuleAgg,
    domains: dict[str, _DomainAgg],
    skills: dict[str, _SkillAgg],
    lookup: _TaxonomyLookup,
) -> None:
    """One question's worth of S1-S7 per-question quantities, read from its
    *first* attempt (S7); ``is_now_correct``/``is_upsolved`` also need its
    *latest* attempt (S1, S4, S5)."""
    first, latest = group[0], group[-1]
    is_now_correct = latest.is_correct
    is_upsolved = any(not a.is_correct for a in group) and is_now_correct

    if first.is_correct:
        totals.first_try_correct += 1
    if is_now_correct:
        totals.unique_correct += 1
    else:
        totals.unique_incorrect += 1
    if is_upsolved:
        totals.upsolved += 1

    mod = _module_agg(first.module == _MATH, ebrw, math_)
    mod.unique_attempted += 1
    mod.unique_correct += 1 if is_now_correct else 0
    mod.unique_incorrect += 0 if is_now_correct else 1
    mod.upsolved_count += 1 if is_upsolved else 0
    mod.first_try_correct += 1 if first.is_correct else 0

    if first.domain_cd in domains:
        dom = domains[first.domain_cd]
        dom.unique_count += 1
        dom.first_try_correct += 1 if first.is_correct else 0

    if first.skill_cd:
        sk = skills.setdefault(
            first.skill_cd,
            _SkillAgg(
                name=lookup.skill_name(first.skill_cd),
                domain_code=first.domain_cd,
                module=first.module,
            ),
        )
        sk.unique_count += 1
        sk.first_try_correct += 1 if first.is_correct else 0


def _per_question_pass(
    question_groups: Mapping[str, list[Attempt]],
    lookup: _TaxonomyLookup,
) -> tuple[_QuestionTotals, _ModuleAgg, _ModuleAgg, dict[str, _DomainAgg], dict[str, _SkillAgg]]:
    """S1-S7: quantities read from each question's *first* attempt."""
    totals = _QuestionTotals()
    ebrw, math_ = _ModuleAgg(), _ModuleAgg()
    domains: dict[str, _DomainAgg] = {
        code: _DomainAgg(module=mod) for code, mod in lookup.domain_module.items()
    }
    skills: dict[str, _SkillAgg] = {}

    for group in question_groups.values():
        _apply_question(group, totals, ebrw, math_, domains, skills, lookup)

    return totals, ebrw, math_, domains, skills


def _apply_band(bands: dict[int, _BandAgg], band: int, t: int, is_correct: bool) -> None:
    if band not in bands:
        return
    agg = bands[band]
    agg.attempted += 1
    agg.total_time += t
    agg.correct += 1 if is_correct else 0


def _apply_attempt(
    a: Attempt,
    ebrw: _ModuleAgg,
    math_: _ModuleAgg,
    domains: dict[str, _DomainAgg],
    skills: dict[str, _SkillAgg],
    global_bands: dict[int, _BandAgg],
) -> int:
    """One attempt's worth of S3, S6, S8, S19 per-attempt quantities, read
    from its own fields (S7). Returns its ``time_spent_seconds`` so the
    caller can total it."""
    t = a.time_spent_seconds
    mod = _module_agg(a.module == _MATH, ebrw, math_)
    mod.total_time += t
    mod.attempts_total += 1
    mod.correct_total += 1 if a.is_correct else 0

    _apply_band(global_bands, a.score_band, t, a.is_correct)
    _apply_band(mod.bands, a.score_band, t, a.is_correct)

    if a.domain_cd in domains:
        dom = domains[a.domain_cd]
        dom.total_attempts += 1
        dom.total_time += t
        dom.total_correct += 1 if a.is_correct else 0

    if a.skill_cd:
        # name="" is a placeholder: a skill first seen here (S18, not on
        # any question's first attempt) has no taxonomy lookup available
        # in this pass; compute_user_stats resolves it once, after both
        # passes, via the shared _TaxonomyLookup.
        sk = skills.setdefault(
            a.skill_cd,
            _SkillAgg(name="", domain_code=a.domain_cd, module=a.module),
        )
        sk.attempts += 1
        sk.total_time += t
        sk.correct += 1 if a.is_correct else 0

    return t


def _per_attempt_pass(
    sorted_attempts: Sequence[Attempt],
    ebrw: _ModuleAgg,
    math_: _ModuleAgg,
    domains: dict[str, _DomainAgg],
    skills: dict[str, _SkillAgg],
    global_bands: dict[int, _BandAgg],
) -> tuple[int, int]:
    """S3, S6, S8, S19: quantities read from *each attempt's own* fields.
    Returns ``(global_total_time, global_correct_count)``."""
    global_total_time = 0
    global_correct = 0
    for a in sorted_attempts:
        global_total_time += _apply_attempt(a, ebrw, math_, domains, skills, global_bands)
        if a.is_correct:
            global_correct += 1
    return global_total_time, global_correct


def _finalize_bands(bands: Mapping[int, _BandAgg]) -> dict[int, DifficultyBandStat]:
    return {
        b: DifficultyBandStat(
            attempted=agg.attempted,
            correct=agg.correct,
            accuracy_pct=_pct(agg.correct, agg.attempted),
            avg_time_seconds=_avg(agg.total_time, agg.attempted),
        )
        for b, agg in bands.items()
    }


def _finalize_skill_stats(skills: Mapping[str, _SkillAgg]) -> dict[str, SkillPerformance]:
    return {
        code: SkillPerformance(
            code=code,
            name=sk.name,
            domain_code=sk.domain_code,
            module=sk.module,
            total_attempts=sk.attempts,
            unique_questions=sk.unique_count,
            first_try_correct=sk.first_try_correct,
            first_try_accuracy_pct=_pct(sk.first_try_correct, sk.unique_count),
            overall_accuracy_pct=_pct(sk.correct, sk.attempts),
            avg_time_seconds=_avg(sk.total_time, sk.attempts),
        )
        for code, sk in skills.items()
    }


def _finalize_domain_stats(
    domains: Mapping[str, _DomainAgg], lookup: _TaxonomyLookup
) -> dict[str, DomainPerformance]:
    return {
        code: DomainPerformance(
            code=code,
            name=lookup.domain_name.get(code, code),
            module=dom.module,
            total_attempts=dom.total_attempts,
            unique_questions=dom.unique_count,
            first_try_correct=dom.first_try_correct,
            first_try_accuracy_pct=_pct(dom.first_try_correct, dom.unique_count),
            overall_accuracy_pct=_pct(dom.total_correct, dom.total_attempts),
            avg_time_seconds=_avg(dom.total_time, dom.total_attempts),
        )
        for code, dom in domains.items()
    }


def _finalize_module_stats(
    mod: _ModuleAgg,
    module_code: str,
    domain_stats: Mapping[str, DomainPerformance],
    lookup: _TaxonomyLookup,
) -> ModuleSectionStats:
    own_domains = {
        code: perf
        for code, perf in domain_stats.items()
        if lookup.domain_module[code] == module_code
    }
    return ModuleSectionStats(
        unique_attempted=mod.unique_attempted,
        unique_correct=mod.unique_correct,
        unique_incorrect=mod.unique_incorrect,
        upsolved_count=mod.upsolved_count,
        first_try_accuracy_pct=_pct(mod.first_try_correct, mod.unique_attempted),
        overall_accuracy_pct=_pct(mod.correct_total, mod.attempts_total),
        avg_time_seconds=_avg(mod.total_time, mod.attempts_total),
        total_time_seconds=mod.total_time,
        domains=own_domains,
        difficulty_stats=_finalize_bands(mod.bands),
    )


def _rank_skills(
    skill_stats: Mapping[str, SkillPerformance],
) -> tuple[tuple[SkillRanking, ...], tuple[SkillRanking, ...]]:
    """S9: skills with >= 1 attempt, stable-sorted by first-try accuracy
    ascending; weakest = first 4; strongest = that list reversed, first 4."""
    ranked = [
        SkillRanking(
            code=sk.code,
            name=sk.name,
            module=sk.module,
            accuracy_pct=sk.first_try_accuracy_pct,
            attempted=sk.total_attempts,
            avg_time=sk.avg_time_seconds,
        )
        for sk in skill_stats.values()
        if sk.total_attempts >= 1
    ]
    ranked.sort(key=lambda r: r.accuracy_pct)
    weakest = tuple(ranked[:4])
    strongest = tuple(list(reversed(ranked))[:4])
    return weakest, strongest


def _today_stats(attempts: Sequence[Attempt], today: date) -> TodayStats:
    ebrw_solved = math_solved = total_time = 0
    for a in attempts:
        if a.local_date != today:
            continue
        if a.module == _MATH:
            math_solved += 1
        else:
            ebrw_solved += 1
        total_time += a.time_spent_seconds
    return TodayStats(
        ebrw_solved=ebrw_solved, math_solved=math_solved, total_time_seconds=total_time
    )


def _current_streak(attempts: Sequence[Attempt], today: date) -> int:
    """S11, S21 (ADAPTED): walk back one calendar day at a time over each
    attempt's own ``local_date``, starting at today if it has an attempt,
    else yesterday; 0 if neither does."""
    dates = {a.local_date for a in attempts}
    yesterday = today - timedelta(days=1)
    if today not in dates and yesterday not in dates:
        return 0

    streak = 0
    check = today if today in dates else yesterday
    while check in dates:
        streak += 1
        check -= timedelta(days=1)
    return streak


def compute_heatmap(attempts: Sequence[Attempt]) -> dict[date, int]:
    """Upstream's activity-heatmap ``{date: n}`` (F14-F15) — attempt count
    per calendar day, over every attempt's own ``local_date``. Not part of
    ``UserStats`` upstream either; a separate field on the API response."""
    heatmap: dict[date, int] = {}
    for a in attempts:
        heatmap[a.local_date] = heatmap.get(a.local_date, 0) + 1
    return heatmap


def compute_user_stats(attempts: Sequence[Attempt], today: date, taxonomy: Taxonomy) -> UserStats:
    """Reproduces liprep's ``getUserStatistics()``, quirks included (plan
    §4.4). ``taxonomy`` supplies skill/domain names and the known-domain set
    (S17) — this module has no I/O of its own (ADR 0017), so it cannot load
    ``config/assets/sat/taxonomy.yaml`` itself; the caller passes the
    already-loaded value object."""
    lookup = _build_lookup(taxonomy)
    sorted_attempts = _order_attempts(attempts)
    question_groups = _group_by_question(sorted_attempts)

    totals, ebrw_agg, math_agg, domain_aggs, skill_aggs = _per_question_pass(
        question_groups, lookup
    )

    global_bands: dict[int, _BandAgg] = {b: _BandAgg() for b in _BANDS}
    global_total_time, global_correct = _per_attempt_pass(
        sorted_attempts, ebrw_agg, math_agg, domain_aggs, skill_aggs, global_bands
    )
    # A skill first created in the per-attempt pass (S18) has no name yet.
    for code, sk in skill_aggs.items():
        if not sk.name:
            sk.name = lookup.skill_name(code)

    total_attempts_count = len(sorted_attempts)
    unique_questions_attempted = len(question_groups)
    domain_stats = _finalize_domain_stats(domain_aggs, lookup)
    skill_stats = _finalize_skill_stats(skill_aggs)
    weakest, strongest = _rank_skills(skill_stats)

    return UserStats(
        total_attempts_count=total_attempts_count,
        unique_questions_attempted=unique_questions_attempted,
        unique_correct=totals.unique_correct,
        unique_incorrect=totals.unique_incorrect,
        total_upsolved_count=totals.upsolved,
        first_try_overall_accuracy_pct=_pct(totals.first_try_correct, unique_questions_attempted),
        overall_accuracy_pct=_pct(global_correct, total_attempts_count),
        avg_time_seconds=_avg(global_total_time, total_attempts_count),
        current_streak_days=_current_streak(sorted_attempts, today),
        today=_today_stats(sorted_attempts, today),
        ebrw=_finalize_module_stats(ebrw_agg, "reading", domain_stats, lookup),
        math=_finalize_module_stats(math_agg, _MATH, domain_stats, lookup),
        difficulty_stats=_finalize_bands(global_bands),
        domain_stats=domain_stats,
        skill_stats=skill_stats,
        weakest_skills=weakest,
        strongest_skills=strongest,
    )
