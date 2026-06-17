# Plan — Delete the `score_band` visualization

Branch: `feat/viz-design-polish` (main working tree). Scratch plan; graduates or is deleted when done.

## 1. Problem statement

The `score_band` viz (SAT/ACT middle-50% bands) adds nothing a `stat_block` / `comparison_table` can't already express in prose + tables, and the iterated redesign this session did not change that calculus. Remove it **completely** across backend, frontend, agent prompt/skill, tests, and living docs, with **zero** dead code, dead imports, dead CSS, or orphaned helpers. The two remaining viz types (`stat_block`, `comparison_table`) must keep working unchanged.

**Non-goals.** Touching `.worktrees/` (other branches). Retro-editing `specs/` or eval reports (historical records). Deleting `VizPlaceholder.tsx` wholesale (already dead but out of scope; we only prune its `score_band` entry). Re-homing the SAT-composite honesty guarantee into a new mechanism (it survives as prose guidance in the prompt/skill; the tool-level validator simply retires with the type).

## 2. The ADR decision

Deleting a viz type reverses part of **ADR 0014** (the 3-viz RenderSpec + the SAT-composite honesty trap). Per CLAUDE.md ("do not silently break an ADR; a changed decision is a new ADR"):

- **Write ADR 0024 — Remove `score_band` from the viz catalog.** Context (it duplicates table/stat capability), decision (`type` narrows to `{stat_block, comparison_table}`), consequence (the SAT-composite honesty trap is no longer a tool validator; it lives as prompt/skill prose), supersedes-note to 0014.
- **ADR 0014:** edit the **Status line only** to `Accepted (score_band partially superseded by ADR 0024)`. Body is historical — untouched.
- **adr/README.md:** correct the 0014 summary row, add the 0024 row.

## 3. Ordered task list (dependencies marked)

Order matters: backend type + frontend type must drop the `band` field / `score_band` member **together** (wire-contract sync), but since fixtures carry no `score_band` the two sides only need to land in the same commit, not in a strict sequence. Tests are updated in the same pass as the code they cover.

1. **Backend code** (`domain/specs.py`, `app/viz.py`, `app/agent_node.py`) — remove model, validator, builder, constants, `test` param chain; fix the `_build_spec` fallthrough. [depends: none]
2. **Backend assets** (`config/assets/prompts/counselor.md`, `config/assets/step_labels.yaml`, `skills/dossier-assembly/SKILL.md`) — remove agent-facing score_band. [depends: none]
3. **Backend tests** (`tests/domain/test_specs.py`, `tests/app/test_viz.py`, `tests/app/test_live_llm.py`, `tests/app/test_records.py`, `tests/app/test_steps.py`) + **evals** (`evals/questions.yaml`). [depends: 1]
4. **Frontend code** (`protocol.ts`, `VizCard.tsx`, `vizMeta.ts`, `VizPlaceholder.tsx`) + **delete** `ScoreBandCard.tsx`, `SchoolChip.tsx`. [depends: none, but land with 1 for wire sync]
5. **Frontend session-revert** (`VizPreview.tsx` fixtures, `counselle.css` keyframes/classes). [depends: 4]
6. **Frontend tests/fixtures** (`honesty.test.tsx`, `protocol-fixtures.test.ts`, `mock/fixtures/turns/dossier.ts`). [depends: 4]
7. **Living docs** (`ARCHITECTURE.md`, `adr/0002`, `adr/0014` status, `adr/README.md`) + **ADR 0024 (new)**. [depends: 1–6 conceptually]
8. **Scratch** (`TODOS.md`, this plan, the stray PNGs). [depends: none]
9. **Verify** — see §6.

## 4. File change manifest (every change, classified)

### Backend — DELETE-WHOLE / EDIT

