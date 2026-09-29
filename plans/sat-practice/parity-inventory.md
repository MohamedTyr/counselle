# SAT Practice — liprep parity inventory

The contract for "the same product". Every row is a behaviour read out of liprep's
source at commit `c84d3dc` (2026-09-13, MIT), cloned to
`artifacts/sat-practice/liprep/`. The plan (`plan.md`) must account for every row as
**KEEP** (reproduced exactly), **ADAPT** (same behaviour, different mechanism because
the data now lives in our DB / the user is signed in), or **DROP** (liprep-the-project
chrome that has no meaning inside Counselle — each DROP carries its reason).

Nothing here is a design decision. Visual treatment is `plan.md` §7.

**A fourth disposition, FIX**, is used sparingly: upstream behaviour that is a *defect* — it
breaks, traps the student, or states something untrue — is not reproduced. Every FIX is
collected in the table at the end ("Deliberate differences from liprep") so the owner can
veto any of them (**O8**). The rule: reproduce what a liprep user would call *the product*;
do not reproduce what they would call *a bug*.

Source files: `src/pages/{Home,Filter,Practice}.tsx`, `src/components/*`, `src/db.ts`,
`src/types/questions.ts`, `src/components/TopicTree.ts`, `public/{desmos.html,sw.js}`,
`functions/api/testimonies.ts`.

---

## P0. Routes

| # | liprep | Behaviour | Disposition |
|---|---|---|---|
| P0.1 | `/` | Landing + JSON import dropzone | DROP (see H-rows) |
| P0.2 | `/filter` | Dashboard: filters, topic tree, heatmap, analytics entry | KEEP → `/app/sat` |
| P0.3 | `/practice` | Session built from the filter payload | KEEP → `/app/sat/practice` |
| P0.4 | `/practice/:questionId`, `?id=`, `?q=` | Single-question session by id; exact match first, then case-insensitive match | KEEP → `/app/sat/practice/:questionId` (+ `?id=`/`?q=`) |
| P0.5 | `AppLoader` wraps all routes | First-run "Downloading LiPrep to Device" progress screen priming Cache Storage + fonts | DROP (offline/PWA, see X-rows) |

## H. Home page (`Home.tsx`)

| # | Behaviour | Disposition |
|---|---|---|
| H1 | Drag-drop / file-pick a `.json` question bank; rejects non-`.json`; `parseAndIngestJSON` replaces the whole local bank; navigates to `/filter` | DROP — the owner's brief: "we will work with our data". The bank is server-side and always present |
| H2 | "Question Bank Ready — N questions loaded" + "Continue to Dashboard" + "Select new .json File" | DROP (same reason) |
| H3 | Hero copy ("You can't spell Saturday…"), logo, GitHub star button + live star count, About modal, Wall of Love button | DROP — liprep project marketing chrome, not practice product. Counselle's sidebar entry replaces the landing |
| H4 | Wall of Love: testimonies list (Cloudflare D1), submit form gated on ≥15 unique solved + one-per-install fingerprint | DROP — liprep community feature; **owner decision O1** lists it explicitly |

## F. Dashboard (`Filter.tsx`, `TopicSelection.tsx`, `MonthCalendar.tsx`)

| # | Behaviour | Disposition |
|---|---|---|
| F1 | Header greeting: one of 13 `{main, sub}` pairs, chosen at random once per mount. It **is** the page heading (`<h1>`, sub inline; the sub drops to its own line ≤768px) | ADAPT — mechanism KEPT (13 pairs, one per mount). Ours is one line `{main} — {sub}` in the subtitle slot beneath a "SAT practice" title (**O9**). Copy is **O2** |
| F2 | Header actions: "← Home", "Analytics & Progress" (opens modal) | ADAPT — no Home; Analytics button KEEP |
| F3 | Solved-status filter, single-select, 4 values: All / Unsolved / Mistakes / Bookmarks. Default `all` | KEEP |
| F4 | "Mistakes" = questions whose **latest** attempt is incorrect (not "ever incorrect") | KEEP |
| F5 | "Unsolved" = questions with **no attempt at all** (an incorrect attempt makes it not-unsolved) | KEEP |
| F6 | Checkbox "Exclude Bluebook practice questions", default **on**. Bluebook set = 2,018 ids in `src/data/bluebook_ids.json` | KEEP — ids become a column on our question table |
| F7 | Difficulty = score band 1–7, multi-select as 7 dots grouped Easy (1–3) / Medium (4–5) / Hard (6–7). Clicking the tier label toggles the whole tier (all-on → all-off, else all-on). Default all 7 on | KEEP |
| F8 | "Start Session →" disabled when no topic selected **or** no difficulty band selected (`Filter.tsx:323`) — two distinct causes | KEEP (the inline reason names whichever cause applies) |
| F9 | Start writes `{subtopics: skill codes, difficultyLevels, solvedStatus, excludeBluebook}` to `sessionStorage["filters"]` and navigates to practice | ADAPT — see plan §5.3 (URL state, same payload) |
| F10 | All four filter controls persist across visits (`localStorage liprep_saved_*`) | KEEP (per-device localStorage, same as liprep) |
| F11 | Topic tree: two columns — EBRW (4 domains, 10 skills) and Math (4 domains, 19 skills); exact names and codes in `TopicTree.ts` | KEEP verbatim — taxonomy is College Board's |
| F12 | Three-level toggle: skill checkbox; domain header toggles its skills (checked / indeterminate / unchecked); "Select All / Deselect All" per module. Default: all 29 selected | KEEP |
| F13 | Every skill shows a live **remaining count** and each domain the sum, recomputed when difficulty / status / exclude-Bluebook change — and **only** then (`TopicSelection.tsx:39`): after an Import or Reset inside the analytics modal upstream's counts stay stale until a filter is touched. While counts load, every skill shows a literal `0` | KEEP the counts and their semantics (F3–F6), server-computed. **FIX** the staleness: import, reset and every submit refresh the counts. ADAPT the loading state (previous numbers dimmed, plan §7.3) |
| F14a | Heatmap intensity denominator is `max(1, max count)` over the student's **entire history**, not the displayed month (`MonthCalendar.tsx:44-48`); future days render empty and still tooltip "0 questions"; month paging is unbounded in both directions, with no "today" shortcut | KEEP |
| F14b | Calendar details: weeks start **Sunday** (`S M T W T F S`); leading blanks only, so the last row is ragged; one tooltip element, centred below the grid rather than anchored to the cell; `today` is captured at mount, so the ring does not move at midnight; cells show `cursor: pointer`, but the click handler is optional and the dashboard never supplies one | KEEP Sunday start, ragged last row, mount-time today. ADAPT the tooltip to our `Tooltip` anchored to the cell. **FIX** the dead affordance: cells are not clickable and do not look clickable |
| F14c | With no attempts the calendar still renders in full: every cell level 0, tooltips "0 questions", paging works; only the streak line (F16) and the Today box are absent | KEEP — the grid always renders (a skeleton grid only during the first `/stats` load, `ui-spec.md` §3.5); one line "No practice yet" sits where the streak and Today block will appear (`ui-spec.md` §3.5) |
| F14 | "Activity Heatmap": one-month calendar grid under a "September 2026" caption, prev/next month, today outlined, 5-step intensity by `count / max(count)` (0, <25%, <50%, <75%, ≥75%), hover tooltip "Sep 19: 12 questions", Less→More legend | KEEP |
| F15 | Heatmap counts **attempts per local calendar day** (every attempt, including re-attempts) | KEEP — day is the student's local day (plan §4.4) |
| F16 | "N day streak" with flame icon, shown only when streak > 0. Streak counts back from today, or from yesterday if nothing today | KEEP |
| F17 | "Today's Progress": EBRW attempts today, Math attempts today, total time today `Xm Ys` | KEEP |
| F18 | Layout: three panes whose **visual** order differs from DOM order (CSS `order`, `Filter.css:52-139`). >1380px: **Activity left · Topics centre · Filters right**. 1101–1380: Topics spans the left, Filters top-right, Activity bottom-right. 769–1100: Filters and Activity side by side on top, Topics full-width below. ≤768: single column in the order **Filters → Topics → Activity** (`Filter.css:173-186`). The two module columns stack at a **viewport** width of 900px (`TopicSelection.css:297`), which falls inside the 769–1100 band — so upstream stacks the modules while the page still has room | KEEP the arrangement at each band; the module columns stack on the **Topics region's own width** (container query), which is what upstream's rule was reaching for; breakpoints re-expressed on our scale (plan §7.3). **ADD**: on a phone Start session is pinned to the bottom of the scroll container, where upstream leaves it mid-page inside the filter card (`ui-spec.md` §3.1) |
| F19 | While the analytics modal is open the page behind cannot scroll; the lock is released on close and on unmount (a Practice Drill navigates away cleanly) | KEEP — provided by our `Dialog` |
| F20 | Opening `/practice` with no launched filter at all falls back to `{all skills, all bands, status all, exclude Bluebook on}`; an **empty** skill or band list means *no filter*, i.e. everything (`db.ts:563-583`). The Start button prevents this on the normal path, but a stale saved selection upstream can produce it silently | KEEP the semantics (empty = all) for a hand-edited or bare URL. **FIX** the silent path: saved selections are validated against the taxonomy on load, so the dashboard never launches an empty list by accident |

