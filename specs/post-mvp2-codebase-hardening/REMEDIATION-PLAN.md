# Counselle Remediation Plan — Master Index

**Status:** DRAFT (under plan-review consensus loop)
**Created:** 2026-06-16
**Owner of this document:** orchestrator (synthesis of Wave-1 Opus audit)
**Source findings:** `plans/audit/wave1/01..07-*.md` (7 independent Opus explorers)

> This is the canonical, phased remediation plan for the Counselle codebase. It
> exists to take the repo from "works but vibe-coded in places" to "100% better":
> correct, honest, modular, DRY, configurable, well-tested, and maintainable —
> **without changing what the product does**. Every change is behavior-preserving
> for the student-facing product *except* where a finding proves current behavior
> is itself a bug (a lie, a crash, a leak).

---

## 0. How to read this plan

The plan is split across files (this index + one file per phase) because it is
large and detailed by design. Each phase file is self-contained: it lists every
finding it owns, the exact problem, the **exact fix with code snippets**, the
**tests to add**, and **acceptance criteria**. An implementing agent should be
able to execute a phase file end-to-end without reading anything else except the
real code it is patching.

| File | Phase | Theme | Risk | Findings |
|------|-------|-------|------|----------|
| `phase-0-hygiene.md` | 0 | Repo hygiene + restore the quality gates | Low | mypy gate, `.gitignore`/`.dockerignore`, orphan files, dep hygiene, doc-count drift, eval baseline |
| `phase-1-lifecycle-correctness.md` | 1 | Turn-lifecycle correctness & safety (the CRITICAL + HIGH runtime bugs) | High | BC-01..BC-15 (ring buffer, cancel races, append-after-close, Last-Event-ID, pre-start writes, shutdown drain) |
| `phase-2-honesty.md` | 2 | Honesty integrity — the one non-negotiable | High | FE-C1, FE-H4, DS-01/02/03/08/10, FE-DUP-CITED-SCAN, BC-13 |
| `phase-3-backend-arch.md` | 3 | Backend architecture: single-owner persistence + lifecycle predicates, DRY, dead code | Med | H1/BC-09, H2/BC-11/BC-14, H3, H4, M1, M3, M4, M5, M7, L4, L5 |
| `phase-4-frontend-correctness.md` | 4 | Frontend correctness, resilience & UX/a11y bugs | Med | FE-FEEDBACK-STALE, FE-ATTACH-CURSOR, FE-H1, FE-H2, FE-H3, FE-H5, FE-SSE-NOSCHEMA, FE-M1..M9, FE-L1, FE-L3..L8 |
| `phase-5-frontend-arch.md` | 5 | Frontend architecture: de-god ChatContext, untangle mock/, dead code, source-config single-source, citation-context sprawl, vendor-fork decision | Med | FE-CHATCONTEXT-GOD, FE-CONSUMESTREAM-SIZE, FE-MOCK-MISLABEL, FE-DEADCODE-MOCK, FE-DEAD-CHATFORM, FE-DEAD-APPSHELL, FE-SOURCECFG-DUAL, FE-CITATIONS-CONTEXT-SPRAWL, FE-COUPLING, FE-TYPE-DERIVED-STORED, FE-EFFECT/MEMO/CONSOLE LOWs |
| `phase-6-configurability.md` | 6 | Configurability & dynamic config (your "no needless hardcoding" mandate) + security knobs | Low–Med | CFG-01..CFG-16, DS-04, DS-05, DS-06, DS-09, 06-L1 (CORS) |
| `phase-7-tests-docs.md` | 7 | Test coverage, eval scorer tests, structured logging, docs truth-up | Low | 06-H2, 06-L6, 06-L7, 06-L8, regression tests for every bug fixed in 1–6, eval re-baseline, docs sync |