| File | Change |
|---|---|
| `domain/specs.py` | DELETE `class ScoreBand` (85–89), the `band: ScoreBand \| None` field (99), the `_reject_fabricated_sat_composite` model_validator (101–116). EDIT `type` Literal → drop `"score_band"` (95); remove now-unused `model_validator` from the pydantic import (11); trim the score-band sentence from the module docstring (1–7). |
| `app/viz.py` | EDIT import (25) drop `ScoreBand`; EDIT `VizType` Literal (30) drop `"score_band"`. DELETE `TestName` (31), `_SAT_BAND_ROWS` (34–37), `_ACT_BAND_ROWS` (38–40), `_BAND_ROWS` (41–45), `_TEST_DISPLAY` (46), `_score_band_spec` (134–163). EDIT `_build_spec`: drop the `test` param (171) and **replace the `_score_band_spec` fallthrough (176–180) with `raise ServiceError(f"unknown viz type: {type!r}")`**. EDIT `render_viz`: drop the `test` param (190) and the `score_band` clause in its docstring (203–204). |
| `app/agent_node.py` | EDIT the inner `render_viz` closure: drop `test` param (158) and the `test` arg in the `viz_mod.render_viz(...)` call (162). `VizType` annotation (155) stays valid. |
| `config/assets/prompts/counselor.md` | DELETE the score-band viz paragraphs (≈77–83). Keep general "numbers never appear in prose for viz" rule. |
| `config/assets/step_labels.yaml` | DELETE `score_band:` key under `viz_labels` (94). Safe — `steps.py` uses `.get(..., "visualization")`. |
| `skills/dossier-assembly/SKILL.md` | EDIT line 45: replace the `render_viz(type="score_band", …)` instruction with prose-only "describe SAT/ACT middle-50% from field values; teach the meaning inline." |

### Backend tests / evals

| File | Change |
|---|---|
| `tests/domain/test_specs.py` | DELETE `ScoreBand` import (13), the `_score_band_spec` helper (48–55), both score_band tests (81–117). |
| `tests/app/test_viz.py` | DELETE the `# --- score_band ---` section + its 2 tests (127–168). |
| `tests/app/test_live_llm.py` | DELETE `test_6_stanford_sat_range_renders_section_bands` (259–280). |
| `tests/app/test_records.py` | EDIT line 115: `{"type": "score_band"}` → `{"type": "stat_block"}` (type string is arbitrary here). |
| `tests/app/test_steps.py` | EDIT `test_detail_for_viz_kind` (278–282): `"score_band"` → `"comparison_table"`. |
| `tests/app/test_protocol_fixtures.py` | EDIT line 107: delete the `band=None,` kwarg from `_CANNED_SPEC`. EDIT line 68: delete the `test: Any,` param from the `fake_build_spec` monkeypatch — it mirrors `_build_spec`'s signature, so once the real call (`viz.py:207`) drops `test`, the mock must too or it errors on arity. Both edits land with task 1. |
| `evals/questions.yaml` | DELETE `viz-stanford-sat-band` (435–440) and `viz-mit-act-band` (456–461). |

### Backend — golden protocol fixtures (regenerate, do NOT hand-edit)

The committed golden fixtures carry a serialized `"band": null` on the stat_block spec: `tests/fixtures/protocol/turn_full.json:108` and `tests/fixtures/protocol/transcript.json:51`. Once `band` leaves the Pydantic `RenderSpec`, the dumped payload omits it and the `payload == committed` golden assert in `test_protocol_fixtures.py` fails. **Fix by regeneration, not by hand:** after the backend `band` removal (task 1) and the `_CANNED_SPEC` edit above, run

```
REGEN_PROTOCOL_FIXTURES=1 uv run pytest tests/app/test_protocol_fixtures.py
```

which rewrites both JSON files (dropping the `"band": null` lines), then re-run the frontend `protocol-fixtures.test.ts` to confirm the TS types still accept the regenerated payloads. This is a dependency: regen must happen AFTER the Python `RenderSpec.band` removal and the TS `band` removal are both in place.

### Frontend — DELETE-WHOLE

| File | Change |
|---|---|
| `src/components/cards/ScoreBandCard.tsx` | DELETE whole file. |
| `src/components/cards/SchoolChip.tsx` | DELETE whole file (orphaned — sole consumer was ScoreBandCard; no tests). |

### Frontend — EDIT

