"""The College Board skill taxonomy as a pure value object (plan.md §3.6 G6,
§4.2, §4.5; parity-inventory F7, F11-F13, X6).

Pure stdlib + pydantic (ADR 0017): no I/O, no yaml import. ``app/`` loads
``config/assets/sat/taxonomy.yaml`` and constructs a ``Taxonomy`` from the
parsed mapping — ``Taxonomy.model_validate(data)`` — this module only shapes
and reads it.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

from domain.sat.types import Module

DifficultyTier = Literal["Easy", "Medium", "Hard"]


class SkillDef(BaseModel):
    """One skill (leaf) of the taxonomy — F11-F12."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    name: str
    order: int


class DomainDef(BaseModel):
    """One domain, grouping skills within a module — F11-F12."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: str
    name: str
    order: int
    skills: tuple[SkillDef, ...]


class BandTier(BaseModel):
    """One difficulty-tier grouping of score bands (F7: Easy 1-3, Medium
    4-5, Hard 6-7); clicking a tier label toggles every band it lists."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    name: DifficultyTier
    bands: tuple[int, ...]


class ModuleDef(BaseModel):
    """One module (Reading & Writing or Math) — F11, X6's short/long
    section labels (dashboard card vs. practice top bar)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    code: Module
    short_label: str
    long_label: str
    order: int
    domains: tuple[DomainDef, ...]


class Taxonomy(BaseModel):
    """modules -> domains -> skills, with band tiers, exactly as College
    Board and liprep's ``TopicTree.ts`` name them. The single source G6
    compares the bank against, and ``/counts`` zero-fills against (F13: a
    skill with no matching question still shows 0)."""

    model_config = ConfigDict(extra="forbid", frozen=True)

    modules: tuple[ModuleDef, ...]
    band_tiers: tuple[BandTier, ...]

    def skill_codes(self) -> tuple[str, ...]:
        """Every skill code, in taxonomy display order (29 total)."""
        return tuple(
            skill.code
            for module in self.modules
            for domain in module.domains
            for skill in domain.skills
        )

    def skill_triples(self) -> frozenset[tuple[Module, str, str]]:
        """``(module, domain_cd, skill_cd)`` for every skill — G6's
        comparison set against the bank's distinct triples."""
        return frozenset(
            (module.code, domain.code, skill.code)
            for module in self.modules
            for domain in module.domains
            for skill in domain.skills
        )

    def find_skill(self, skill_cd: str) -> tuple[ModuleDef, DomainDef, SkillDef] | None:
        """The module/domain/skill definitions owning ``skill_cd``, or
        ``None`` when it is outside the taxonomy (S18)."""
        for module in self.modules:
            for domain in module.domains:
                for skill in domain.skills:
                    if skill.code == skill_cd:
                        return module, domain, skill
        return None

    def tier_for_band(self, band: int) -> DifficultyTier:
        """The Easy/Medium/Hard tier ``band`` (1-7) belongs to (F7)."""
        for tier in self.band_tiers:
            if band in tier.bands:
                return tier.name
        raise ValueError(f"score band {band} is not covered by any tier")
