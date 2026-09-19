"""SAT practice domain package (plans/sat-practice/plan.md §4.1).

Pure stdlib + pydantic (ADR 0017): no I/O, no ``app``/``adapters``/``api``
imports. ``types.py`` holds the frozen data models every other ``domain/sat``
module and ``app/sat`` service is built against; ``taxonomy.py`` holds the
pure ``Taxonomy`` value object over the College Board skill tree.
"""