| File | Change |
|---|---|
| `src/api/protocol.ts` | DELETE `TestPolicy` type (session add) + `ScoreBand` type; EDIT `RenderSpec.type` union drop `'score_band'`; DELETE the `band?: ScoreBand \| null` field. |
| `src/components/cards/VizCard.tsx` | DELETE the `ScoreBandCard` import + the `case 'score_band'`. |
| `src/components/cards/vizMeta.ts` | DELETE the `score_band` entry; remove now-unused `Ruler` from the lucide import. |
| `src/components/viz/VizPlaceholder.tsx` | DELETE the `score_band` `TYPE_LABELS` entry + the score-band mention in the comment. (Do not delete the file.) |
| `src/app/VizPreview.tsx` | DELETE the 3 score-band fixtures (`scoreBand`, `scoreBandRequired`, `scoreBandBlind`) + their `<VizCard>` usages (session adds). |
| `src/styles/counselle.css` | DELETE the session-added block: `@keyframes counselle-bar-rise`, `counselle-fade-in`, `.counselle-bar`, `.counselle-crest` and their comment, plus the `.counselle-bar, .counselle-crest` rule inside the reduced-motion `@media` block. |
| `src/components/cards/__tests__/honesty.test.tsx` | DELETE the `describe('score band', …)` block (131–176); 4 other describes survive. (Also retires the pre-existing caption-string mismatch.) |
| `src/test/protocol-fixtures.test.ts` | EDIT line 131: drop `'score_band'` from the `assertRenderSpec` type array. |
| `src/api/mock/fixtures/turns/dossier.ts` | DELETE the `SCORE_BAND` fixture + the `s7` step start/end events + the `viz` event referencing it; DELETE the now-invalid `band: null` lines on `STAT_BLOCK` (153) and `COMPARISON` (230); fix the factory comment. |

### Docs — UPDATE-LIVING / NEW

