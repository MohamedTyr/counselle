"""Hand-authored crosswalk adjudication decisions (plan §2/§4.6).

Every slug the ladder's six automatic stages could not resolve
(``artifacts/school-data-v3/crosswalk/shortlist.md`` after ``ladder`` runs,
351 rows total: 347 with a plausible shortlist + 4 with none) was reviewed by
hand against its shortlist and, where the shortlist itself was too thin to
trust, against a direct query of ``cds_library.schools`` by name/city — never
guessed, never resolved by an LLM at build time (D7). ``None`` means "no
Title-IV IPEDS row for this school" or "genuinely ambiguous, left unmatched
on purpose" — the reason always goes in the note.

The actual decisions live in two sibling modules (kept under the 800-line
guideline each): ``crosswalk_adjudication_matched.py`` (CUNY senior colleges,
renames, and multi-campus collapse) and ``crosswalk_adjudication_unmatched.py``
(no plausible candidate / declines-Title-IV / plan-confirmed unmatchable).
This module only merges them and documents the recurring patterns once:

- **Multi-campus collapse.** Many for-profit/public chains list one
  CollegeData slug per physical campus, but IPEDS reports only one unitid
  for the whole chain/state/system (Chamberlain and DeVry: one unitid per
  *state*; Keiser, ECPI, Dallas College, Georgia Military College, Baker
  College, Everglades University, Troy University, Washington State
  University, Utah State University, San Jacinto College, University of
  Alaska Southeast, University of the Virgin Islands, Vermont State
  University, PennWest: one unitid *nationally*/system-wide). Every branch
  slug of such a chain is mapped to that one shared unitid, method
  ``manual``; ``build_crosswalk.py merge``'s
  ``_dedupe_unitid_collisions`` keeps exactly one live row (best method
  rank, then slug) and demotes the rest to ``unmatched`` automatically —
  this file only needs to assert the shared unitid, not pick the winner.
- **CUNY senior colleges.** CollegeData's "``X`` College (City University of
  New York)" name pattern scores *higher* trigram similarity against
  unrelated NYC private universities (they share "city ... university ...
  new york") than against the correct ``CUNY X College`` IPEDS row — a
  known trigram pitfall, not a real signal. Resolved by direct name lookup.
- **Renames.** Several schools changed their catalog name after the IPEDS
  snapshot's ``search_name``/``name`` was set (Buffalo State College ->
  SUNY Buffalo State University; College of Mount St. Vincent -> University
  of Mount Saint Vincent; MCPHS; Tallahassee Community College ->
  Tallahassee State College; Concordia University St. Paul's punctuation).
- **Declines Title IV by policy.** Grove City College, Hillsdale College,
  and Pensacola Christian College refuse federal funding on principle and
  are consequently absent from the IPEDS/Title-IV universe entirely — not
  a crosswalk failure, a real absence.
- **Plan-confirmed unmatchable** (§4.6): American Islamic College, Doral
  College, Global University, Patrick Henry College, Reformed University.

``scripts/build_crosswalk.py merge`` is the only importer of ``ADJUDICATED``.
"""

from __future__ import annotations

from scripts.crosswalk_adjudication_matched import MATCHED
from scripts.crosswalk_adjudication_unmatched import UNMATCHED

# slug -> (unitid | None, note). Every slug appears in exactly one of the two
# sibling modules -- a duplicate would silently let one shadow the other, so
# this asserts disjointness once at import time rather than trusting it.
_overlap = set(MATCHED) & set(UNMATCHED)
if _overlap:
    raise ValueError(f"slugs present in both MATCHED and UNMATCHED: {sorted(_overlap)}")

ADJUDICATED: dict[str, tuple[int | None, str]] = {**MATCHED, **UNMATCHED}
