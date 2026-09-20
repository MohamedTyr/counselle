# SAT practice plan — review log

## Round 1 (2 reviewers, Opus) — draft v1 → v2
Verdicts: technical PASS-WITH-FIXES (3 blockers) · parity PASS-WITH-FIXES (2 blockers) · UI/UX FAIL.

Changed in v2:
- G9 rewritten as a projection comparison with a committed DIFFERENCES.md; harness reaches private upstream functions through a hash-pinned 3-line export patch.
- bank-sync: COUNSELLE_DB_APP_DSN, after `yoyo apply`, and in dev.py `run_stack`.
- Identity: `questionId` is assessment-scoped; G2 restated on content ids; `external_id`/`ibn` UNIQUE; `"" → NULL`.
- SPR: measured a 123-question sample — official keys already list accepted forms. Rationale mining demoted to a cross-check (G10); a key of "0" is a real answer; College Board's published entry rule added to grading as O7.
- Counts SQL: explicit casts, all 29 skills returned, one definition of "latest".
- Raw archive never committed; bank file out of git until O5; O5 no longer blocks development.
- Own error mapping + own rate buckets; read limit on /questions/{id}.
- Metadata/content table split; FK `(id)`; enum checks moved to app code.
- html-react-parser dropped; G5 now runs the real renderer over the corpus.
- Highlighter stores offsets, passage + stem only (options are not highlightable upstream).
- Desmos docking via measured rect; post-redirect URL pinned; windows resizable (Q35a).
- D6: session fetched once and frozen; reducer keyed by question_id; result overlay for navigator badges.
- Dashboard pane order follows upstream; SegmentedControl `columns` prop (E-3).
- Colour: §3.1 collision resolved (neutral difficulty beside status hues); figure outline tokenised.
- Motion: DESIGN.md governs; no press scale, no stagger, no off-scale easing.
- Analytics: mobile design, all five tabs specified, chart constants (S13–S15), donut slice relabelled, KPI secondary data kept, reset guard = three presses + alertdialog.
- Inventory: F8, F14a, F18, Q5a, Q17, Q24, Q27, Q33, Q35a, A4, A13a, A14, S12–S16, X5, X6, O5–O7 corrected or added.

## Round 2 (6 reviewers, Opus) — v2 → v3
Verdicts: inventory/practice INCOMPLETE (21 missing, 7 wrong) · inventory/dashboard+analytics INCOMPLETE (12 missing, 9 wrong) · product journeys SAME PRODUCT AFTER FIXES · backend FAIL (6 blockers) · frontend PASS-WITH-FIXES (2 blockers) · UI/UX FAIL (5 blockers).

New evidence gathered: 48 R&W + 29 legacy-disclosed detail samples (204 details total). Findings: R&W all MCQ with stimulus; qbank has no <img>/remote assets, 617 <mfenced>, 14 SVG <style>; legacy items are all Math with inline data: PNGs (avg 21 KB); **legacy SPR items have no key field at all** (answer only in rationale prose).