## Q. Practice session (`Practice.tsx`, `AnswerOption.tsx`, `RichContent.tsx`)

### Session construction
| # | Behaviour | Disposition |
|---|---|---|
| Q1 | Session = **every** question matching the filter, in stored order, no cap, no shuffle, all loaded up front | KEEP order + no cap; loading is ADAPT (plan §5.4 — ids up front, bodies windowed) |
| Q2 | Empty result → "No questions found for the chosen filters." + Back to Filters. Unknown id → `Question "X" was not found…` | KEEP the two messages (re-voiced); **ADD**, for the empty result, DESIGN §13.3's relax-the-narrowest-filter action beside "Back to filters" (`ui-spec.md` §4.3) |
| Q2a | While the session loads: a bare, centred "Loading session…" filling the viewport, no chrome | ADAPT — ours is a network fetch; the frame renders immediately with skeleton content (plan §7.6) |
| Q2b | Any failure while building the session (`loadState: "error"`, `Practice.tsx:201-204`) renders the **same** screen as a genuine empty result — "No questions found for the chosen filters." + Back to Filters — so a load failure is reported to the student as a filter that matched nothing, with no retry | **FIX** (honesty) — a failed session load is its own state: "Could not load this session" + **Try again**, distinct from the filtered-to-zero and unknown-id states (`ui-spec.md` §4.3) |
| Q3 | Session state (answers, eliminations, submitted flags) is **in-memory only**; leaving or reloading discards the session. Attempts already submitted persist | KEEP |
| Q3a | The screen is a full-viewport frame, never the page: a pinned top bar (56px, 52 at ≤860) and a pinned bottom bar (64px, 60 at ≤860) with the reading region between them. The bars never scroll — timer, counter and primary button are always on screen; scrolling happens **inside** the reading columns, each its own scroll container (Q11), so passage and question scroll independently and neither moves the chrome (`Practice.css:1-12, 51-62, 203-236, 509-521`) | KEEP (`ui-spec.md` §4: `h-dvh` column — top bar · reading region · bottom bar) |

### Chrome
| # | Behaviour | Disposition |
|---|---|---|
| Q4 | Top bar left: "Section 1: Reading and Writing" / "Section 2: Math" by current question's module | KEEP |
| Q5 | Top bar centre (dead centre on desktop; at ≤860px an in-flow item between the section title and the tools): per-question **count-up** timer `MM:SS`; click pill to hide/show ("Show"); separate pause/resume button | KEEP |
| Q5a | On **every** index change the timer is set to 0 **and forced running** (`Practice.tsx:214-218`) — navigating un-pauses a paused timer, and revisiting an already-submitted question restarts the clock from 0. The hidden/shown state is **not** reset | KEEP |
| Q6 | Timer keeps running after submit and while revisiting a submitted question (value only read at submit) | KEEP |
| Q7 | Tools, R&W: Highlight toggle. Math: Calculator toggle, Reference. Both: Info, ✕ Exit (→ dashboard). Labels collapse to icons on narrow screens | KEEP |
| Q8 | Bottom bar left: "Question N of M ▲▼" opens the navigator | KEEP |
| Q9 | Bottom bar right: **Check Answer ↵** (disabled until an answer exists) → after submit **Next ↵** → on last question **Finish Session ✓** (→ dashboard) | KEEP |
| Q10 | `Enter` submits when an answer exists; after submit `Enter` goes to next; ignored inside a textarea; no-op on last question | KEEP |
| Q10a | The Enter handler is window-level and never suppressed: Enter submits / advances **while the Info dialog or the navigator is open, and on a phone while a fullscreen tool covers the question**. (With a tool window merely floating beside the question on desktop, Enter working is the product, not a defect.) It calls `preventDefault()` on the submit path, which is also what stops a focused answer button from being "clicked" by the same keypress. `Esc` closes only the reference sheet — not the Info dialog, not the navigator, not the analytics modal | **FIX** — Enter is ignored when focus sits inside an overlay that takes focus on open (Info dialog, navigator, analytics modal) and while a tool is **fullscreen** (≤ 860px); `Esc` closes every overlay (DESIGN §16). A positive test on focus rather than a list of overlays, plus one early return for the fullscreen-tool state (plan §5.5). Floating and docked tool windows are deliberately **not** covered: Enter keeps checking and advancing with the calculator or reference sheet open beside the question, exactly as upstream. `preventDefault()` on both branches is kept |

