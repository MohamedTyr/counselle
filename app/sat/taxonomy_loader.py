"""Loads ``config/assets/sat/taxonomy.yaml`` into a ``domain.sat.taxonomy.
Taxonomy`` value object (plan §4.1).

``domain/sat/taxonomy.py`` is pure (ADR 0017: no I/O, no yaml import) — this
is its one loader, mirroring ``counselle_db/catalog.py``'s
``_load_sections()`` for ``facts_sections.yaml``. Every other module reads
the already-constructed ``Taxonomy``, never the yaml file itself.
"""

from __future__ import annotations

from functools import lru_cache

from config.settings import load_yaml_asset
from domain.sat.taxonomy import Taxonomy


@lru_cache(maxsize=1)
def load_taxonomy() -> Taxonomy:
    """The College Board skill taxonomy, cached for the process lifetime —
    ``config/settings.py::reset_config_caches`` clears ``load_yaml_asset``'s
    cache, but not this one; callers that need a hot-reload (e.g. Settings
    tests) clear it directly via ``load_taxonomy.cache_clear()``."""
    return Taxonomy.model_validate(load_yaml_asset("sat/taxonomy"))