**Phase ordering rationale (dependency-aware):**
hygiene first (so the gates are honest and searches are clean) → runtime
correctness (stop the crashes/leaks) → honesty (the product's soul) → backend
architecture (now safe to refactor on green tests) → frontend correctness →
frontend architecture → configurability (touches many files, do once the shapes
are stable) → tests/docs close-out (lock in everything with coverage + truthful
docs).

Phases are **mostly independent by file-set**, but later phases assume earlier
ones landed (e.g. Phase 3 extracts the persistence module that Phase 1's fixes
make safe to centralize; Phase 7 writes regression tests for fixes from 1–6).
**Do not reorder without re-checking the cross-phase notes in each file.**

---

## 1. Severity ledger (what we're fixing and why)

Counts across the 7 explorer reports (deduplicated; some findings appear in two
reports, e.g. the partial-persist duplication is both arch-H1 and correctness-BC-09):

- **CRITICAL (2):** BC-01 (ring-buffer OOM), FE-C1 (reveal mis-certifies external claims as verified DB data).
- **HIGH (≈23):** the cancel/terminal races (BC-02..BC-06), Last-Event-ID (BC-06), favicon privacy leak (FE-H1), elapsed-timer/keys (FE-H2/H3), no error boundary (FE-H5), DB-data overcount (FE-H4), feedback stale + attach cursor (FE), ChatContext god + mock-mislabel + vendor-fork (FE arch), mypy gate + eval scorers + eval baseline (hygiene), CFG-01/02/03 (config).
- **MEDIUM (≈42)** and **LOW (≈40+):** enumerated in the phase files.

**The non-negotiable (CLAUDE.md principle 3):** *never lie to a student.* Every
honesty finding (FE-C1, FE-H4, DS-01, DS-02, DS-03, DS-10, CFG-01, the
clarify-orphan BC-11, the transcript-drift risks H1/BC-09) is treated as
top-priority regardless of nominal severity.

---

## 2. The implementation methodology (MANDATORY — this is how the plan gets built)

> This section is binding on whoever executes the plan. The user's directive:
> **the orchestrator does no hands-on engineering — it only dispatches
> subagents.** Subagents do *everything*; the orchestrator reads their outputs,
> runs the review loop, and gates progression.

### 2.1 Branching

1. Before any code is touched, cut a single long-lived integration branch off
   `main`:
   ```bash
   git switch main && git pull --ff-only
   git switch -c refactor/codebase-hardening
   ```
2. Every phase is implemented and committed **on this one branch**, one commit
   (or a tight commit cluster) per phase, with a conventional-commit message:
   `refactor(phaseN): <summary>` / `fix(phaseN): ...` as appropriate.
3. The branch is **not** merged to `main` until all 8 phases are complete and the
   final full-suite gate is green. (If the user wants per-phase PRs instead, that
   is a one-line change to this protocol — but the default is one branch, phase
   commits, one PR at the end.)

### 2.2 The per-phase loop (run identically for every phase 0→7)

```
for phase in 0..7:
    1. DISPATCH IMPLEMENTERS (Opus):
       - Spawn one or more Opus subagents.
       - Each is handed the FULL phase file and told: "Implement EVERYTHING in
         this file. Miss nothing. Every finding, every code snippet, every test,
         every acceptance criterion. Do not stop until the entire phase file is
         done." Independent file-sets within a phase may be split across parallel
         Opus implementers; coupled changes go to one implementer.
       - Implementers write code + tests. They run the local gates for their
         scope before reporting back.

    2. GATE (orchestrator, via a cheap subagent or direct command run):
       - Run the phase's gate commands (see 2.4). If red, bounce straight back to
         an Opus fixer with the failure output before review. Reviewers only see
         green-gate diffs.

    3. REVIEW LOOP (Sonnet, >=3 reviewers, NON-LEADING prompts):
       - Spawn at least 3 Sonnet reviewers IN PARALLEL. Each independently
         reviews the phase DIFF against (a) correctness/quality/security and
         (b) — critically — "was EVERYTHING in the phase file actually
         implemented? enumerate any finding/snippet/test/acceptance-criterion
         that is missing, partial, or wrong." Reviewers must verify completeness,
         not just spot-check.
       - Each reviewer returns a verdict: SHIP / NO-SHIP + a list of must-fix
         items (with file:line).

    4. FIX (Opus):
       - If ANY reviewer says NO-SHIP, spawn one or more Opus fixers with the
         union of all reviewers' must-fix items. Fixers implement the fixes.
       - Re-run the GATE.

    5. RE-REVIEW:
       - Spawn a fresh set of >=3 Sonnet reviewers (or re-task the same ones) on
         the updated diff. Repeat FIX↔REVIEW until ALL >=3 reviewers return SHIP.

    6. COMMIT:
       - Only when all reviewers say SHIP and the gate is green, commit the phase.
       - Move to the next phase.
```

**Hard rules for the loop:**
- **Reviewers are Sonnet; implementers and fixers are Opus.** (Wave-1 explorers
  were Opus; that wave is done.)
- **>=3 reviewers per review round, minimum.** More is fine. Consensus = unanimous
  SHIP.
- **Non-leading review prompts.** Do not tell reviewers what you think is wrong or
  what to find. Tell them their job (review this diff against this phase file for
  correctness AND completeness) and let them form their own judgement. The prompt
  template is in §2.3.
- **A large part of every review is completeness verification** — the user's
  explicit ask: reviewers must check that what the phase file specifies was
  actually implemented, end to end, nothing skipped.
- **The orchestrator writes no code.** It dispatches, runs gates, relays
  must-fix lists, and gates progression.

### 2.3 Prompt templates (for the executing orchestrator)

**Implementer (Opus), per phase:**
> You are implementing Phase N of the Counselle remediation plan. Read
> `plans/audit/phase-N-*.md` IN FULL. Implement **everything** in it — every
> finding, every code change, every test, every acceptance criterion. Miss
> nothing. Where the phase file gives a code snippet, treat it as the intended
> shape but adapt to the real current code (read the actual files; the snippet
> may be slightly out of date). After implementing, run the gate commands listed
> in the phase file and fix anything red. Report: what you changed (file-by-file),
> the gate output, and any place you deviated from the phase file and why.

**Reviewer (Sonnet), per review round — NON-LEADING:**
> You are an independent reviewer. A change has been made on branch
> `refactor/codebase-hardening` implementing Phase N, specified in
> `plans/audit/phase-N-*.md`. Review the diff (`git diff main...HEAD -- <phase
> scope>` or the working tree) with complete freedom and your own judgement.
>
> **Building `<phase scope>`:** the path filter is the set of paths in the phase
> file's **"Scope & files touched"** section — pass each as a pathspec after the
> `--`. Worked example for **Phase 1** (lifecycle correctness):
> ```bash
> git diff main...HEAD -- app/turns.py app/records.py api/routes/sessions.py \
>   api/routes/me.py config/settings.py api/sse.py
> ```
> (Substitute the actual paths from the phase file you are reviewing.) Alternative
> if phases are committed one-tagged-commit-per-phase: review that commit directly
> (`git show <phaseN-tag>` / `git diff <phaseN-1-tag>..<phaseN-tag>`) instead of a
> path filter.
> Two responsibilities, weighted equally:
> (1) **Quality:** is the code correct, safe, idiomatic, free of regressions,
>     and does it actually solve the underlying problem (not paper over it)?
>     Hunt for bugs, races, missed edge cases, security issues, and sloppiness as
>     hard as you can — go wild, you are not constrained to the phase file.
> (2) **Completeness:** go through the phase file finding-by-finding and verify
>     each was ACTUALLY implemented — the code change, the tests, and the
>     acceptance criteria. Enumerate anything missing, partial, or incorrect with
>     file:line.
> Run the tests/gates yourself. Return a verdict: **SHIP** or **NO-SHIP**, and if
> NO-SHIP, a concrete must-fix list with file:line. Do not be polite — if it's
> not ready, say so.

**Fixer (Opus):**
> Reviewers returned NO-SHIP on Phase N with the must-fix list below. Address
> every item. Read the real code, fix properly (no band-aids), re-run the phase
> gate, and report what you changed per item.

### 2.4 Gate commands

Per-phase gate (run the subset relevant to the phase's scope; run the full set
before the final merge):

```bash
# Backend
uv run ruff check .
uv run mypy .                       # MUST be green after Phase 0 fixes it
uv run pytest -m "not live_llm and not live_search"   # routine suite
# Frontend
cd frontend && npm run typecheck && npm test && npm run build
```

Full pre-merge gate additionally runs `uv run pytest` (live) and
`uv run python -m evals.runner` to re-baseline (Phase 7).

### 2.5 Definition of done (whole plan)

- All 8 phases committed on `refactor/codebase-hardening`.
- `ruff`, `mypy`, routine pytest, frontend typecheck/test/build all green.
- Live pytest + eval run green, eval baseline re-committed (Phase 7).
- Every CRITICAL and HIGH finding closed; every MEDIUM either closed or
  explicitly deferred with a one-line rationale in the phase file and `TODOS.md`.
- No regression in the student-facing product (verified by the live-app E2E smoke
  in Phase 7).
- Docs (`CLAUDE.md`, `README.md`, `docs/ARCHITECTURE.md`, ADR count) match reality.

---

## 3. Finding → phase traceability matrix

Every finding from Wave-1 is assigned to exactly one phase (the phase file is the
authoritative spec). Cross-listed findings note their twin.

| Finding(s) | Phase | Note |
|---|---|---|
| 06-H1 mypy gate red | 0 | unblocks the type gate for all later phases |
| 01-L1 / 06-M3 / 06-M5 / 06-L9 repo hygiene (`.worktrees`, screenshots, `.agents`/`.claude`, stale worktrees) | 0 | |
| 06-M7 `.dockerignore`; 06-M4 skills-lock; 06-M6 README db cmd | 0 | |
| 06-M1 ADR count; 01-L2 tool count; 01-L3 thinking_summaries doc | 0 | doc-drift batch |
| 06-L2/L3/L4/L5/L8 dep hygiene (psycopg, yoyo extra, anyio, bandit, pytest-cov) | 0 | 06-L8 = `pytest-cov` dep + canonical `[tool.coverage]` config + `.coverage*` gitignore land HERE; Phase 7 only adds the README `--cov` doc + targets |
| 06-H3 eval baseline/count drift | 0 | (re-baseline run itself happens in Phase 7) |
| BC-01 ring buffer OOM (CRITICAL) | 1 | |
| BC-02 consumer leak; BC-03 double cancel; BC-04 drive-finally terminal; BC-05 append-after-close; BC-06 Last-Event-ID future seq; BC-07 observe blocking | 1 | |
| BC-08 watchdog persist hang; BC-10 `_turns` lock; BC-12 pre-start writes; BC-15 shutdown drain mislabel | 1 | |
| BC-16..BC-21 LOW lifecycle | 1 | |
| FE-C1 reveal external-as-DB (CRITICAL) | 2 | |
| FE-H4 DB-data overcount; FE-DUP-CITED-SCAN (04-LOW) | 2 | |
| DS-01 coded int raw; DS-02 off-domain official tier; DS-03 query_database bypass; DS-08 benchmark BBRR; DS-10 percent range | 2 | |
| BC-13 receipt result_count omission | 2 | honesty (receipt fidelity) |
| H1 / BC-09 single persistence module | 3 | twin finding |
| H2 lifecycle predicates owner; BC-11 resume-failure orphan; BC-14 parked OR desync | 3 | twin/related |
| H3 cross-route private import; H4 reconcile ×3; M1 catalog concurrency; M3 run_turn decomposition | 3 | |
| M4 school columns const; M5 api/usage shim; M7 DoneStatus/TurnStatus; L4 coupled caches; L5 EmissionRouter default-kind | 3 | |
| FE-FEEDBACK-STALE; FE-ATTACH-CURSOR | 4 | |
| FE-H1 favicon privacy; FE-H2 useElapsed; FE-H3 ThinkNode key; FE-H5 error boundary; FE-SSE-NOSCHEMA | 4 | |
| FE-M1..M9 (a11y/UX/CSP); FE-L1, FE-L3..L8 | 4 | CSP (FE-M9) coordinates with Phase 6; FE-L2 moved to Phase 5 (= FE-EFFECT-DEP-THROTTLE) |
| FE-CHATCONTEXT-GOD; FE-CONSUMESTREAM-SIZE; FE-TYPE-DERIVED-STORED | 5 | |
| FE-MOCK-MISLABEL; FE-DEADCODE-MOCK; FE-DEAD-CHATFORM; FE-DEAD-APPSHELL | 5 | |
| FE-SOURCECFG-DUAL; FE-CITATIONS-CONTEXT-SPRAWL; FE-COUPLING | 5 | |
| FE-EFFECT-DEP-THROTTLE; FE-PROVIDER-VALUE-MEMO-DEP; FE-CONSOLE-WARN | 5 | |
| CFG-01 school count (live-from-DB); CFG-02 getattr literals; CFG-03 password len | 6 | CFG-01 is honesty |
| CFG-04 favicon DRY; CFG-05 vite proxy; CFG-06 compare caps; CFG-07 thinking threshold; CFG-08 embed retry; CFG-09 title prompt asset; CFG-10 FE timeouts | 6 | |
| CFG-11..CFG-16 LOW; the LA-1..8 leave-alones (documented, NOT changed) | 6 | |
| DS-04 OAuth unverified linking; DS-05 tavily `.env` (= 06-M2); DS-06 rate-limit health; DS-09 oauth state secret; 06-L1 CORS default | 6 | security knobs |
| 06-H2 eval scorer tests; 06-L6 structlog; 06-L7 viz/service coverage; 06-L8 (dep+config in Phase 0; docs/targets here) | 7 | |
| Regression tests for every Phase 1–6 fix; eval re-baseline; docs truth-up | 7 | |

**Explicit "accept / leave-alone" (do NOT fix — recorded so reviewers don't flag
them as misses):** 01-M2 (double catalog load — inherent to two-process design),
01-M6 (per-turn agent rebuild — LangGraph replay pattern), 01-L6 / DS-07 (regex
SQL guard is belt-and-suspenders; the RO role is the real control), all of
`07`'s LA-1..LA-8 (BATCH_SIZE, protocol_version, R1–R12 logic, IPEDS schema
constants, JWT min bytes, SameSite=lax, `domain/urls.py` constant, container
`0.0.0.0` bind), DS-11 (catalog serves stale data on refresh failure — serve-stale
is the correct availability tradeoff; monitored via /v1/health; no code change).
Each phase file restates its own leave-alones.

