# ADR 0001 — Primary user is the student applicant; MVP1 is "think + answer"

**Status:** Accepted

## Context
Counselle's ultimate goal is the perfect agent for answering anything about any university. The same data serves very different products depending on who the primary user is (student vs counselor vs parent), and we must scope a shippable MVP1.

## Decision
- **Primary user = the student applicant.** Optimize personality, defaults, and feature priority for a student.
- **MVP1 = a thinking/answering partner about schools** (the informational layer). No personalization, no chancing-math, no writing.
- **Wedge = the deep school dossier on demand** (ask about a school → complete, cited, honest profile fusing the DB + web + .edu + Reddit).
- **Deferred to later phases:** chancing, user-data personalization, agent long-term memory, essay/activity writing.

## Rationale
The student is the biggest market and the hardest to get right (high emotional stakes, low data literacy), which forces the best version of the product (clarifying questions, kind-but-honest answers, teaching as it answers). The killer student job (chancing/"where should I apply") needs the student's profile, which is deferred — but most of "what does it take to get in" needs zero user data (it's CDS/IPEDS admission data we already have), so MVP1 ships the chancing *knowledge* without the personal *math*. The dossier wedge leans on our unique asset: up to ~1,000 structured fields per school (a 1,093-field catalog).

## Alternatives considered
- Counselor / parent / persona-neutral primary user — rejected for MVP1 (smaller market or defers the hardest product decisions).
- Including "process management" (deadline tracking, task lists) — rejected; it's a different product. MVP1 answers about the process, it doesn't walk a student through theirs.

## Consequences
- Clarifying questions, source tiering, recency, tables, and in-session memory become first-class (see PRD).
- The architecture (retrieval layer) is built so personalization/chancing/memory/writing can be layered on later.

See `specs/mvp1/PRD.md` for the full feature list and decision history.