### Layout
| # | Behaviour | Disposition |
|---|---|---|
| Q11 | R&W question with stimulus: two equal columns — passage left, question right, independent scroll | KEEP |
| Q11a | Both panes are keyed by question, so every navigation **resets their scroll to the top** | KEEP |
| Q12 | No stimulus (all Math, some R&W): single centred column, max 860px | KEEP |
| Q13 | Math: the stimulus is merged **into the stem** at normalisation (`stimulus + "\n" + stem`), never a left column. Belt and braces: if a Math question still carries a stimulus at render, it is drawn above the stem in the question column (`Practice.tsx:733-735`) | KEEP both — merge at ingest, and the render fallback |
| Q14 | R&W: if stem text starts with the stimulus text, that prefix is stripped from the stem (ingest and again at render) | KEEP — done at ingest |
| Q15 | ≤860px: single column; passage renders under the question strap, above the stem | KEEP |
| Q16 | Question strap: number square, "Mark for Review" bookmark toggle, eliminate-mode toggle (MCQ only) | KEEP |

### Answering
| # | Behaviour | Disposition |
|---|---|---|
| Q17 | MCQ: options displayed and matched as A–D **by position** (`CHOICE_LABELS[i]`; a fifth option would be labelled "5" — G4 asserts the bank has none). (liprep's importer keeps whatever `id` the JSON carries — a letter in the community dumps, a UUID in raw College Board data — but the practice screen never reads it) | KEEP — ingest stores `label` = position letter |
| Q18 | An answer — a choice or a typed response — is changeable until submit and locked after (upstream disables the options and the SPR input) | KEEP the lock; the SPR field is locked with `readOnly` rather than `disabled`, which would throw keyboard focus to `<body>` (`ui-spec.md` §4) |
| Q19 | Eliminate mode (default **on**): per-option strike button; eliminated option is struck, unselectable, and if it was the selected answer the selection clears; toggle again to restore. Eliminations are per question, in-memory | KEEP |
| Q20 | After submit: the correct option is marked correct **always**; the selected wrong option is marked incorrect; strike *buttons* disappear, but an eliminated option **keeps its struck, dimmed look** — unless it is the correct one, whose correct styling wins | KEEP |
| Q21 | SPR: a visible label "Student-Produced Response" bound to a text input, `maxLength=7`, characters restricted to `[0-9 . / -]`, placeholder "e.g. 3/4 or 0.75", max-width 320px | KEEP |
| Q22 | SPR correctness: (a) case-insensitive string match against any accepted answer; (b) leading-zero equivalence `.5`≡`0.5`, `-.75`≡`-0.75`; (c) numeric equivalence — decimal or `a/b` fraction parsed, match if `|user − accepted| < 1e-6` | KEEP — **moves server-side** (plan §4.3); identical algorithm, ported with its test vectors |
| Q23 | SPR feedback: "✓ Correct answer" / "✕ Incorrect. Accepted: a, b, c" | KEEP |
| Q24 | SPR accepted answers are **augmented from the rationale text** on import and again on every read (`ensureSprAnswer`): `\frac{}{}`, MathML `<mfrac>`, img `alt`, `alttext`, "7 over 6", "negative 7", written fractions ("one half"), "Note that X, Y and Z are examples of ways to enter…", "The correct answer is …", multi-answer "3 and 4", and a generic "correct answer … <number>" catch-all; a lone `"0"` key is treated as a missing-key placeholder | ADAPT — liprep needs this because community JSON dumps lose keys. We ingest College Board's official keys, which already enumerate the accepted forms (plan §3.1). The extractor is ported but runs only as a build-time **cross-check** (plan §3.5, G10); it never adds an accepted answer by itself, and a real key of `0` is a real answer |
| Q25 | One attempt row per submit: question id, module, domain, skill, band, user answer, correct?, seconds (`max(1, round)` — **floor only, no ceiling**, `db.ts:608-627`), timestamp, local date key | KEEP the row and its fields; **ADD** a 24-hour ceiling on the recorded seconds, on submit and on import alike. Upstream's throttled tick counter under-counts an abandoned tab; Q25a's wall-clock timer would instead record a weekend into one question and into every average that reads it |
| Q25a | The timer is a 1 s `setInterval` tick counter, which browsers throttle in a background tab, so recorded seconds under-report wall time | **FIX** — elapsed time is accumulated from timestamps while the timer is running; the display and every other rule (Q5, Q5a, Q6) are unchanged |
| Q25b | Submit is optimistic upstream: the question is marked submitted *before* the write is awaited, with no error path | ADAPT — server-graded (O6): the question becomes submitted when the verdict returns; on failure it stays answerable (plan §5.5) |
| Q26 | A question can be attempted again in a later session; every attempt is kept | KEEP |
| Q27 | After submit: "Answer Explanation & Rationale" `<details open>` — the attribute is hard-coded, so it is open again on every revisit even if the student closed it; "Previous Attempts" likewise re-collapses on every revisit | KEEP (both disclosures are keyed by question and uncontrolled-with-default, not remembered). The explanation block is rendered **only when the rationale is non-empty** |
| Q28 | After submit: "Previous Attempts (N)" `<details>`, closed; header shows "Solved ✓" if any attempt correct else "Unsolved ✕"; rows oldest first (the attempt just made is **last**) = badge, "Answer: X", `⏱ Ns`, "Sep 19, 02:41 PM" | KEEP |

### Navigator
| # | Behaviour | Disposition |
|---|---|---|
| Q29 | Popover (desktop) / full-width bottom drawer + backdrop (mobile), titled "Question Bank" | KEEP |
| Q29a | Desktop: clicking outside the navigator does **not** close it (the backdrop exists only ≤860px); only the counter button or ✕ does. Mobile: tapping the blurred backdrop closes it | **FIX** on desktop — our `Popover` light-dismisses and closes on `Esc` (DESIGN §16.1). Recorded as intentional |
| Q30a | Jumping to a question — from a cell, the Next button or Enter — **closes the navigator and clears any text selection** | KEEP |
| Q30b | Navigator geometry: desktop popover 400px wide, max-height 520px, scrolls; grid **6 columns**, 5 at ≤860px, 4 at ≤480px; mobile is a bottom sheet, max-height 80vh | KEEP |
| Q30 | Grid of all session questions by number; cell tinted by difficulty tier (easy/med/hard); current cell ringed; click jumps | KEEP the per-cell difficulty signal and everything else; ADAPT its encoding (an ink tick, not a tint — `ui-spec.md` §2) |
| Q31 | Cell badges: bookmark flag (always); for questions submitted **this session**: ✓ / ✕ for this session's answer, and **● Upsolved** = (correct this session or ever correct) and ever incorrect. The rules are not exclusive: a question answered wrong this session that was once right and once wrong shows **● and ✕ together**. "Ever" is a **snapshot taken when the session starts** plus this session's own results (`Practice.tsx:190-207, 463-467, 973-976`) | KEEP, including the co-occurrence and the snapshot. The legend names the two time horizons (this session · all time) so one cell is not making an unexplained double claim |
| Q32 | Legend: Correct / Incorrect / For Review / Upsolved | KEEP |

### Tools
| # | Behaviour | Disposition |
|---|---|---|
| Q33 | Highlighter (R&W only): with mode on, releasing a text selection inside the **passage or the stem** (desktop column, mobile passage copy) toggles a yellow `<mark>`. A selection **wholly inside one answer option** is rejected (each option is a `<button>`, `Practice.tsx:273-280`), but the test is on the selection's *common ancestor*, so a drag that starts in the stem and runs into the options — or, after submit, into the rationale — marks text there too; and on desktop a drag from the passage into the stem resolves to no pane and does nothing, while on mobile (where the passage copy sits inside the question column) the same drag highlights both. The handler listens to `mouseup` only, so highlighting is effectively mouse-only; if >50% of the selection is already marked, it **un**marks; adjacent marks merge; never applies inside buttons, inputs, the strap, the rationale or attempt history | KEEP the tool and its toggle rule; **FIX** the accidental edges into one stated rule: highlightable text is the **passage and the stem**, a selection is clipped to each of them (so passage-into-stem highlights both parts on every width), options and rationale are never marked, mouse and pen only. Reimplemented (Q34) |
| Q34 | Highlights are DOM mutations: lost on question change (columns are re-keyed) and never persisted. **liprep bug:** the un-highlight split path does `nextMark.appendChild(nextMark)` (`Practice.tsx:382`), which throws — un-highlighting the middle of a mark is broken upstream | KEEP that highlights are per-question and unsaved; **FIX** the un-highlight crash |
| Q33a | The highlight-mode flag is session state: switched on in an R&W question, it stays on when the student reaches a Math question, where the button is gone but selections still get marked | **FIX** — the highlighter acts only on R&W questions; the flag is remembered and resumes on the next R&W question |
| Q33b | Text selection is disabled on disclosure summaries, tool-window headers and the reference images, so dragging a window never selects text | KEEP |
| Q35 | Desmos graphing calculator (Math-only toolbar button) in one persistent iframe — graph state survives question changes, hide/show and dock/float within a session. Desktop: floating, dragged by its header, or **docked** into the left column (question moves right); the docked pane has its own header "Desmos SAT Calculator" with **Undock (Float)**, duplicating the window's Float control. Closing while docked reopens docked. Floating position survives close/reopen. Mobile: fullscreen with "✕ Back to Question". Drag clamp is on the window's top-left against fixed constants (x ∈ [10, innerWidth − 360], y ∈ [60, innerHeight − 280], start {30, 70}), applied only while dragging — so a wide window can hang well off-screen | KEEP all of it except the clamp, which is **FIX**ed to the window's real size so the header can never leave the viewport, and re-applied on viewport resize. One Float control, in the window header |
| Q35a | Both tool windows are **user-resizable** (CSS `resize: both`). Calculator: 580×480 default, min 320×280, max 90vw×85vh. Reference: 880×600 default, **`min-width: 0`** and min-height 380, max 95vw×90vh (`Practice.css:711-724, 818-838`) — so the reference window, unlike the calculator, can be resized down to zero width. Hidden calculator is parked off-screen, not unmounted | KEEP the defaults, the maxima and the calculator's minima; **FIX** the reference window's missing `min-width`: it takes the calculator's 320px floor, so a window cannot be collapsed to nothing |
| Q35b | The calculator frame is not module-scoped: open it on a Math question, move to an R&W question, and it **stays on screen with no toolbar button to close it**; if docked, it **replaces the passage column entirely** | **FIX** — on a non-Math question the calculator is hidden (still mounted, graph intact) and returns exactly as it was on the next Math question |
| Q35f | Stacking: bars under the navigator under the floating calculator under the Info dialog under the reference sheet — the reference sheet can sit on top of the Info dialog | ADAPT to DESIGN §4.1's z tokens (plan §6.4); a dialog is always above a tool window |
| Q36 | Desmos config: `degreeMode: true`, expressions, keypad, settings menu, zoom buttons, points of interest, trace, no border, `pasteGraphLink: false`, `restrictedMode: false`; the page calls `resize()` on every window resize. Load order: bundled 3.1 MB `desmos-calculator.js` → Desmos CDN `v1.9` with API key → iframe of `desmos.com/testing/cb-digital-sat/graphing` | ADAPT — **owner decision O3** (licensing; plan §6.4). Default: the official CB-digital-SAT Desmos embed, same UX shell |
| Q37 | Reference sheet (Math only): floating draggable window (mobile fullscreen), `Esc` closes; it **unmounts on close, so it reopens at its start position {40, 50}** (clamp x ∈ [10, innerWidth − 380], y ∈ [50, innerHeight − 200]). Contents: row 1 = four formula SVGs plus the special-right-triangles PNG in a double-width cell, row 2 = the other seven SVGs, then three lines verbatim — "The number of degrees of arc in a circle is 360." · "The number of radians of arc in a circle is 2π." · "The sum of the measures in degrees of the angles of a triangle is 180." Images are not draggable; graphics 10–11 carry placeholder alt text | KEEP; assets owned (plan §6.5); **FIX** the two placeholder alts and the clamp (as Q35) |
| Q38 | Info dialog: Question ID (+ "search for tutorial" → Google video search of the quoted id), Section, Domain (name, else raw code, else "—"), Skill (name, else raw code), Score Band `n / 7`, Difficulty (word, else raw), Item Type, Created and Updated as `Sep 19, 2026`. **Updated** shows when Created is missing, or when the two differ by > 60 s *and* format to different days. "Report Issue / Feedback" → liprep's Google Form — whose URL is built with two `?` and never prefills the id. Max-width 480px. Closes on backdrop click or ✕ | KEEP every field and rule; the report link is ADAPT (plan §5.6) |
| Q38a | No upstream overlay has dialog semantics: no role, no focus move on open, no focus trap, no focus return | **FIX** — our `Dialog` / `Popover` / `Sheet` primitives (DESIGN §16); tool windows are also movable and resizable from the keyboard (arrows / Shift+arrows on the focused header), where upstream's are mouse-only |
| Q38b | Tooltips and names: timer pill "Toggle timer visibility"; pause "Pause timer" / "Resume timer"; eliminate-mode "Toggle Option Elimination"; strike "Eliminate choice" / "Restore choice" — but its accessible name is always "Eliminate choice A", even when it restores | KEEP the tooltips (sentence case); **FIX** the accessible name to follow the state |

### Content rendering (`RichContent.tsx`)
| # | Behaviour | Disposition |
|---|---|---|
| Q39 | Blanks, two rules: the pair `<span aria-hidden>____</span><span class="sr-only">blank</span>` → a styled inline blank with `aria-label="blank space"`; any other run of ≥ 4 underscores → the same styled blank **with no accessible name** | KEEP both rules (render-time, plan §6.1); **FIX**: the second kind also gets the accessible name |
| Q40 | `&deg;` → `°` | KEEP (render-time, plan §6.1) |
| Q41 | Strip hard-coded pixel widths from `th`/`td` (they truncate) | KEEP (render-time, plan §6.1) |
| Q42 | MathML `<mfenced>` (removed from browsers) → `<mrow><mo>(</mo>…<mo>)</mo></mrow>` honouring `open`/`close`/`separators` | KEEP (render-time, plan §6.1) |
| Q43 | Sanitise with DOMPurify, HTML + SVG + SVG-filters + MathML profiles, explicit tag/attr allow-list; render via html-react-parser (ADAPT: `dangerouslySetInnerHTML`, table style by selector — plan §6.1); every `<table>` gets the SAT table style | KEEP — sanitised at render; the ingest audit checks the corpus against the same allow-list (plan §6.2, G5) |
| Q43a | Content layout rules: images inline-block, vertically centred, max-width 100 %; images marked as math (`.math-img`, `role="math"`, inside `.math-container`) capped at 2.2em tall and forced inline; tables collapse borders, auto width, 42px minimum cell width; option text wraps anywhere except inside tables; quoted text (`blockquote`, and any `p` with an inline `padding-left`) becomes a set-off block; lists use a custom bullet (`ol` decimal) with fixed margins; MathML `mtable` / `mtr` / `mtd` are forced to table display; `math` never wraps — and with no horizontal scroll on the stem, a wide expression overflows the column | KEEP the rules in `sat.css`; **FIX** the overflow: the content block scrolls horizontally when an expression is wider than the column |
| Q43b | Question HTML may contain SVG `<style>` elements (upstream allow-lists the tag; the official bank really uses them inside figures — plan §3.1), which upstream lets restyle the whole page | KEEP the figures' styling; **FIX** the leak: figure styles are scoped to their own SVG (plan §6.2) |
| Q44 | Native MathML rendering, no MathJax/KaTeX | KEEP |

## A. Analytics modal (`AnalyticsModal.tsx`, stats in `db.ts::getUserStatistics`)

| # | Behaviour | Disposition |
|---|---|---|
| A1 | Near-fullscreen modal, 5 tabs: Overview · Radar Web · Pace Matrix · Score Bands · All Domains & Skills. The button opens nothing until the stats have loaded — the modal is gated on `stats` being non-null (`Filter.tsx:378`), so an early press is silently ignored | KEEP the modal and its tabs; **FIX** the silent press: the button carries a loading state until `/stats` settles (success or error) — on error it still opens the dialog onto its error state |
| A2 | **Overview** KPI row, four cards. (1) First-Try Accuracy % with the same % again in a pill, subtext "N unique questions solved". (2) EBRW: big number = unique questions **attempted** (captioned "solved"), pill = EBRW first-try %, subtext avg pace · total time. (3) Math: same. (4) Upsolve: `uniqueCorrect / uniqueAttempted`, pill "N corrected", subtext "N currently unsolved mistakes" | KEEP every number. **FIX the word**: upstream captions *attempted* counts as "solved" in the KPI row (card 1's subtext, the EBRW caption, the Math caption), in the donut centre, and in the Domains tab ("Solved: N q", "Solved (Att)") — six places. They read "attempted" (honesty rule). Card 1's duplicate pill is dropped; the other pills carry different data and stay |
| A3 | Overview: section comparison (1st-try acc, overall attempt acc, avg pace, upsolved) for EBRW vs Math | KEEP |
| A4 | Overview: donut, centre = unique attempted. Slices: `uniqueCorrect − upsolved` (upstream labels it "1st-Try Correct", but the quantity is *currently correct and never missed* — a different number from the first-try KPI beside it), Upsolved, Unsolved (`uniqueIncorrect` = latest attempt wrong) | KEEP the three quantities; the first slice is labelled for what it is, "Correct, never missed" (honesty rule — same treatment as A8) |
| A5 | Overview: "Targeted Reinforcement Areas" — the 4 weakest skills (lowest **first-try accuracy**, any skill with ≥ 1 attempt, volume-blind), each with attempts, avg s/q, accuracy, **Practice Drill →**. Subtitled "Skills with highest error frequency…", which is not what is ranked. The whole panel is hidden when no skill has data | KEEP the ranking and the hide rule; the subtitle states what is ranked (honesty rule) |
| A6 | Drill = start a session on that one skill using the dashboard's current difficulty / status / exclude-Bluebook, then close the modal. It does **not** change the dashboard's saved topic selection | KEEP |
| A7 | **Radar**: 8 domain axes, two polygons (first-try, overall); an axis with no data plots at 5%; hover a vertex → both values; side list of 8 domains with first-try bar, unique count, avg pace. Axis and tooltip labels are eight short forms ("Craft & Struct", "Expr of Ideas", "Info & Ideas", "Std English", "Algebra", "Adv Math", "Data & Problem", "Geom & Trig"); the side list uses the full domain names. | KEEP |
| A7a | Radar hover: only the first-try polygon has hover targets, and the tooltip appears at one fixed spot in the middle of the chart whichever axis is hovered | **FIX** — tooltip at the hovered axis, showing both values; the same numbers are always readable in the side list |
| A8 | **Pace Matrix**: scatter, x = avg seconds, y = **first-try** accuracy (the tooltip just says "accuracy"); constants in S13; hover tooltip positioned as a percentage of the viewBox, so it drifts off its dot whenever the chart's aspect ratio changes; hover identity matched by skill name. Plots only the union of weakest-4 and strongest-4 skills (≤ 8 dots) — not "every skill" as its subtitle claims. The plot is four tinted quadrants, each carrying its name in-plot (fast and accurate · accurate but slow · fast but inaccurate · slow and inaccurate), the x ends captioned at the clamps (15 s / 130 s), the y axis marked 100 / 50 / 0 %. | KEEP the ≤ 8 dots and constants; subtitle and axis say what is plotted (first-try accuracy); **FIX** the tooltip to anchor to its dot |
| A9 | **Score Bands**: 7 bars = accuracy per band, overlaid pace spline (clamped 140s) with `Ns` labels; "All Sections" / EBRW / Math switch; empty band = ghost bar + "—" | KEEP |
| A10 | **Domains & Skills**: 8 domain cards (unique **attempted**, 1st-try, avg pace), each skill row: status chip (S16), first-try bar, overall acc, `attempted (attempts)`, avg pace, Practice →. Rows come from the static topic tree, not from the data. Filter pills read a static "All Domains (8) / EBRW (4) / Math (4)". Search matches skill **name**, skill **code**, or **domain name** (not domain code); a domain-name hit keeps all its skills, otherwise only matching skills remain and empty domains disappear; no match renders nothing | KEEP; a search with no match shows the filtered-to-zero template (DESIGN §13.3) instead of a blank |
| A11 | Footer drawer (collapsed): lifetime attempts, global avg pace; expanded: Export / Import / Reset; the collapsed bar also carries a right-hand "Data & Progress Actions" label and a ▲/▼ chevron | KEEP |
| A12 | Export: downloads `YYYY-MM-DD.liprep` (the **device's** local date) — pretty-printed JSON `{format:"LiPrep", version:1, exportedAt, exportDateStr, data:{attempts, bookmarks}}`; attempt rows omit their numeric id. Feedback banner "Successfully exported <file>.", auto-dismissed after 3 s | KEEP the file format byte for byte, so a liprep user can move in and out (plan §4.6). **FIX the claim**: the export is a plain `<a download>`, so the page never observes completion — the toast fires on click and reads "Exporting 2026-09-19.liprep…" (the filename is kept; the browser's own download UI is the success signal), never "Successfully exported" |
| A13 | Import: accepts `.liprep`/`.json`, validates rows, **replaces** all attempts and bookmarks | KEEP (replace semantics; server-side, transactional). **ADD** a confirmation before the replace (`ui-spec.md` §5) — upstream replaces silently, and a three-press guard on reset beside no guard on an equally destructive import would be incoherent |
| A13a | Import never checks `version`; a row needs only a string `questionId` and boolean `isCorrect`, everything else defaults (`module`→`reading`, band→3, seconds→1, `solvedAt`→now, `dateKey`→today); bookmarks are wiped **even when the file has none**; `timeSpentSeconds` of 0 or below and a band outside 1–7 are accepted as-is; ids are re-assigned in file order; the file input is cleared after each pick so the same file can be imported twice; banner "Imported N attempts & M bookmarks." for 3.5 s (`db.ts:1147-1207`) | KEEP, with two stated clamps that upstream applies to native data but forgets on import — seconds floored to 1 (Q25), band clamped to 1–7 — plus Q25's 24-hour ceiling. A `dateKey` that is not a date falls back to the date of `solvedAt` rather than failing the file |
| A13b | A failed export or import shows its error in the same banner, in an error colour (3 s / 3.5 s) — "Invalid .liprep file. Could not parse JSON content.", "Invalid .liprep backup format." — and the data is left untouched | KEEP; all-or-nothing import; feedback via `toastSatError`, which also carries the server's 413 / 422 sentences |
| A14 | Reset: **three** presses on the button, label changing each time ("Reset Progress" → "Misclick prolly" → "yeah…"), no timeout between presses; the third press resets the counter and opens a shaking "Are you SUREEEEE???" confirm. Cancelling therefore costs three presses again. The confirm closes on overlay click unless a reset is running; while it runs both buttons disable and the primary reads "Resetting…"; on success the confirm **and the analytics modal** close. Reset wipes attempts and bookmarks only — saved filter preferences survive | KEEP all of it; copy re-voiced (**O2**), shake dropped (DESIGN §12.1) |
| A15 | The analytics modal closes on overlay click and ✕ only — **no `Esc`**; at ≤ 768px the shell covers the overlay, so ✕ is the only way out | KEEP overlay and ✕; **FIX**: `Esc` closes it too (DESIGN §16) |
| A16 | Modal scaffold: max 1180px wide, 92vh capped at 900px; fixed header, **one** scrolling body, pinned footer drawer; the tab strip scrolls horizontally and never wraps; the radar's side list is a second, nested scroll area | KEEP |
| A16a | Every analytics panel has a heading plus a descriptive line under it; the modal header has "Analytics & Progress" plus a subtitle ("Comprehensive question-level telemetry, pacing, and domain mastery") | KEEP the headings, re-voiced (O2); **DROP** the header subtitle and every panel line that only restates its heading (house rule: no descriptive copy under a heading). The two lines that carry a claim are kept and corrected instead (A5, A8) |
| A17 | Analytics responsive rules. ≤ 960px: KPI row 4 → 2 columns; chart pairs and the section comparison stack; skill rows go vertical; radar list capped 360px. ≤ 768px: full-screen, sticky header, subtitle hidden, tabs on their own full-width row, KPI 1 column, footer actions stack, radar list capped 320px | KEEP, on our breakpoints (plan §7.7) |
| A18 | No empty states anywhere: with no attempts every tab draws its full chrome — radar at the floor, no dots, seven ghost bands, 29 "Untested" rows, a grey donut reading "0 SOLVED" | ADAPT — DESIGN §13.2 requires an empty state; the chrome-with-nothing-in-it is replaced by one per tab (plan §7.7). Listed for the owner |
| A19 | All modal state is local and resets on every open: Overview tab, "all" filters, empty search, drawer collapsed, reset counter 0 | KEEP (the open tab is also in the URL while open, plan §5.3) |

### Stat definitions (the part that must be bit-identical)
| # | Definition |
|---|---|
| S1 | Attempts are ordered by `solvedAt`. Per question: *first* = earliest attempt, *latest* = most recent |
| S2 | `firstTryAccuracy` (global, module, domain, skill) = questions whose first attempt was correct ÷ unique questions attempted |
| S3 | `overallAccuracy` = correct attempts ÷ all attempts |
| S4 | `uniqueCorrect` / `uniqueIncorrect` = by **latest** attempt |
| S5 | `upsolved` = had any incorrect attempt **and** latest is correct |
| S6 | `avgTime` = total seconds ÷ attempts (per scope); `totalTime` = sum |
| S7 | Which attempt's stored values are used: **per-question** quantities (module bucket, domain/skill unique counts, first-try correct) read the **first** attempt's module/domain/skill; **per-attempt** quantities (attempt totals, overall accuracy, times, band stats) read **each attempt's own**. The module split is strictly `== "math"`; anything else counts as EBRW |
| S8 | Band stats are per **attempt** (not per unique question) |
| S9 | Ranking: skills with ≥ 1 attempt, stable-sorted by first-try accuracy ascending (ties keep first-seen order in the time-ordered log). A skill first seen on a question's *non-first* attempt is appended after all of those, whatever its time (S18). Weakest = first 4. Strongest = the list **reversed**, first 4 — i.e. descending, ties in reverse first-seen order. With < 8 skills the two overlap |
| S10 | All percentages and averages `Math.round` to integers |
| S11 | Streak / today use the local-day key of each attempt (F15–F17) |
| S12 | "Latest attempt": stats sort by `solvedAt` (stable); the Mistakes filter and counts use insertion order. They agree for every natively recorded log and can differ only for a hand-edited import. **We use `(solved_at, id)` everywhere** |
| S13 | Pace matrix constants: x = avg seconds clamped to [15, 130]; y = accuracy 0–100; quadrant split at **50 %** and at the clamp's midpoint, **72.5 s** (unlabelled upstream); dot radius `max(6, min(14, 5 + 1.5 × attempts))`; dots = union of weakest-4 and strongest-4 |
| S14 | Score-band constants: bar = accuracy %; pace line clamped at **140 s**, no lower clamp; a band with no attempts draws a ghost bar, "—", and — because its average is 0 — pulls the pace line down to the axis, drawing a pace nobody measured. **FIX (honesty): the line breaks at an empty band** |
| S15 | Radar: an axis with no data plots at ratio **0.05**; first-try polygon tests `uniqueQuestions > 0`, overall polygon tests `totalAttempts > 0`. **FIX (honesty): an axis at the floor also labels itself "no data", so a 5 %-looking spoke is never read as a measured 5 %** |
| S16 | Mastery chip thresholds on first-try accuracy: ≥ 80 Mastered, ≥ 50 Developing, else Needs Focus; no unique questions → Untested |
| S17 | Domains: only the eight known domain codes aggregate. An attempt with an empty or unknown domain code counts in global, module and band stats but in **no** domain card or radar axis — domain totals need not sum to the global total |
| S18 | Skills: keyed by skill code; name = taxonomy name, else the raw code; an **empty** skill code is dropped. A skill's domain and module come from the attempt that first created its entry. A code outside the taxonomy can therefore appear in weakest / strongest and the pace matrix, but never in the Domains tab (built from the static tree). A skill first seen on a question's *non-first* attempt has 0 unique questions ⇒ 0 % first-try ⇒ ranks weakest while the Domains tab calls it "Untested" |
| S19 | Band stats count only attempts whose band is 1–7 |
| S20 | Every empty scope yields the number 0, never null (every division is guarded) — the radar's no-data test and the ghost bars depend on it |
| S21 | Streak walks backwards in fixed 86,400,000 ms steps over local date keys, so on a DST change day it can count a date twice or skip one. **We step by calendar day** — identical on every other day (ADAPT; vectors exclude transition dates) |
| S22 | `DomainPerformance.skills` is computed upstream (with a fallback clause that can never be true) and read by nothing. Not ported |

## X. Platform behaviours

| # | Behaviour | Disposition |
|---|---|---|
| X1 | PWA: manifest, service worker (cache-first, SPA fallback), install prompt, works with zero network | DROP — **owner decision O4**. Counselle is an authenticated, server-backed app with no service worker; liprep is offline because it has no server. Progress sync is the replacement benefit |
| X2 | All data local to the device; nothing leaves the browser | ADAPT — per-user rows in `counselle.*`, auth-scoped; export (A12) preserves data portability |
| X3 | IBM Plex Sans/Mono, navy/gold "retro" skin, blob SVGs, cosmetic module icons | ADAPT — Counselle design system (brief: "of course with our design system") |
| X4 | No accounts, no onboarding | ADAPT — behind Counselle auth like every `/app` route |
| X5 | Decorative micro-motion: navigator cell `hover: scale(1.04)`, active difficulty dot `scale(1.18)`, checkbox hover `scale(1.08)` / active `scale(0.92)` and its check-in pop and checkmark-draw animations (`TopicSelection.css:211-243`), two 22–26 s floating background blobs, `animate-fade-in` on pages, the reset modal's shake | DROP — DESIGN §12.1 rules 1 and 5 (no decorative motion; hover is never a transform). Recorded so the absence is a decision, not an oversight |
| X6 | Section naming is inconsistent upstream: dashboard cards say "EBRW", the practice top bar says "Reading and Writing", analytics rows print the raw module string ("reading"/"math", upper-cased by CSS) | KEEP "EBRW" / "Math" as the short label and "Reading and Writing" as the long one, exactly where upstream uses each; the raw-string tag becomes the short label |

## Owner decisions surfaced by this inventory

| # | Question | Default the plan assumes |
|---|---|---|
| O1 | Wall of Love / About / GitHub star / hero (H3, H4): these are liprep-the-project, not the practice product. Drop? | **Drop** |
| O2 | liprep's in-joke copy (greetings, "Misclick prolly", "Nuke Everything", "fuck Oneprep"): keep verbatim or re-voice to Counselle's §13 voice with identical mechanics? | **Re-voice**, same mechanics and counts |
| O3 | Desmos: liprep ships Desmos's proprietary bundle + an API key it does not own. Use the official CB-SAT Desmos embed (free, no key), or obtain a Desmos API key? | **Official embed** |
| O4 | Offline/PWA (X1): out of scope for an authenticated server app? | **Out of scope** |
| O5 | College Board content licence (plan §9 R0) | **none — needs an answer** |
| O6 | Grading moves to the server (plan D2): "Check answer" becomes one network round trip instead of an instant local check, and needs a connection. Accept? | **Accept** |
| O7 | Free-response grading additionally accepts what College Board's published entry rule accepts and liprep wrongly rejects (e.g. `0.941` for 16/17) — plan §4.3. It never rejects anything liprep accepts. Accept? | **Accept** |
| O8 | The FIX list below: upstream defects not reproduced. Veto any line | **Accept all** |
| O9 | The dashboard greeting (F1): Counselle's house rule is no prose under a page title; liprep's greeting is its character. Keep it? | **Keep**, one line in the subtitle slot under a "SAT practice" title — the rule's one recorded exception |


## Deliberate differences from liprep

Everything a liprep user could notice that is **not** "our data, our accounts, our design
system". Each line is a decision the owner can reverse.

| Kind | Difference | Row |
|---|---|---|
| Honesty | Attempted counts are captioned "attempted", not "solved" (six places); donut slice "Correct, never missed"; pace-matrix and reinforcement subtitles say what is plotted / ranked; the pace line breaks at a band with no data; a radar axis with no data is labelled "no data"; the export toast says "Exporting <file>…", because a download link never reports completion | A2, A4, A5, A8, A12, S14, S15 |
| Honesty | Free-response grading follows College Board's published entry rule where liprep wrongly rejects (O7); rationale-mined answers are reviewed, never trusted blindly | Q22, Q24 |
| Defect | Calculator hidden on non-Math questions instead of stranded / covering the passage | Q35b |
| Defect | Highlighter acts only on R&W questions; one clipped passage + stem rule instead of ancestor accidents; un-highlight works | Q33, Q33a, Q34 |
| Defect | Enter is ignored while a focus-taking overlay (Info dialog, navigator, analytics modal) or a **fullscreen** tool is open — a floating or docked tool leaves it live, as upstream; `Esc` closes every overlay; the navigator light-dismisses; real dialog semantics and focus handling | Q10a, Q29a, Q38a, A15 |
| Defect | Tool windows cannot be dragged out of reach or resized to nothing; wide math scrolls instead of overflowing; figure `<style>` cannot restyle the page | Q35, Q35a, Q37, Q43a, Q43b |
| Defect | Saved filter selections are validated on load, so the dashboard cannot silently launch an empty list; chart tooltips are anchored to the thing they describe (radar axis, matrix dot) instead of a fixed point in the chart; the pace matrix's 72.5 s split is marked on its axis | F20, A7a, A8, S13 |
| Defect | Timer measures wall time in a background tab; counts refresh after import / reset / submit; calendar cells do not pretend to be clickable; streak correct across DST; accessible names follow state, and every blank has one | Q25a, F13, F14b, S21, Q38b, Q39 |
| Platform | A single attempt's recorded time is capped at 24 hours (a tab left open over a weekend); upstream has no cap | Q25 |
| Platform | Server-side grading: one round trip on "Check answer" (O6); progress on the account, not the device; no offline mode (O4) | Q25b, X1, X2 |
| Platform | Loading and empty states follow DESIGN §13 (skeleton frame, per-tab empty state) instead of a blank screen / empty chrome; a failed load says so and offers Try again instead of claiming the filters matched nothing | Q2a, Q2b, A1, A18 |
| Data | Bluebook exclusion uses College Board's own live-item list rather than liprep's static copy; it flags one question liprep's copy does not, so with the default filter on we hide one question liprep would show (plan §3.1) | F6 |
| Defect | A dialog is always above a tool window: opening Question Info covers the reference sheet, where upstream let the sheet float on top of the dialog's own overlay | Q35f |
| Design | A revealed option also *says* "Correct answer" / "Your answer" (status is never colour alone, DESIGN §14.3); upstream marks them by border and fill only | Q20 |
| Tools | Highlights are painted with the CSS Custom Highlight API rather than `<mark>` elements: they do not appear in print, are not exposed to assistive technology, and the tool is disabled (with an explanation) on browsers without `CSS.highlights` — upstream's marks work everywhere | Q33, Q34 |
| Additions | An empty session offers to relax the narrowest filter (DESIGN §13.3), where upstream offers only "Back to Filters"; tool windows can be moved and resized from the keyboard; one Float control instead of upstream's duplicate | Q2, Q38a, Q35 |
| Tools | Desmos is the official College Board test embed: its configuration is College Board's, not settable by us (O3) | Q36 |
| Layout | On a phone, **Start session** stays pinned to the bottom of the dashboard (upstream leaves it mid-page in the filter card) | F18 |
| Design encodings | Difficulty has one neutral encoding (number, tier word, ink tick) instead of upstream's three colour schemes; mastery chips use success for Mastered and neutral for the rest; EBRW / Math are told apart in the analytics charts by label, position and shape, not indigo / orange; band toggles carry no fill colour (`ui-spec.md` §2) | F7, Q30, S16, A7–A10 |
| Defect | Importing progress asks for confirmation before replacing everything; upstream replaces silently | A13 |
| Scope | liprep's landing page, import dropzone, Wall of Love, About, GitHub star, PWA install (O1, O4); decorative motion (X5) | H-rows, X1, X5 |
| Copy | In-joke strings re-voiced, same mechanics (O2); restating subtitles dropped | F1, A14, A16a |
