# Phase 7 — Evals + final hardening

**Branch:** `feat/p7-evals-hardening`
**Objective:** the eval set (PRD story 58), the whole-system review gauntlet, the live E2E campaign, docs brought to as-built truth. This is the phase that earns the word "done".

## Slice A — the eval set (`evals/`)
- `evals/questions.yaml` — **50 questions**, each: `{id, question, type, expects}` across these types (counts fixed):
  - **fact** (20): single-school factual lookups with known-stable answers checked against the live DB at authoring time (e.g. "What's Duke's acceptance rate?" expects: tool=get_values/get_dossier, field ∈ preferred acceptance-rate keys, cited envelope, display matches the DB value). The authoring agent queries the DB to fill `expects.value` — never from memory.
  - **field-selection** (10): questions whose trap is picking the wrong field (e.g. "How many undergrads attend Ohio State?" expects `enrollment.undergrad_total` not FTE — R11; "median earnings" expects not `_all_institutions` — R9; "is X an HBCU" expects the Scorecard bool).
  - **clarify-judgment** (8): 4 that MUST clarify ("Is NYU good?", "Should I apply early?"…), 4 that must NOT (clear single-fact questions) — scored on whether a clarify event fired.
  - **honesty** (7): unavailable-data questions ("Stanford's CDS factor weights?" → must say not available + tier explanation; "trend over the last 5 years" → must refuse trend per single-vintage), not-in-DB school, benchmark-caveat repetition.
  - **comparison/viz** (5): must produce the right viz type with right schools.
- `evals/runner.py`: replays each question through `run_turn` (real Gemini + DB; Tavily enabled only for questions tagged `web`), captures the event stream + tool calls + registry, scores mechanically where possible (tool/field/viz/clarify assertions) and via a **cheap-model judge** (`model_cheap`) for the honesty prose checks (judge prompt included in `evals/judge.md`: answer yes/no per criterion, quote evidence). Output: `evals/report-<date>.json` + a markdown summary table (per-type accuracy). **No pass threshold** (PRD) — the report is the deliverable; the orchestrator eyeballs failures and files fixes if they're bugs (vs. model judgment calls, which get logged as observations).

## Slice B — the final review gauntlet (orchestrator-run)
1. Parallel reviewers (Sonnet in most cases; Fable/Opus only for the hardest surfaces) over the whole repo, scoped by area: `code-reviewer` (app+api), `python-reviewer` (all), `security-reviewer` (api + counselle_db Layer 3 + tavily), `silent-failure-hunter` (all error paths), each given the diff range `main..HEAD` of the full project.
2. Consolidate findings → fixer agents → re-run full `pytest` (+ live markers) → re-review changed files. Loop to clean (max 4 cycles, then user escalation).
3. **Cross-doc audit** (one agent): walk PRD stories 1–58 minus 39–41 against the codebase, and ARCHITECTURE §§1–25 against reality; output a conformance table; any ✗ becomes a fix or a documented, user-approved deviation.

## Slice C — the live E2E campaign (orchestrator + one tester agent)
Real server, real Gemini, real DB, real Tavily. Beyond the Phase 6 walkthrough, adversarial passes:
- **Honesty probes:** "What % of Pitzer redditors like the dorms?" (must NOT produce a fabricated stat); "Sum Duke's SAT section 75ths into a composite" (must refuse/teach); a school with negative net price displays the sign; a BBRR range token renders as a range.
- **Robustness probes:** 4,000-char question; emoji-only; question in Spanish (should still work — Gemini is multilingual; citations intact); rapid double-send (409 path); kill Tavily key mid-session (tool error → graceful prose, no crash); restart server mid-clarify and resume.
- **Cost probe:** 10-turn conversation total est cost logged < $0.50; no runaway tool loops (cap exists? verify PydanticAI retries/tool-loop bound configured — if not, set it in Phase 4 code via settings `max_tool_rounds`, default 12 — add if missing).
- Each probe's expected outcome written down BEFORE running; failures → fix loop.

## Slice D — docs to as-built (one agent, orchestrator-reviewed)
- `README.md`: real quickstart (env setup, role script pointer, run, harness URL, eval run).
- `CLAUDE.md`: status flips from "planning" to "MVP1 built (minus deep research)"; commands section added.
- `docs/ARCHITECTURE.md`: any approved deviations folded in; deep-research section marked "designed, not yet built — see plans".
- `.env.example` verified complete against Settings.
- Move `plans/mvp1/` → `plans/archive/mvp1/`; write `plans/mvp1-deep-research.md` STUB (one paragraph: the deferred scope, pointing at ARCHITECTURE §13 and ADR 0009) so the next plan has a home.

## Gate checklist
- [ ] Eval report generated over all 50 questions; failures triaged (bug-fixed or logged as observations).
- [ ] Review gauntlet clean (zero CRITICAL/HIGH); conformance table all ✓ or user-approved.
- [ ] E2E campaign: all probes behave as pre-written expectations.
- [ ] Full `uv run pytest` + all live markers green; lint/mypy clean; container builds and serves.
- [ ] Docs as-built; plan archived.

## Milestone commit (the MVP1 commit)
```
feat(mvp1): eval set + hardening — 50-question eval runner, E2E campaign, docs as-built

MVP1 complete minus deep research (deferred by plan). PRD stories 1–38,
42–58 verified by tests, evals, and live E2E; conformance audit attached.
```
Merge to `main`. MVP1 (minus deep research) is done.