Changed in v3:
- Inventory: +40 rows and corrections (Q2a, Q5a, Q10a, Q11a, Q13, Q20, Q21, Q25a/b, Q27, Q29a, Q30a/b, Q31, Q33, Q33a/b, Q35, Q35a/b/f, Q37, Q38, Q38a/b, Q39, Q43a/b, F13, F14b, F18–F20, A2, A5–A8, A7a, A10, A12–A19, S7, S9, S12–S22, X5, X6); a FIX disposition and a "Deliberate differences from liprep" table (O8).
- Data: Bluebook figures corrected (2,037 / 2,019 / 18 / 3) and G7 made a listing gate; G6 normalises names; G3 asserts id shape; robots.txt policy decided (403 on both hosts → RFC 9309 "unavailable"); E2 authoring metadata declared as deliberate omissions; legacy SPR keys = extractor-proposed, 100 % human-confirmed (`spr_keys.yaml`); adjudication bias stated; bank-sync: advisory lock, count-verified no-op, executemany, FK order, sha-mismatch behaviour; migration names all three heads, child-first rollback; `<style>` kept and scoped instead of forbidden.
- Backend: O7 restated precisely with College Board's verbatim wording; retry-safe submit (`client_attempt_id`); `today` on export/import; one import cap; empty skills = all; `_NoopLimiter` overrides; reuse of `etag_response` and `_content_disposition`; stats spec points at S-rows; calendar-day streak.
- Harness: honest patch description (export keywords + a lifted `preprocessSatHtml`), jsdom-serialiser caveat, G9 narrowed to the four rules it really tests.
- Frontend: session moved out of TanStack Query into `useSatSession` (reveals, history snapshot, per-question in-flight, late responses by id); literal route objects + HydrateFallback; G5 as a vitest spec, decoupled from `build`; dedicated DOMPurify instance with pinned assertions; memoisation made load-bearing; highlighter rule (passage + stem, union coverage, mouse/pen, never persisted); tool window: pointer capture, custom resize handle, measured dock rect, hidden on non-Math, z tokens; Enter handler guard; buttons with aria-pressed (no radiogroup); export anchor / import safeFetch + timeout; flat feature folder with shallow files merged; bundle gate reworded.
- UI: spec moved to `ui-spec.md`; layout recomputed as container queries on content width; one neutral difficulty encoding; E-4 Checkbox indeterminate, E-5 Meter neutral; bars off `--chrome`; mastery badges success/secondary; heat scale in oklch; `--image-outline` in tier 2; reset = three presses + `Dialog role=alertdialog` with a true justification; copy rewritten on D§13 templates; states table for every control; dimensions for bars, navigator, SPR field, windows; DESIGN amendments listed (§3, §9.4, §15.5, §17.5).

## Round 3 (6 reviewers, Opus) — v3 → v4
Verdicts (required changes): inventory/practice NOT YET (4) · inventory/dashboard+analytics NOT YET (11) · journeys NOT YET (6) · backend NOT YET (10, 1 blocker) · frontend NOT YET (8, 3 blockers) · UI/UX NOT YET (19, 4 blockers). Every reviewer re-derived and confirmed the rest of its axis.

Changed in v4:
- Inventory: Q2b (load failure ≠ empty result), Q3a (pinned-bar frame), Q35a (reference window min-width), Q18/Q28/Q34/Q43/Q17/Q5/Q38 precision; A2 six places; F1 + O9; S15 "no data" label; A16a (dropped subtitles); F14c (calendar always renders); A13b (failure banner); A7 short axis labels; A8 quadrants + captions; X5 checkbox animations; Q30 encoding ADAPT; Q2 relax action; Q38a keyboard geometry. Differences table: +7 lines (tooltips/validation, dialog-above-tool, revealed-option words, highlight API trade-offs, relax action, design encodings, import confirmation, phone sticky Start).
- Data/backend: Bluebook residue corrected (0 liprep ids outside E4; 1 E4 id absent from liprep); harness hunk = five replaces + the mfenced call; ON CONFLICT … RETURNING + SELECT, changed answer = new id; legacy SPR extractor reads `alt`, `source: manual`, 20–150 estimate, 200-item stop; E3 single-element gate; `content_disposition` made public (E-8); named advisory lock per `app/facts/crawl.py`; O7 "truncated toward zero" + exact-expansion wording, Fraction/Decimal; export size 325 B/attempt, import cap 12 MiB; G5 timeout + runtime budget; epoch-ms conversion; retired questions reachable via `/session?question=`; `bluebook=1` URL rule; `today` read once at mount.
- Frontend: E-4 reframed as a live Checkbox bug fix (Radix `data-state` vs Base UI `data-checked`), six callers listed; Enter guard = focus inside the practice root; session fetch keeps its timeout via `AbortSignal.any`, aborted ≠ error; skeleton files; optional-segment route + Start pending state; ToggleBand on Base UI toggle-group (E-6); E-3 opt-in, E-5 additive only; figure `<style>` scoped by selector-prefix rewrite instead of `@scope`; import via `requestVoid`, 413 by status; session reducer split; corpus-test skip guard noted.
- UI: layout thresholds recomputed so Topics never loses its two columns at a boundary (936 / 1496), panel padding stated; `/stats` loading + error states (dashboard and dialog); `Sheet variant="full"` (E-7); disc edge, `--on-ink`, neutral pressed language for all ghost toggles, `--focus-ring` reserved for focus, selected+revealed state, `aria-disabled` for tooltip-bearing disabled controls; Empty vs ErrorCard per state; filtered-to-zero computation specified; `Collapsible` keyed by question; bars on `--chrome` by function; spacing on the ladder; import confirmation; DESIGN amendments +§2.2, §8, §17.4.