| File | Change |
|---|---|
| `docs/adr/0024-remove-score-band.md` | **NEW** ADR (see §2). |
| `docs/adr/0014-visualization-render-spec.md` | EDIT Status line only. |
| `docs/adr/README.md` | EDIT 0014 summary; ADD 0024 row. |
| `docs/adr/0002-tracked-schools-only-scope.md` | EDIT line 32: remove "the score band and". |
| `docs/adr/0020-frontend-librechat-clone.md` | EDIT line 13 (Decision #5, Counselle-native component list): remove "score band, ". |
| `docs/ARCHITECTURE.md` | §17: line 402 has TWO score_band references — the "**Three** visualization types … score-range band" sentence AND the community-card `RenderSpec.type accepts only stat_block \| comparison_table \| score_band` clause; fix both ("Three"→"Two", drop score_band from the union). Line 406 the `type ∈ {…}` Mechanism expression. Lines 408 + 412–413 the field-ownership + honesty-trap paragraphs. §31.2 (769) drop "the score band". §34 (862) is a semicolon clause (not a bullet) — drop "the score band never composes a 1600 and always shows the teaching caption;". After each excision, ensure the surrounding sentence still reads cleanly (esp. the line-408 field-ownership sentence, which becomes single-clause). Add "see ADR 0024". |

### Scratch / artifacts

| File | Change |
|---|---|
| `TODOS.md` | EDIT line 26 type union → `stat_block \| comparison_table`. |
| `plans/feat-viz-design-polish.md` | Note score_band deleted (non-goal at 17, behavior at 101). |
| `src/api/mock/fixtures/turns/dossier.ts` factory comment (22) + `usage.tool_calls` count | Update the comment to drop "score-band"; decrement `tool_calls` to match the events left after the s7 viz step is removed. |
| `density-nyu.png`, `scoreband-light.png`, `sharp-bars.png` (repo root) | DELETE stray screenshot artifacts. |

### LEAVE-HISTORICAL (explicitly no edits)

`specs/mvp1/PRD.md`, `specs/mvp2/PRD.md` (story 33), `specs/mvp2/architecture.md`, `specs/mvp1/plan/phase-{1,4,6}.md`, `specs/mvp2/plan/frontend-plan.md`, `specs/mvp2/plan/wire-contract.md`, `evals/report-2026-06-11.{md,json}`.

## 5. Decommission hazards (and how the plan handles each)

- **H1 — `_build_spec` fallthrough.** The score_band branch is the implicit `else`; deleting `_score_band_spec` would leave a `NameError`. → Replace with explicit `raise ServiceError("unknown viz type: …")`. The validator already rejects bad types at spec-construction, but the builder runs first, so the raise is required.
- **H2 — `test` param chain.** Flows `render_viz → _build_spec → _score_band_spec` (+ the `agent_node` closure + the `viz.py:207` call site). ALSO mirrored by the `fake_build_spec` monkeypatch (`test_protocol_fixtures.py:68`). Remove from **all** of these in one pass; mypy catches the app-side, but the monkeypatch arity error only shows at pytest runtime — so it's listed explicitly in the manifest.
- **H3 — unused `model_validator` import** in `domain/specs.py` after the validator goes. → Drop from the import (ruff/mypy would flag it).
- **H4 — wire-contract `band` field.** Removing `band` from `RenderSpec` changes the JSON shape, mirrored in the TS `RenderSpec`. Golden fixtures carry no score_band *event*, but they DO serialize `"band": null` on the stat_block spec (`turn_full.json:108`, `transcript.json:51`) and `_CANNED_SPEC` passes `band=None` (`test_protocol_fixtures.py:107`). So: drop the `band=None` kwarg, then **regenerate** the goldens via `REGEN_PROTOCOL_FIXTURES=1` (do not hand-edit). Backend + frontend `band` removal land in the **same commit**; the regen runs after both.
- **H5 — `dossier.ts` `band: null`.** Once `band` leaves the TS `RenderSpec`, the `band: null` on `STAT_BLOCK`/`COMPARISON` becomes a type error → delete those two lines.
- **H6 — single source of truth is duplicated.** Backend: `domain/specs.py` Literal, `app/viz.py` Literal, `render_viz.__doc__`, `counselor.md`, `step_labels.yaml`. Frontend: `protocol.ts` union, `VizCard` switch, `vizMeta`, `VizPlaceholder`, `protocol-fixtures.test.ts` array, `dossier.ts`. All listed in §4 — update in lockstep.
- **H7 — degrade path.** Any stray runtime `score_band` event now hits the markdown fallback (PRD story 35) — no crash. Acceptable.

## 6. Verification (gate before "done")

1. `REGEN_PROTOCOL_FIXTURES=1 uv run pytest tests/app/test_protocol_fixtures.py` → rewrites the golden JSON (drops `"band": null`); then confirm `git diff tests/fixtures/protocol/` shows ONLY the two `"band": null` lines removed (no other drift).
2. `uv run ruff check . && uv run mypy .` → clean (catches unused imports/params, the `_build_spec` missing branch).
3. `uv run pytest -m "not live_llm and not live_search"` → green.
4. `cd frontend && npm run typecheck && npm test` → green (catches dead imports, the `band` removal, pruned test arrays, the regenerated fixtures).
5. `grep -rniE "score.?band" app domain config skills frontend/src tests evals docs` (all file types, no `--include` filter) → only the **new ADR 0024**, the 0014 status note, README/ARCHITECTURE/0002/0020 removal notes remain; **zero** live code/asset references. PLUS `grep -rn '"band"' tests/fixtures/` → empty.
6. Manual: `/viz-preview` renders the two remaining cards; no console error.

## 7. Risk register

1. **Partial type-chain edit** (H2) leaves a compile error. Mitigation: mypy + frontend typecheck in §6 are hard gates.
2. **Over-deletion of a shared helper** (e.g. mistaking `SchoolLogo`/`vizVariant`/`vizTitle` for orphaned). Mitigation: investigators traced usages; only `SchoolChip` + `Ruler` + the two TS types + session CSS are orphaned — everything else is confirmed shared.
3. **ADR omission** — silently breaking 0014. Mitigation: ADR 0024 + 0014 status note + README row are explicit tasks.
4. **Missed duplicate** of the viz-type list. Mitigation: H6 enumerates all 11 sites; §6 grep is the backstop.