---

## 4. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| A lifecycle refactor (Phase 1/3) introduces a new transcript/honesty bug | Med | High | Phase 1 adds regression tests for each race *before* Phase 3 centralizes; reviewers explicitly check the "prose invariant"; Phase 7 re-runs evals |
| ChatContext split (Phase 5) regresses streaming/identity reconciliation | Med | High | It's the highest-risk FE file; Phase 4 lands the FE correctness tests first; the split is extraction-only (no behavior change); reviewers diff behavior |
| Over-configuring invariants (Phase 6) adds noise | Low | Low | The leave-alone list is binding; reviewers reject config added to true invariants |
| Vendor-fork decision (FE-COUPLING) balloons into a rewrite | Med | Med | Phase 5 scopes it to a *decision + documentation* (+ targeted decouple of the worst imports), not a full re-vendor |
| Phases drift out of sync as code changes underneath | Med | Med | Implementers are told the snippet is a guide; read real code. Reviewers verify against current code, not the snippet verbatim |
| The eval re-baseline shifts scores and hides a real regression | Low | High | Phase 7 diffs against the prior baseline and requires human-readable justification for any score drop |

---

## 5. Non-goals (explicit scope fence)

- **No new product features.** This is a hardening/refactor pass. Deep research
  (PRD 39–41) and deploy (B6/B7) stay deferred.
- **No re-vendor of LibreChat upstream.** FE-COUPLING is resolved by a documented
  ownership decision, not an upstream resync.
- **No swap of the stack** (PydanticAI/LangGraph/FastAPI/React) — ADR-locked.
- **No change to the wire protocol version.** Fixes stay within protocol v1
  (BC-06's fix is a server-side relevance check, not a wire change).
- **No production deploy.** Out of scope; deploy items (CSP server headers, prod
  CORS, OAuth verification) are *prepared* and tracked, not shipped live.
</content>
</invoke>