## Round 4 (same 6 reviewers) — v4 → v5
Required changes: practice inventory 2 · dashboard/analytics inventory 5 · journeys 2 · frontend 2 · backend 1 · UI/UX 6 (1 blocker). Every round-3 fix was verified correct against code and data.

Changed in v5:
- Enter rule reconciled between two reviewers: floating/docked tool windows leave Enter live (upstream, the product); a fullscreen tool (≤ 860px) and the focus-taking overlays suppress it (Q10a, plan §5.5).
- SPR field: `type="text"`, no `inputMode` (a decimal keypad has no `/` or `−`); `readOnly` after submit rather than `disabled`, focus moves to Next.
- Inventory: A7/A8 sentence breaks; A1 (button inert until stats → FIX, loading state that also settles on error); A13 + F18 ADD clauses; A11, A9, F14, F14c, Q37, Q43 precision; owner table reordered; differences table: "Additions" kind, 24-hour attempt cap, Bluebook = one question.
- Plan: Practice drill payload (A6) given a home in §5.3; attempt-list ordering stated for the API; figure-style rewrite runs in an `afterSanitizeElements` hook, strips CSS comments first (the corpus's font block has one between rules), and keeps its own dropped-block report because DOMPurify's `removed` ignores hook removals — G5 asserts that report is empty; §3.1 style figures corrected (12 + 2, three rules); `useNavigation` scoped to the practice path; activeElement null/documentElement; E-table sorted; E-7 rationale; `bluebook=1` ↔ `exclude_bluebook` inversion noted; attempts' code columns free text; import defaults for missing codes; cap headroom restated at 12 MiB.
- UI spec: controls on the `--chrome` bars use the chrome hover/pressed family (a canvas ghost hover is within 0.001 L of chrome — invisible); on-toggles render as `variant="secondary"` so an on-state is never lighter than its hover; filtered-to-zero = four `/counts` calls, one skippable; five analytics tab icons named; Domains pills keep their counts; export toast no longer claims a completion it cannot observe; Collapsible "trigger" wording; ToggleBand number↔string mapping; rail widths and the <md content-width note.

## Rounds 5–6 (same 6 reviewers) — v5 → v6: closed
Round 5 required changes: backend 0 (**PERFECT**) · journeys 0 (**PERFECT**) · dashboard/analytics inventory 1 · practice inventory 2 · frontend 2 · UI/UX 3. Round 6 confirmed each of those fixes: all four remaining reviewers **PERFECT**.

Changed in v6:
- Inventory: differences-table Enter line narrowed to focus-taking overlays + fullscreen tools; Q25 records upstream's floor-only seconds and ADDs the 24-hour ceiling (submit and import; A13a, plan §4.3); Q18 readOnly mechanism; Q43a quoted-text / list / MathML-table rules; A12 FIX ("Exporting <file>…", never a completion claim) cited from the Honesty line; A1 "settles (success or error)".
- Plan: `toolFullscreen` early return named in §5.5 and §6.4; nested at-rules fall to the style rewrite's drop path; E-2 manifest lists its three comment-path touches.
- UI spec: bar rule in the repo's pair form `[:active,[data-pressed]]`, scoped to ghost controls (outline controls keep their own states); strap controls on the quiet-control family with glyph-carried on-states; rule "an on-state is never lighter than its own hover, and never the same fill as the surface under it"; bottom-bar counter row; Score-bands tab icon `ChartNoAxesColumn`; A6 cited at both drill buttons.

Final verdicts: inventory/practice PERFECT · inventory/dashboard+analytics PERFECT · same-product journeys PERFECT · backend+data PERFECT · frontend architecture PERFECT · UI/UX PERFECT.
Totals across the loop: 6 rounds; required changes per round ≈ 30+ → 80+ → 58 → 18 → 8 → 0.
