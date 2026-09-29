# SAT Practice — technical plan

**Status:** v6 — review loop closed: all six reviewers signed off PERFECT (see `review-log.md`). Awaiting owner decisions O1–O9 · **Branch:** `feat/sat-practice` · **Tier:** Large

| Document | What it holds |
|---|---|
| `plan.md` (this file) | decisions, data, backend, frontend architecture, phases, risks |
| `parity-inventory.md` | the row-by-row definition of "the same product" — every liprep behaviour with KEEP / ADAPT / FIX / DROP, and the table of **deliberate differences** the owner can veto. Row ids (`Q22`, `S13`, `O5` …) refer to it |
| `ui-spec.md` | the full UI/UX specification (layout arithmetic, every control's states, copy, charts, motion, accessibility) |
| `review-log.md` | what each review round found and changed |

---

## 0. The plan in one page

**What.** A new section of Counselle, `/app/sat`, that is liprep
(`github.com/liprep/liprep` @ `c84d3dc`, MIT): same dashboard, same Bluebook-style practice
screen, same tools, same analytics, same numbers. Three things differ because the brief
requires them: the question bank is ours (Postgres, downloaded from College Board's
official Question Bank) instead of a JSON file the student uploads; progress is saved to the
student's account instead of IndexedDB; it wears Counselle's design system.

**How: port, do not fork (§2).** liprep's *behaviour* is reproduced; its *code* is not
vendored. Its pure logic is ported function-for-function and **checked against the upstream
code itself by differential tests** (§8.2). Dexie, the 1,100–1,400-line page components,
6,000 lines of bespoke CSS and the service worker are replaced by Counselle's stack.

**"Same product" has one rule with teeth:** reproduce what a liprep user would call *the
product*; do not reproduce what they would call *a bug*. Upstream defects — the calculator
stranded on a Reading question, Enter submitting behind an open dialog, attempted counts
captioned "solved" — are FIXed, and every FIX is listed in the inventory's *Deliberate
differences* table for the owner to veto (O8).

**The decisions that shape everything**

| # | Decision | Why |
|---|---|---|
| D1 | The bank is fetched **once, offline**, built into a versioned seed file, and synced into `counselle.sat_*` at boot. No crawler worker, no runtime call to College Board | it changes a few times a year |
| D2 | **Grading is server-side.** The question payload carries no key and no rationale; `POST …/attempts` grades, records and returns them (O6) | one implementation of the honesty-critical rule, in `domain/`, hard-tested; the recorded attempt is authoritative |
| D3 | **Statistics are a pure Python function over the student's attempt log**, not SQL | identity with `getUserStatistics` is checkable against upstream vectors |
| D4 | Dashboard **inside** the workspace shell; practice screen a **full-viewport route outside it** | Bluebook is a focus environment; liprep gives it the whole window |
| D5 | HTML is transformed and sanitised **at render, in the browser**; a build gate **runs that same renderer over the whole corpus** and fails if it strips anything unexpected | one sanitiser, where the risk is; "nothing silently lost" measured with the real code path |
| D6 | A launched session is **fetched once per mount and held in the session's own state** — not in the query cache; everything in it is keyed by `question_id` | exactly liprep's lifetime: loaded once per visit to the practice page, re-evaluated on re-entry or reload, never mid-session |

**Owner decisions** (§11): O1 drop liprep's marketing chrome · O2 re-voice in-joke copy · O3
official Desmos embed · O4 no offline/PWA · **O5 College Board content licence — needs an
answer before the bank is published anywhere; it does not block development** · O6
server-side grading · O7 College Board's free-response entry rule · O8 the FIX list · O9
the dashboard greeting.

---

## 1. Goal, non-goals

**Goal.** Every KEEP / ADAPT / FIX row of `parity-inventory.md` is observable in Counselle,
with identical behaviour and identical numbers, on Counselle's design system and rules.

**Non-goals** — each would be a product change:
- No new practice features: no answer-letter hotkeys, arrow-key answer selection, shuffle,
  session caps, timed full-length tests, score prediction, spaced repetition.
- No Counselle-agent tools over SAT data (`app/sat/` is the seam a later plan would use).
- No workspace change events for attempts (ADR 0027 serves cross-feature objects).
- No separate PSAT products: assessment 99 holds every question the other two do (§3.1).
- No offline mode, no service worker (O4). No dark theme (DESIGN §3.4).

Accessibility, focus management and reduced motion are how Counselle builds any surface;
they apply in full (`ui-spec.md` §10).

---

## 2. Build strategy: port, do not fork

| Option | Verdict |
|---|---|
| **A. Embed liprep as-is** (iframe / second Vite entry, restyled) | Rejected: keeps IndexedDB as the store — no account sync, no server bank — plus a second router and font stack, 6k lines of CSS with hard-coded hex (DESIGN Law 1), four files over 1,000 lines. Restyling it *is* a rewrite |
| **B. Copy its files into `features/sat/` and refactor in place** | Rejected: both halves of every file are wrong for us — Dexie calls inline in components, class names bound to its own CSS. Replace both and what is left is the JSX skeleton and the pure logic — option C with a worse history |
| **C. Port: reproduce behaviour from the inventory; carry pure logic over under differential tests** | **Chosen** |

**Logic carried over** — small modules whose headers name the upstream function; MIT notice
in `THIRD_PARTY_NOTICES.md`:

| Upstream | Ported to | Checked by |
|---|---|---|
| `Practice.tsx::checkIsCorrect` (:48), `parseNumericValue` (:34) | `domain/sat/grading.py` | vectors |
| `db.ts::normalizeQuestion`, `normalizeDisclosedQuestion` | `domain/sat/normalize.py`, narrowed to the two real College Board shapes | G9 (narrow, §3.6) |
| `db.ts::extractSprAnswerFromRationale` | `domain/sat/spr_answers.py` — proposes keys for the legacy items that have none, cross-checks the rest (§3.5); never trusted unreviewed | vectors over every SPR rationale |
| `db.ts::getUserStatistics`, heatmap, streak | `domain/sat/stats.py` | vectors over generated logs |
| `db.ts::exportUserData` / `importUserData` | `domain/sat/progress_file.py` | round-trip with a file made by real liprep |
| `RichContent.tsx` transforms + DOMPurify config | `frontend/src/features/sat/sat-html.ts` | snapshot vectors |
| `TopicTree.ts` | `config/assets/sat/taxonomy.yaml` | G6 |

The port reproduces *observable numbers and behaviour*, not code shape: upstream's 355-line
`getUserStatistics` becomes a few < 50-line functions, its `Array.includes`-in-a-loop streak
a set lookup. The vectors are what stop a tidy-up from changing a number.

---

## 3. The question bank: acquisition → seed → database

### 3.1 The official source — measured

College Board's SAT Suite Question Bank is a SPA (`satsuitequestionbank.collegeboard.org` →
301 → `satsuiteeducatorquestionbank.collegeboard.org`) over four unauthenticated JSON
endpoints (`access-control-allow-origin: *`; no key, no cookie). Evidence in
`artifacts/sat-practice/research/`: all six list responses, the lookup response, and **204
detail responses** — 123 Math qbank, 48 R&W qbank, 29 legacy disclosed, 4 earlier singles.

| # | Call | Returns |
|---|---|---|
| E1 | `POST qbank-api.collegeboard.org/msreportingquestionbank-prod/questionbank/digital/get-questions` `{asmtEventId, test, domain}` | stubs: `questionId`, `uId`, `external_id` \| `ibn`, `skill_cd`, `skill_desc`, `primary_class_cd`(+`_desc`), `score_band_range_cd`, `difficulty`, `program`, `pPcc`, `createDate`, `updateDate` |
| E2 | `POST …/questionbank/digital/get-question` `{external_id}` | `type`, `stem`, `stimulus?`, `answerOptions[{id: uuid, content}]`, `keys[]`, `correct_answer[]`, `rationale`, `externalid`; on ~40 % of items also authoring metadata: `origin`, `templateid`, `vaultid`, `parenttemplateid`, `parenttemplatename`, `templateclusterid`, `templateclustername`, `position` |
| E3 | `GET saic.collegeboard.org/disclosed/{ibn}.json` | legacy shape: `[{item_id, section, prompt, body?, answer:{style, choices?:{a..d:{body}}, correct_choice?, rationale}}]` |
| E4 | `GET …/questionbank/lookup` | `lookupData` taxonomy, `mathLiveItems` / `readingLiveItems`, `stateOfferings` |

**Counts** (assessment 99 = SAT; `test` 1 = R&W: INI, CAS, EOI, SEC; `test` 2 = Math: H, P, Q, S):
- **3,770 stubs**: 1,845 R&W (all `external_id`); 1,925 Math — 1,466 `external_id`, **459
  `ibn`-only**. The absent id arrives as `null` *or* `""` (`ibn`: 1,775 `""`, 1,536 `null`);
  both normalise to `NULL`.
- **Identity.** `questionId` is an *assessment-scoped row id*: the same question carries
  three different `questionId`s under assessments 99, 100 and 102, with no overlap. A
  question's identity is its **content id** (`external_id`, else `ibn`). On content ids,
  100 ∪ 102 ⊂ 99 with nothing missing — one pass over 99 is the whole bank.
- **Three content ids are filed twice** under 99 → **3,767 unique questions**.
- **Bluebook flags.** E4 lists 2,037 live `external_id`s; **2,019** match an assessment-99
  stub, **18 match nothing**. liprep's static `bluebook_ids.json` has 2,018 ids, all
  assessment-99 `questionId`s, and **every one maps to a stub whose `external_id` is in E4's
  live set**; the residue runs the other way — **one** E4-live, stub-matched id
  (`ff0ab105-aa85-4cb3-a07f-f00a7c55c4e3`) is absent from liprep's list. E4 is our source of
  truth: with the default filter on, we hide one question liprep would show. Both residues are
  listed at build (G7), not asserted away.

**Content patterns** (from the 204 details — the basis for §3.3, G4, G5):

| Pattern | Measured | Consequence |
|---|---|---|
| R&W | 48/48 MCQ, 4 options, all with `stimulus`; the stem never begins with the stimulus | Q14's strip rule is a no-op on official data; kept, asserted harmless |
| Math qbank | 33 SPR / 90 MCQ; no `stimulus`; **no `<img>`, no remote *resource* URL** (the 794 `http://` strings in the Math sample are all `xmlns` / `xmlns:xlink` namespace declarations); inline SVG figures (22), tables, **`<mfenced>` × 617**, **14 SVG `<style>` elements: 12 × `*{stroke-linecap…}`, 2 × a three-rule `.small` / `.heavy` / `.Rrrrr` font block with an interleaved CSS comment** (the classes are used by the figure's `<text>`) | the `mfenced` rewrite is hot-path, not an edge case; figure `<style>` must survive sanitising (§6.2) |
| SPR keys (qbank) | `correct_answer` enumerates accepted forms: `[".9411", ".9412", "16/17"]`, `["284/3", "94.66", "94.67"]`, `["-13/2", "-6.5"]`, `["1.636", "18/11"]`, `["6.21"]` | the official key is the key (§3.5) |
| Legacy disclosed (29) | all Math; 15 have `body` ≠ `prompt`; **251 `<img>`, every one an inline `data:` PNG** with spoken-math `alt` text, none remote; items average 21 KB, the largest 150 KB | the bank file is ~12–14 MB, mostly these images |
| **Legacy SPR** | **4 of 29 (~14 % ⇒ ~60 items) — and their `answer` object is just `{style, rationale}`: there is no key field at all.** The answer exists only in prose: "The correct answer is 75." | this, not community dumps, is why liprep mines rationales. §3.5 |

Figures are expectations recorded for reviewers. Code never hard-codes them: each run is
audited against its own manifest and the previous one.

### 3.2 Pipeline

```
python -m app.sat fetch      → artifacts/sat-practice/raw/<run>/        (gitignored, lossless)
python -m app.sat build      → deploy/seed/sat/{bank.jsonl.gz, MANIFEST.json, AUDIT.md}
                               artifacts/sat-practice/raw-<sha>.tar.gz  (lossless archive)
npm run sat:audit-html       → G5 report, recorded in AUDIT.md          (separate step, §3.6)
python -m app.sat bank-sync  → counselle.sat_*                          (every boot)
```

**`fetch`** — `adapters/collegeboard/client.py`, the only module that talks to College Board.
- `httpx.AsyncClient` + the existing `TokenBucket` (enabling refactor E-1). **One bucket
  across both hosts**, `sat_fetch_requests_per_second = 4` (a full run ≈ 16 min).
- `sat_fetch_user_agent`: its own setting (two crawls, two hosts, two reasons to change).
  The contact-URL rule is extracted into one module-level helper in `config/settings.py`
  used by both field validators, and the `<domain>`-placeholder check in
  `_validate_deploy_auth_posture` gains a second clause — the repo has those two checks in
  two places for a reason (pydantic-settings runs field validators against defaults), and
  that split is kept.
- **robots.txt, decided.** Both API hosts answer `/robots.txt` with **403** (measured
  2026-09-19: API-Gateway `{"message":"Forbidden"}`, S3 `AccessDenied`) — the file does not
  exist and the gateway refuses the path. `adapters/collegedata` aborts a pass on any
  non-404 error; inheriting that would make this fetch impossible for a reason unrelated to
  the publisher's wishes. Policy here, written into the adapter's header: fetch robots.txt
  per host; 200 → obey it; 404 → allowed; **other 4xx → "unavailable", which RFC 9309
  §2.3.1.3 defines as allowed**; 5xx → abort. The outcome per host goes into `AUDIT.md`.
  The public site's robots.txt (`User-agent: *`, no rules) is recorded too. This settles
  crawl etiquette only; whether we may *use* the content is R0, a separate question.
- No evasion of any kind; no browser impersonation.
- Order: E4 → E1 for 99 × {1, 2} → E1 for 100 and 102 (**only** to re-assert the content-id
  superset) → E2/E3 per stub.
- **Resumable and idempotent.** Each response is written verbatim to disk before anything
  parses it; a rerun skips what exists. 4 retries with exponential backoff on
  429 / 5xx / timeout / connect error (the sample run hit transient connect timeouts to
  `saic`). A stub whose detail still fails goes to `failures.json` and **fails the run**.
- Response-size cap and JSON content-type check (the `collegedata` adapter's posture).

**`build`** — pure and deterministic: raw → `domain/sat/normalize.py` → `bank.jsonl.gz`,
sorted by `question_id`, stable key order, fixed gzip mtime. It makes no network or npm
call.

**What is committed, and what is not.**
- `MANIFEST.json` (sha256 of the bank and of the raw archive, counts, `fetched_at`, endpoint
  list, robots outcomes, upstream pin) and `AUDIT.md` — always committed; a few kB.
- `bank.jsonl.gz` — ~12–14 MB (base64 PNGs do not compress). Repo precedent is
  `schools.csv.gz` 6.7 MB and `parked/` 7.6 MB, no git-lfs; this is larger and is rewritten
  whole on each refresh. **It is committed only if O5 is answered "yes, in the repo".**
  Until then it sits at the same path, gitignored, and everything works locally; if O5 says
  "not in the repo", deploy places the file at `sat_bank_path` (Settings; default
  `deploy/seed/sat/bank.jsonl.gz`). One code path either way. A bank > 25 MB stops the
  build and asks.
- The raw archive (every response College Board sent, ~25 MB) is **never committed**. Its
  sha256 is in the manifest, so the bank can always be re-derived and re-audited. Copying
  it off the workstation is a P2 exit item (the school-data-v3 lesson).

**"Miss nothing", precisely.** The raw archive is lossless. The *served rows* deliberately
omit: `skill_desc` / `primary_class_cd_desc` (in `taxonomy.yaml`, G6); `pPcc` (program +
domain concatenated); option UUIDs and `keys` (consumed by G4); disclosed `section` (the
stub's `test` is authoritative); E4 `stateOfferings`; and E2's authoring metadata
(`origin`, `templateid`, `vaultid`, `parenttemplateid`, `parenttemplatename`,
`templateclusterid`, `templateclustername`, `position`) — College Board's internal item
provenance, with no product surface in liprep or here. Nothing a student can see, filter
on or be graded by is dropped.

**`bank-sync`** — runs on **`COUNSELLE_DB_APP_DSN`** (`counselle_app` owns `counselle.*`;
the pipeline role has no grant there).
- `scripts/entrypoint.sh`: a new line **after** `yoyo apply`. `scripts/dev.py`: in
  `run_stack` after migrations, not only in `reset-db`.
- One transaction, opened with `pg_advisory_xact_lock(hashtextextended('sat_bank_sync', 0))` —
  a named-key module constant in `app/sat/bank.py`, following `app/facts/crawl.py`'s precedent
  (the workspace services' per-row `(text, tag)` family does not fit a lock with no row) — so
  two instances booting together serialise instead of
  deadlocking.
- **No-op test:** manifest sha == `sat_bank_meta.content_sha256` **and**
  `sat_bank_meta.question_count == count(*)` of live (non-retired) rows — `question_count` is
  the bank file's row count, which is exactly the live rows after a successful sync. (A truncated table or a swapped
  file re-syncs; the every-boot cost is two cheap queries.)
- Otherwise: verify the file's sha256 against the manifest — mismatch → log an error, change
  nothing, exit 0 (the app boots on the bank it has). Then `executemany` upserts, **ordered
  by `question_id`**, in FK order — questions → content → aliases; `executemany` is
  per-statement, so the pool's 8 s `statement_timeout` is never at risk (one multi-row
  statement over ~13 MB of HTML would be). Set `retired_at` on rows absent from the new
  bank, clear it on rows that returned, write the meta row.
- No bank file → one warning, exit 0. **Never deletes** — attempts and bookmarks reference
  ids.

### 3.3 Normalisation (`domain/sat/normalize.py`)

Output: `SatQuestion` (frozen pydantic model — `domain/` is stdlib + pydantic by convention).

| Field | E2 (`qbank`) | E3 (`disclosed`) |
|---|---|---|
| `question_id` | stub `questionId` under assessment 99 | same |
| `external_id` / `ibn` | stub; `""` and `null` → `NULL` | same |
| `module` | stub `test`: 1 → `reading`, 2 → `math` | same (never from `section`) |
| `item_type` | `type` | `answer.style` = "Multiple Choice" or `choices` present → mcq; else spr |
| `stimulus`, `stem` | Math: `stem = stimulus + "\n" + stem`, `stimulus = NULL` (Q13). R&W: strip a leading copy of the stimulus from the stem (Q14) | Math: `body + "\n" + prompt` when both present and different, else whichever exists (15/29 sampled have both) |
| `answer_options` | `[{label, content}]`, label = position letter A–D (Q17) | `choices` sorted by key → A–D |
| `correct_answers` | mcq: `correct_answer` letter, cross-checked against the position of `keys[0]` among the option UUIDs (G4). spr: `correct_answer` verbatim + reviewed additions (§3.5) | mcq: `correct_choice.upper()`. **spr: the reviewed key from `spr_keys.yaml` (§3.5) — the source has none** |
| `rationale` | `rationale` | `answer.rationale` |
| `in_bluebook` | `external_id ∈ E4 live items` | false; G7 asserts no disclosed id is flagged |
| `domain_cd`, `skill_cd`, `score_band`, `difficulty`, `program`, `u_id` | stub, verbatim | same |
| `cb_created_at`, `cb_updated_at` | stub `createDate` / `updateDate`, epoch ms → `timestamptz` | same |

**Duplicates.** For each content id filed under two `questionId`s: the canonical
`question_id` is the one in liprep's Bluebook list if either is, else the lexicographically
smaller; the other becomes a `sat_question_aliases` row, so a liprep deep link or an
imported attempt under either id resolves.

**Nothing is dropped silently.** liprep's `return null` paths (no id, no stem, mcq without
options or key) become `build` failures naming the ids, resolved only by a fix to the
normaliser or an adjudicated entry in `AUDIT.md`'s allow-list (G4's shape). An E3 response
must be a single-element array (G1). A free-response key of `"0"` is a
**real answer**; only an *absent* key fails the build. (Upstream treats an all-`"0"` key as
"missing" because community dumps use `"0"` as filler. Not ported.)

### 3.4 Schema — migration `0021_sat_practice.sql` (+ `.rollback.sql`)

Header `-- depends: 0019_drop_school_requirements 0020_essay_sessions 0020_task_sort_order`
— the tree has **three** heads today; naming all three leaves one. (yoyo splits `depends`
on whitespace and topologically sorts; this is the repo's first multi-parent header.) The
rollback file lists its `DROP`s **child-first** — yoyo pairs rollback statements
positionally against the reversed apply list. Applied and rolled back locally before the PR.

```sql
CREATE TABLE counselle.sat_questions (
  question_id     text COLLATE "C" PRIMARY KEY,   -- assessment-99 questionId: 8 lower-case hex
  external_id     uuid UNIQUE,                    -- natural key (qbank)
  ibn             text UNIQUE,                    -- natural key (disclosed)
  u_id            uuid NOT NULL,
  source          text NOT NULL,                  -- 'qbank' | 'disclosed'
  module          text NOT NULL,                  -- 'reading' | 'math'
  domain_cd       text NOT NULL,
  skill_cd        text NOT NULL,
  score_band      smallint NOT NULL CHECK (score_band BETWEEN 1 AND 7),
  difficulty      text NOT NULL,                  -- 'E' | 'M' | 'H'
  program         text NOT NULL,
  item_type       text NOT NULL,                  -- 'mcq' | 'spr'
  in_bluebook     boolean NOT NULL,
  cb_created_at   timestamptz,
  cb_updated_at   timestamptz,
  content_sha256  text NOT NULL,
  retired_at      timestamptz,
  CHECK ((external_id IS NULL) <> (ibn IS NULL))
);
CREATE INDEX sat_questions_filter_idx ON counselle.sat_questions (skill_cd, score_band)
  WHERE retired_at IS NULL;

CREATE TABLE counselle.sat_question_content (     -- wide HTML, read one row at a time
  question_id     text COLLATE "C" PRIMARY KEY REFERENCES counselle.sat_questions(question_id),
  stimulus        text,
  stem            text NOT NULL,
  answer_options  jsonb NOT NULL DEFAULT '[]',
  correct_answers text[] NOT NULL CHECK (cardinality(correct_answers) >= 1),
  rationale       text NOT NULL
);

CREATE TABLE counselle.sat_question_aliases (
  alias_id    text COLLATE "C" PRIMARY KEY,
  question_id text COLLATE "C" NOT NULL REFERENCES counselle.sat_questions(question_id)
);

CREATE TABLE counselle.sat_bank_meta (            -- single row
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  content_sha256 text NOT NULL, question_count integer NOT NULL,
  fetched_at timestamptz NOT NULL, synced_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE counselle.sat_attempts (
  id                 bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id            uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  client_attempt_id  uuid NOT NULL,               -- retry-safe submit (§4.3)
  question_id        text COLLATE "C" NOT NULL,   -- deliberately not a foreign key (below)
  module             text NOT NULL,
  domain_cd          text NOT NULL DEFAULT '',
  skill_cd           text NOT NULL DEFAULT '',
  score_band         smallint NOT NULL,
  user_answer        text NOT NULL,
  is_correct         boolean NOT NULL,
  time_spent_seconds integer NOT NULL CHECK (time_spent_seconds >= 1),
  solved_at          timestamptz NOT NULL DEFAULT now(),
  local_date         date NOT NULL,
  UNIQUE (user_id, client_attempt_id)
);
CREATE INDEX sat_attempts_user_time_idx     ON counselle.sat_attempts (user_id, solved_at, id);
CREATE INDEX sat_attempts_user_question_idx ON counselle.sat_attempts (user_id, question_id, solved_at, id);

CREATE TABLE counselle.sat_bookmarks (
  user_id       uuid NOT NULL REFERENCES counselle.users(id) ON DELETE CASCADE,
  question_id   text COLLATE "C" NOT NULL,
  bookmarked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);
```

Notes for the migration's reviewer:
- **Metadata and content are split** so `/counts` and `/session` — hit on every filter click
  — scan a narrow table and never touch TOASTed HTML.
- **`COLLATE "C"`** is new to this repo and is declared on every `question_id` column so
  joins, `USING` and `DISTINCT ON` never mix collations. liprep's session order is IndexedDB
  primary-key order — plain code-unit order of `questionId`. Every id today is 8 lower-case
  hex characters, for which any collation agrees; `"C"` makes the guarantee independent of
  the database's locale. G3 asserts the id shape, so case-insensitive lookup (P0.4) is
  `lower($1)` against the primary key — no extra index.
- **Enumerations are validated in app code** (`Literal` types) on `sat_questions`, as in the
  existing `counselle.*` tables. `sat_attempts.module`, `domain_cd` and `skill_cd` are
  deliberately **free text**: an imported log may carry unknown or empty codes, and S7 / S17 /
  S18 define what the stats do with them. Range and cardinality checks stay: they guard arithmetic.
- **Attempts denormalise module/domain/skill/band and have no FK to questions.** That is
  liprep's model (S7) and the right one: an attempt is a historical fact about what the
  student saw; a College Board reclassification must not rewrite past analytics; an imported
  `.liprep` file may name ids our bank does not hold (A13a). `submit` can only insert an id
  it just loaded, which is where integrity matters.
- **Retired questions:** excluded from `/counts` and from *filtered* `/session` lists (so a
  retired bookmark drops out of a Bookmarks session, and its count); still returned by
  `/session?question=`, `/questions/{id}` and `POST …/attempts`, so a deep link keeps working.

### 3.5 Free-response keys

Two populations, two rules — and one principle: **a regex never decides what is correct;
a person does.**

**qbank SPR (~500 items): the official key is the key.** College Board's `correct_answer`
enumerates the accepted forms (§3.1). The ported extractor runs as a **cross-check (G10)**:
every value it finds in the rationale that the grader (§4.3) would *not* already accept
against the official key is listed in `AUDIT.md` with its sentence. Because grading is
numeric, almost everything it finds is already accepted; the residue is a genuine second
answer ("The correct answers are 3 and 4") missing from the key.

**Legacy disclosed SPR (~60 items; 4 of 29 sampled, so a 95 % interval of roughly 20–150):
the source has no key field.** The answer exists only in the rationale — and the legacy corpus
renders math as images (251 `<img>`, every one with spoken-math `alt` text, 246 marked
`role="math"`), so a fractional or radical answer may exist *only inside an `alt`*. The ported
extractor reads `alt` text as well as text nodes (upstream's does too) and **proposes** a key
for each; `build` writes them to `AUDIT.md` (id, proposed key, the sentence or `alt` it came
from), and **every one is confirmed by a person**. Where the extractor proposes nothing, the
reviewer authors the key.

Both kinds of decision live in `config/assets/sat/spr_keys.yaml`:
`question_id: {keys: […], source: "rationale" | "manual" | "added", note: …}` (`rationale` = extractor's proposal confirmed; `manual` = reviewer-authored, with the quoted sentence or `alt`; `added` = a G10 addition to an official key). `build` fails while any
legacy SPR item lacks a confirmed entry, or any G10 finding is undecided. **Adjudication
bias, written down:** marking a right answer wrong is the worse error, so a G10 value is
*added* unless it is demonstrably not an answer to the question (a number from the worked
steps); each rejection carries its reason. If the two lists together exceed 200 items, stop
and re-plan rather than adjudicate at that scale by hand.

The on-screen "Accepted: …" list (Q23) is therefore College Board's list plus reviewed
additions — not liprep's machine-augmented one. Recorded under *Deliberate differences*.

### 3.6 Audit gates — what "miss nothing" means, executably

`python -m app.sat audit` (run by `build`) writes `AUDIT.md` + `MANIFEST.json` and exits
non-zero on failure. G5 is a separate step (it needs a browser-like DOM); `AUDIT.md` records
its result and P2 does not close without it.

| Gate | Assertion |
|---|---|
| G1 coverage | every assessment-99 stub has a saved detail response; `failures.json` empty; **every E3 response is a single-element array** — upstream reads `[0]` and discards the rest, so a longer response would be content silently lost; it fails the build naming the `ibn` |
| G2 superset | content ids under assessments 100 ∪ 102 ⊆ those under 99. Companion: `questionId`s are **disjoint** across assessments — recorded so nobody later "fixes" a refresh by matching on them |
| G3 identity | every stub has exactly one content id after `"" / null → NULL`; every `questionId` matches `^[0-9a-f]{8}$`; duplicate groups listed, each resolving to one canonical id + aliases; `unique = stubs − Σ(group − 1)` |
| G4 keys | mcq: exactly 4 options (exceptions listed by id; the list must be empty or each adjudicated), exactly one correct letter, and for qbank `keys[0]` sits at that letter's position. spr: ≥ 1 key, each parses under `parse_numeric`; every legacy SPR has a confirmed `spr_keys.yaml` entry |
| G5 render | **the real renderer over the corpus** — a vitest spec (`features/sat/sat-html.corpus.test.ts`, jsdom, run by `npm run sat:audit-html` with the bank path in an env var; skipped when absent). For every stimulus, stem, option and rationale it runs `normalizeSatHtml` + the feature's DOMPurify instance and collects DOMPurify's `removed` list. One test with `testTimeout: 600_000`; failures are collected and reported as a batch, not thrown per item. Pass = nothing removed beyond a reviewed ignore-list. Also asserts: no `http(s):` URL in `src` / `href` / `xlink:href` / CSS `url()` (every `url(#…)` and `xlink:href="#…"` is a fragment); every `data:` URI is `image/png\|jpeg\|gif` and sits on an `<img>`; no `<script>`; every `<style>` sits inside an `<svg>`; **the style rewrite's own dropped / unparsed report is empty** (hook removals never appear in DOMPurify's `removed`) |
| G6 taxonomy | the set of `(module, domain_cd, skill_cd)` in the bank == `taxonomy.yaml` (29 skills, 8 domains, no skill in two domains). Names compared after `strip()` and case-folding — the stubs carry trailing spaces and both "Cross-text" and "Cross-Text Connections"; `taxonomy.yaml` keeps liprep's display strings; residual variants are listed |
| G7 bluebook | E4 live ids with no stub (18 on 2026-09-19), liprep ids outside our `in_bluebook` set (0), and E4-live stub-matched ids absent from liprep's list (1) are each **listed and adjudicated**, not asserted absent; no disclosed item flagged |
| G8 drift | per domain × difficulty × band counts vs the previous manifest; added / retired / content-changed ids listed |
| G9 normaliser parity | **narrow by design.** Upstream's importer expects community-dump JSON, so our raw pairs reach it through a harness wrapper that merges stub + detail, sets `module` and pre-letters the options; what is compared is therefore only what that wrapper does *not* decide: the `type` discriminator, the stimulus/stem splice (Math merge, R&W prefix strip), the disclosed body/prompt combination, and the reject rules. `tests/domain/sat/upstream/DIFFERENCES.md` lists everything outside that scope and why (renamed fields; `difficulty` words vs codes; band clamp; the id fallback chain; option lettering; SPR keys, §3.5; duplicate-id renaming in `parseAndIngestJSON`, replaced by G3's canonical-id rule; `DomainPerformance.skills`, S22) |
| G10 spr | §3.5 — no undecided finding; no unconfirmed legacy key |

---

## 4. Backend

### 4.1 Layout (ADR 0017: `domain ← app ← adapters / api`)

```
domain/sat/             pure: stdlib + pydantic, no I/O
  types.py              SatQuestion, Attempt, Bookmark, SatFilter, SolvedStatus, UserStats
  taxonomy.py           Taxonomy value object (app/ loads the yaml and constructs it)
  normalize.py          raw College Board → SatQuestion                       §3.3
  grading.py            is_correct(item_type, keys, answer)                   §4.3
  spr_answers.py        rationale → candidate keys                            §3.5
  stats.py              compute_user_stats(attempts, today), heatmap          §4.4
  progress_file.py      .liprep encode / decode + validate                    §4.6
adapters/collegeboard/client.py     the four endpoints, robots policy         §3.2
app/sat/
  __main__.py           CLI: fetch | build | audit | bank-sync | export-liprep-json
  bank.py               build + sync orchestration
  errors.py             SatNotFoundError, SatValidationError
  models.py             request / response models
  service_questions.py  counts, session list, question read
  service_attempts.py   submit (grade + record), history, bookmarks
  service_progress.py   stats, export, import, reset
api/routes/sat.py       thin HTTP, mounted in api/main.py under /v1
config/assets/sat/      taxonomy.yaml, spr_keys.yaml
```

Every service function takes `(pool, user_id, …)`; `user_id` comes only from
`Depends(current_active_user)`.

**Own error mapping, own rate buckets.** `map_workspace_errors` emits "Workspace item not
found."; `workspace_write_rate_limit` would make SAT answers share one budget with task and
essay edits and throttle with "Too many workspace updates". So `api/routes/sat.py` has a
small `map_sat_errors` over `app/sat/errors.py` → `EnvelopeError` (the precedent is
`app/cds/errors.py` + `cds_admin.py`). `api/ratelimit.py` gains `check_sat_write` and
`check_sat_read` on `SlidingWindowLimiter` **and their admitting overrides on
`_NoopLimiter`** — that class overrides every check individually, so a method added only to
the base would make a missing limiter *enforce*, inverting its deliberate fail-open — plus
two `Depends` factories. Settings: `sat_writes_per_minute = 120`,
`sat_question_reads_per_minute = 600`. `require_json` is generic and reused.

**Why a read limit here when no other GET has one.** `GET /questions/{id}` is the one
endpoint that lets a signed-in account walk an entire licensed corpus in 3,767 requests —
the exposure R0 is about. 600/min is far above a student with prefetch on and turns a bulk
scrape into a throttled event.

### 4.2 API (`/v1/sat/…`, all auth-required)

| Method · path | Purpose | Notes |
|---|---|---|
| `GET /taxonomy` | modules → domains → skills (codes, names, display order), band tiers, short / long section labels (X6) | static; `Cache-Control: private, max-age=86400` |
| `GET /counts?bands=&status=&exclude_bluebook=` | `{skill_cd: n}` for **all 29** skills (F13) | §4.5; skills with no match are filled with 0 from the taxonomy |
| `GET /session?skills=&bands=&status=&exclude_bluebook=` | ordered `[{id, score_band, content_sha, bookmarked, ever_correct, ever_incorrect}]` | the whole session as light rows; an **empty** `skills` or `bands` means *all* (F20); `ORDER BY question_id` |
| `GET /session?question=<id>` | the same row shape for one question (P0.4) | an **id lookup, not a filtered list**: resolves the alias table, then `lower($1)`, exactly as `/questions/{id}` does, and **ignores `retired_at`**. One endpoint so the client renders any session identically, one row or 1,900 |
| `GET /questions/{id}` | one question **without** `correct_answers` / `rationale` | resolves the alias table then the primary key, both on `lower(id)`; weak ETag + 304 through the existing `api/deps.py::etag_response`; read-limited |
| `POST /questions/{id}/attempts` `{client_attempt_id, answer, time_spent_seconds, local_date}` | grade + record → `{is_correct, correct_answers, rationale, attempts[]}` | §4.3 |
| `GET /questions/{id}/attempts` | the student's history for one question | |
| `PUT` · `DELETE /bookmarks/{id}` | idempotent set / clear | not a toggle: a retried request must not flip the state back |
| `GET /stats?today=YYYY-MM-DD` | `UserStats` (liprep's exact shape) + heatmap `{date: n}` | §4.4 |
| `GET /progress/export?today=YYYY-MM-DD` | `.liprep` file; filename `<today>.liprep` through the existing header-injection-safe helper — today a module-private `_content_disposition` in `api/routes/documents.py`; enabling change E-8 moves it to `api/deps.py` beside `etag_response` as `content_disposition(filename)` | a GET that only reads the caller's own rows; `Cache-Control: no-store` |
| `PUT /progress?today=YYYY-MM-DD` | import = **replace** (A13), one transaction | §4.6 |
| `DELETE /progress` | reset: attempts + bookmarks only (A14) | |

`today` is the device's local date, validated like `local_date` (§4.3): upstream names the
export after the device's date and defaults missing import fields to the device's today.

### 4.3 Submitting and grading

`service_attempts.submit`: load the question (alias-resolved; 404 if unknown) → validate →
`grading.is_correct` → insert (retry-safe, below) with
the question's **current** module / domain / skill / band → return verdict, key, rationale
and the attempt list, all in one round trip (Q20, Q23, Q27, Q28 need all four at once).

- **Retry-safe, not idempotent-by-question.** A second submit of the same question is a real
  second attempt (Q26). What must never create a second row is a *retry of the same press*
  after a lost response — impossible in liprep, and it would shift overall accuracy, attempt
  counts and average pace. The client mints `client_attempt_id` when the button is pressed.
  The statement is `INSERT … ON CONFLICT (user_id, client_attempt_id) DO NOTHING RETURNING
  id, is_correct, user_answer`; when it returns no row, the same transaction `SELECT`s the
  existing row and answers from **it** — verdict, key, rationale, `user_answer`: the first
  press is authoritative. A press with a *changed* answer mints a **new** id (§5.5); a
  conflict whose payload differs from the stored row is logged as a warning and still
  answered from the stored row.
- `answer`: mcq must be one of the question's labels; spr must match `^[0-9./-]{1,7}$`
  (liprep's input mask, Q21). Else 422.
- `time_spent_seconds`: `max(1, round(x))` (Q25); upper clamp `sat_attempt_max_seconds`
  (86,400) — applied on import too (Q25).
- `local_date`: the student's calendar date at submit (liprep's `dateKey` is local, F15).
  Accepted iff it is a date that exists somewhere on Earth at that instant:
  `utc_date − 1 ≤ local_date ≤ utc_date + 1` (UTC−12 … UTC+14). Storing it keeps the heatmap
  stable when a student travels, as liprep's stored `dateKey` does. A forged value can only
  move the student's own square by a day.

**`grading.is_correct`** is liprep's rule, in order (Q22): (a) case-insensitive string match
against any key; (b) leading-zero equivalence (`.5` ≡ `0.5`, `-.75` ≡ `-0.75`); (c) for spr,
numeric equivalence — decimal or `a/b`, `|user − key| < 1e-6`.

**Plus one acceptance path liprep lacks (O7).** College Board's SPR directions (verbatim,
digital practice tests): *"Your answer can be up to 5 characters for a positive answer and
up to 6 characters (including the negative sign) for a negative answer… If your answer is a
decimal that is too long (over 5 characters for positive, 6 characters for negative),
truncate it or round at the fourth digit."* Their own table for 2/3 accepts `.6666`,
`.6667`, `0.666`, `0.667` and rejects `0.66`, `.66`, `0.67`, `.67` — i.e. the entry must
**fill the field**; that reading is ours, taken from their table. liprep accepts only the
forms the key happens to list: for 16/17 the key lists `.9411` and `.9412`, so it marks
`0.941` wrong. Telling a student a right answer is wrong is the one thing this product may
not do.

> **(d)** applies only when the key set yields an unambiguous exact value **V**: a key of the
> form `a/b` (if several, all numerically equal); failing that, a single decimal key that
> every other decimal key equals. With no such V — e.g. a key of two differently-rounded
> decimals and no fraction — (d) does not apply. Given V and the trimmed entry `e`: accept
> iff `e` matches `^-?(\d+\.\d+|\.\d+)$`; `len(e) == 6 if e[0] == "-" else 5` (sign and
> point count); V's exact decimal expansion has a non-zero digit beyond `e`'s last place
> (always true for a non-terminating fraction); and `e` equals V **truncated toward zero** or
> **rounded half away from zero** to the number of decimal places in `e`. (Toward zero matters
> for negatives: −2/3 truncates to −0.666, which College Board accepts; `floor` would give
> −0.667.) Computed with `fractions.Fraction` / `Decimal`, never floats.

(d) is a fourth `or`: it can only add acceptances and never rejects what (a)–(c) accept.
Entries longer than College Board's field (liprep allows 7 characters) are judged by
(a)–(c) alone. Hand-derived vectors: every fraction key in the bank × {both truncations,
both roundings, with and without leading zero, negative, one digit short, one digit wrong},
plus the no-V cases and College Board's 2/3 table.

### 4.4 Statistics (`domain/sat/stats.py`)

`compute_user_stats(attempts, today) -> UserStats` reproduces `getUserStatistics`'s numbers,
quirks included — they are the product. The inventory's S-rows are its specification and
are named one by one in the module docstring: first / latest semantics (S1–S5); averages and totals per scope (S6); the **split
between per-question quantities read from the first attempt and per-attempt quantities read
from each attempt** (S7); per-attempt band stats, bands 1–7 only (S8, S19); ranking with
stable ties and reversed strongest (S9); only the eight known domains aggregate (S17);
unknown and empty skill codes (S18); every empty scope is 0, never null (S20).

Porting traps, each pinned by vectors:
- **Rounding.** JS `Math.round` rounds half **up**; Python `round` rounds half to **even**.
  `_js_round(x) = floor(x + 0.5)`; every rounded quantity is non-negative.
- **Ordering.** `ORDER BY solved_at, id` — the one definition of "latest", used by stats,
  counts and the Mistakes filter alike (S12), and the order of every attempt list the API
  returns (`GET …/attempts` and the submit response: oldest first, the new attempt last, Q28). Import assigns ids in file order.
- **Streak (S21).** Upstream walks back in fixed 86,400,000 ms steps over local date keys,
  so on a DST change it can count a date twice or skip one. We step by calendar day:
  identical on every other day, right on those two. The vectors avoid transition dates.

`today` is a parameter — the client reads the device date **once when the dashboard mounts**
(upstream fixes it at load too), not inside the query function, so a refetch on window focus
never flips "Today" at midnight mid-visit — so streak and "today" (F16–F17) are computed in the student's day
and the function stays clock-free. Cost: one indexed range scan per `/stats` call, then
linear passes; at 20,000 attempts < 50 ms.

### 4.5 Counts and session SQL

One shared fragment, a module constant, parameterised and explicitly typed (asyncpg cannot
infer a bare `$n` inside `CASE` / `NOT`); the service passes non-null values for every
parameter:

```sql
WITH latest AS (   -- one row per attempted question: was the LATEST attempt correct?
  SELECT DISTINCT ON (question_id) question_id, is_correct
  FROM counselle.sat_attempts WHERE user_id = $1::uuid
  ORDER BY question_id, solved_at DESC, id DESC
)
SELECT q.skill_cd, count(*)
FROM counselle.sat_questions q
LEFT JOIN latest l USING (question_id)
LEFT JOIN counselle.sat_bookmarks b
       ON b.user_id = $1::uuid AND b.question_id = q.question_id
WHERE q.retired_at IS NULL
  AND (cardinality($2::smallint[]) = 0 OR q.score_band = ANY($2::smallint[]))  -- empty = all
  AND (NOT $3::boolean OR NOT q.in_bluebook)
  AND CASE $4::text
        WHEN 'unsolved'   THEN l.question_id IS NULL        -- F5: never attempted
        WHEN 'incorrect'  THEN l.is_correct IS FALSE        -- F4: latest attempt wrong (NULL-safe)
        WHEN 'bookmarked' THEN b.question_id IS NOT NULL
        ELSE true END
GROUP BY q.skill_cd;
```

Counts ignore the skill selection, as upstream's do (each skill shows what *it* would
contribute). `/session` uses the same `WHERE` plus
`(cardinality($5::text[]) = 0 OR q.skill_cd = ANY($5::text[]))` — an empty list means all,
as upstream's `selectedTopics.length === 0` does — selects the light columns and two
`EXISTS` flags over `sat_attempts_user_question_idx`, `ORDER BY q.question_id`. `status` is
a `SolvedStatus` literal before it reaches SQL. Route tests pin all four statuses against
liprep's semantics with a fixture log.

### 4.6 Progress file

`.liprep` v1, compatible with upstream (A12): same keys, pretty-printed, `solvedAt` in
epoch ms, `dateKey` = `local_date`, attempt ids omitted. Import validates rows as upstream
does (A13a): `version` unchecked; a row needs a string `questionId` and a boolean
`isCorrect`; `module` → `reading` when missing (any other string is stored as given — S7 buckets everything that is not `"math"` as EBRW, so it is not validated as a literal), band → 3, seconds → 1, `solvedAt` → now, `dateKey` →
`today`; a missing `primary_class_cd` / `skill_cd` → `''` (the column default — the empty-code
case of S17 / S18). It resolves aliases, keeps unknown ids (§3.4), assigns ids in file order, mints a
`client_attempt_id` per row, replaces attempts **and bookmarks** even when the file has
none — one transaction, `executemany`. `isCorrect` is taken from the file, as upstream does:
it is the student's own history.

Stated differences from upstream's importer, each in A13a: seconds floored to 1 and band
clamped to 1–7 (upstream applies both to native data and forgets them on import); a
`dateKey` that is not a date falls back to the date of `solvedAt` instead of failing the
file. A future `solvedAt` is kept as is, as upstream keeps it.

**One cap, not two.** The process already rejects bodies over `max_request_body_bytes`
(16 MiB) before any route runs — the repo's only pre-parse mechanism. Upstream's
pretty-printed export measures ~325 bytes per attempt, so that ceiling is ~51,000 attempts —
beyond any student. The enforced cap is lower (12 MiB ≈ 38,000 attempts, the whole bank answered ten times over): `sat_import_max_bytes` defaults to 12 MiB — below the global ceiling, so our own 413 and its
sentence are what the student sees, rather than the middleware's bare 400 on a truncated body.
It is checked against the declared `Content-Length` by a small dependency before the body is
read, and against the read length after (a chunked upload declares none). No row cap. A 413 carries "That file is too large to import."

---

## 5. Frontend architecture

### 5.1 Routes (`frontend/src/app/router.tsx`)

Both pages follow the `pages/*.tsx` one-line re-export convention and use the router's
existing `lazy:` form (react-router 8; today used by `/dev/*`). The practice route is a
child of `OnboardingGate`, a **sibling** of `path: "/app"` and `path: "/onboarding"`: route
ranking puts the four-segment static path far above `/app/*`'s splat, and absolute paths
are legal under the pathless gates.

```tsx
// inside OnboardingGate's children, beside { path: "/app", … } and { path: "/onboarding", … }
{ path: "/app/sat/practice/:questionId?", lazy: satPractice, HydrateFallback: SatPracticeSkeleton },
// inside WorkspaceShell's children
{ path: "sat", lazy: satDashboard, HydrateFallback: SatDashboardSkeleton },
```

A hard load of `/app/sat/practice?…` is a designed-for path (reload rebuilds the session),
so each lazy route has a `HydrateFallback` — without one the router renders nothing and
warns. (One optional-segment route, so the lazy module and the fallback are declared once.)
`HydrateFallback` covers the **initial load only**; a client-side navigation into the lazy
route shows nothing while the chunk downloads, so **Start session** takes `Button`'s
`loading` state while `navigation.state === "loading" &&
navigation.location?.pathname.startsWith("/app/sat/practice")` — `useNavigation()` is the
router's single in-flight navigation, so unscoped it would spin on a click to Tasks too. Outside `WorkspaceShell` there is no `WorkspaceOutlet`, so there is simply no route
transition. Deep-link precedence is upstream's: path id, then `?id=`, then `?q=`, trimmed.

Nav: one `shellRoutes` entry "SAT practice" in `app/shell/navigation.tsx`, in the student's
own-work group after Activities; icon in `features/shell/sidebar-icons.tsx`.

### 5.2 Feature folder — flat, like every other feature; every file < 400 lines

```
features/sat/
  SatDashboard.tsx          composition; owns filter state
  SatFilterRail.tsx         status · exclude-Bluebook · difficulty bands · Start   (one rail, not three pass-throughs)
  SatTopicTree.tsx          the module card, rendered twice (upstream duplicates 120 lines)
  SatActivityRail.tsx       calendar · streak · today
  SatPractice.tsx           composition; load / empty / error states
  SatPracticeBars.tsx       top bar + bottom bar
  SatQuestionPane.tsx       strap · stem · choices or SPR · reveal panels
  SatPassagePane.tsx
  SatAnswerChoice.tsx
  SatRevealPanel.tsx        the keyed <details> used for Explanation and Previous attempts
  SatNavigator.tsx
  SatQuestionInfo.tsx
  SatToolWindow.tsx         window chrome: header, drag, resize, dock; never unmounts its children
  SatCalculator.tsx         the one Desmos iframe + dock-rect measuring
  SatReferenceSheet.tsx
  SatAnalytics.tsx          dialog shell, tabs, footer drawer, reset flow
  SatAnalyticsOverview.tsx · SatAnalyticsRadar.tsx · SatAnalyticsPace.tsx ·
  SatAnalyticsBands.tsx · SatAnalyticsDomains.tsx
  SatContent.tsx            renders sanitised HTML
  SatPracticeSkeleton.tsx · SatDashboardSkeleton.tsx   route fallbacks and loading frames (feature-owned, like the schools skeletons)
  use-sat-session.ts        the session hook: fetch, abort, prefetch, mutations (§5.3)
  sat-session-reducer.ts    its pure state machine — split up front; this is the file that would otherwise pass 400 lines   + .test.ts
  use-question-timer.ts     Q5, Q5a, Q6, Q25a                               + .test.ts
  use-tool-window.ts        drag (pointer capture) + resize + clamp
  sat-highlighter.ts        offset arithmetic (§6.3)                        + .test.ts
  use-sat-highlighter.ts
  sat-html.ts               normalizeSatHtml, mfenced, figure-style scoping, the DOMPurify instance + config
                            + .test.ts (jsdom — the module needs `window`) and .corpus.test.ts (G5): it matches the
                            routine `vitest run` glob, so **its skip-when-`SAT_BANK_PATH`-is-unset guard is what keeps
                            `npm test` green**; `npm run sat:audit-html` = `SAT_BANK_PATH=… vitest run src/features/sat/sat-html.corpus.test.ts`
  sat-filters.ts            FilterState ⇄ URLSearchParams ⇄ localStorage    + .test.ts
  sat-analytics.ts          mastery thresholds (S16), chart constants (S13–S15), chart summaries
  sat-format.ts             formatTimer, formatPrepTime, attempt dates
  sat-copy.ts               every user-facing string, incl. greetings
api/sat/    client.ts · keys.ts (satKeys) · hooks.ts · types.ts · errors.ts (toastSatError)
styles/sat.css   --sat-* family tokens (tier 3), resolving only through semantic.css
```

`api/sat/` is a sibling of `api/workspace/`: not workspace objects, and
`handleMutationError` toasts workspace copy. `api/sat/types.ts` is a **hand-maintained
mirror** of `app/sat/models.py` — the repo has no codegen — and the P7 browser pass is what
catches drift; both files say so in their headers.

### 5.3 State — kept apart by lifetime

| Kind | Where | Row |
|---|---|---|
| Filter selection | `useState` in `SatDashboard`, mirrored to `localStorage["counselle:sat:filters"]`; on load the saved skills are validated against the taxonomy (F20) | F10 |
| The launched filter | **URL query** of `/app/sat/practice`: `?skills=CID,INF&bands=6,7&status=incorrect`. `skills`, `bands` and `status` are omitted when they mean "all". **`bluebook=1` means *include* Bluebook practice questions (the codec inverts it into the API's `exclude_bluebook`, which means the opposite — never wire one straight through to the other); the parameter is absent in every other case, and absence means upstream's default — exclude (F6).** So a bare URL is every skill, every band, any status, minus Bluebook (F20). Values go through `URLSearchParams` (`H.A.` is safe); worst case ~200 characters. Replaces upstream's `sessionStorage["filters"]` | F9 |
| **The session** | **`useSatSession` — not TanStack Query.** On mount it fetches `GET /session` once and holds the rows. The fetch passes `AbortSignal.any([controller.signal, AbortSignal.timeout(SAT_SESSION_TIMEOUT_MS)])` — `safeFetch` drops its own timeout when given a signal — and a rejection is **ignored when `controller.signal.aborted`**: `safeFetch` rewraps an abort as a generic network error, and under `<StrictMode>` the first dev mount always aborts. `status` is `loading | ready | error`; aborted is not `error`. It is not shared server state and wants no revalidation; a query with every feature switched off is a pass-through | D6, Q1, Q3 |
| Server state (TanStack) | `taxonomy` (staleTime ∞) · `counts(filter)` (`placeholderData: keepPreviousData`) · `question(id, contentSha)` (staleTime ∞) · `attempts(id)` · `stats(today)`. The app's global defaults are only `retry: false`, so these keys otherwise refetch on focus / mount / reconnect — right for `counts`, `attempts`, `stats`; and `question` gets `retry: 2`, since a prefetch miss should not strand a student | |
| **Practice drill** (A6) | navigates to `/app/sat/practice?skills=<code>` plus the dashboard's *current* bands / status / Bluebook, encoded by the same `sat-filters.ts` codec, and closes the dialog. It **never writes** the filter-selection state or its localStorage mirror — the student's saved 29-skill selection survives a drill | A6 |
| Analytics dialog | `?analytics=overview` on `/app/sat`; tab-local state resets on every open (A19) | A1 |

**`useSatSession` — a deep module.** Interface:
`{status, rows, index, current, answer(a), toggleEliminate(l), submit(), goTo(i),
toggleBookmark()}` plus per-question selectors. Inside, all keyed by `question_id`:
- `answers`, `eliminations` — memory only (Q3).
- `reveals: Map<id, {isCorrect, correctAnswers, rationale}>` — **the submit response, kept
  for the life of the session.** Upstream re-derives option marking, the "Accepted:" list
  and the explanation locally on every revisit; under D2 the client never holds the key
  otherwise, so without this map a revisited question would lose all three.
- `history: Map<id, {everCorrect, everIncorrect}>` — seeded from the session rows (a
  **snapshot at session start**, as upstream's `historyAttempts` is) and updated from each
  submit. The navigator reads it, so ✓ / ✕ / Upsolved flip the moment a verdict returns
  (Q31).
- `inFlight: Set<id>` — the submit guard is **per question**, so a slow submit on Q12 never
  blocks answering Q13. Every response is applied **by its `question_id`**, so one landing
  after the student moved on is still correct; only the live-region announcement is skipped
  when the id is not the current one.
- Prefetch of the next two bodies on every index change.
- Bookmarks: on the practice screen the **session row** is the render source
  (`toggleBookmark` patches it optimistically); the mutation invalidates `counts` for the
  dashboard. One source of truth per surface.

Mutations: `submit` is not optimistic (D2); on success it fills `reveals`, `history`,
`attempts(id)`, and invalidates `stats` and `counts`. Bookmark `PUT` / `DELETE` is
optimistic: snapshot in `onMutate`, **restore the snapshot in `onError`**, then
`toastSatError`. Import and reset invalidate `satKeys.all` — the session is not in the
cache, so nothing can refetch it mid-run.

### 5.4 Loading a session without downloading the bank

`GET /session` returns the ordered light list — enough for "Question 1 of 1,204" and the
whole navigator. Bodies load on demand, next two prefetched. Order is `question_id` in
code-unit order, which *is* upstream's (`db.questions.toArray()` returns primary-key order).

Failure modes, decided: `/session` fails → `ErrorCard` in the frame with **Try again**;
prefetch miss or slow network → skeleton in the question pane only — bars, timer and
navigator live, the timer running (upstream's clock also starts at the index change); body
error after retries → `ErrorCard` in the pane, navigation still works; question retired by a
bank refresh mid-session → still served (§3.4); bank refreshed between sessions → the body
key includes the row's `content_sha`, so only changed items refetch. Two tabs or two devices
behave as two liprep tabs do: each holds the list it loaded.

### 5.5 "Check answer" and the Enter key

The button takes `Button`'s `loading` prop as it exists (DESIGN §11.6): `aria-disabled`, not
`disabled`, so focus stays put; transparent label under a `Spinner`; width preserved. There
is no `<form>`. One `submit()` on the session captures elapsed seconds **at press time**
from `useQuestionTimer().readElapsed()` (a ref, not state — no stale closure), mints the
`client_attempt_id`, and returns early if that question is in flight.

The window-level Enter handler is upstream's, with its defect fixed (Q10a). It returns early
when `event.defaultPrevented`, when the active element is a `textarea` or `contenteditable`,
or — a positive test instead of enumerating overlays — **unless `document.activeElement` is
`null`, `document.body`, `document.documentElement`, or inside the practice screen's own root
ref**. Every `Dialog`, `Popover` and
`Sheet` here portals to `document.body` (the repo mixes Radix and Base UI, so there is no
single attribute to look for), which puts focus inside them outside the root. The tool windows
are **non-modal** and render *inside* the root: while one floats or is docked beside the
question, Enter keeps checking and advancing, as upstream (a student types an answer with the
reference sheet open and presses Enter). The exception is **≤ 860 px, where a tool is
fullscreen and covers the question**: it then behaves as a modal surface and suppresses Enter
— advancing a question the student cannot see is the defect Q10a names. (Focus inside the
calculator's cross-origin iframe never delivers keydown to this handler at all.) Mechanically the
fullscreen case is one more early return, not a containment question — a fullscreen tool still
renders inside the root — so the handler also returns early while the practice screen's own
`toolFullscreen` state (§6.4) is set. Otherwise: unsubmitted with an answer →
`preventDefault()` + `submit()`; submitted and not last → `preventDefault()` + next; last
question → nothing (Finish is a link, with no ↵ hint). `preventDefault()` on both branches
matters: it is what stops a focused answer button from also being "clicked" by the same
keypress. Enter inside the SPR `<input>` submits, as upstream. On failure: `toastSatError`,
the question stays answerable. Pressing again **with the same answer** reuses the
`client_attempt_id` (a retry); changing the answer first mints a new one (a new attempt).

### 5.6 The two links in the Info dialog (Q38)

"Search for a tutorial" keeps upstream's Google video search of the quoted id. "Report an
issue" cannot use Counselle's feedback route — `FeedbackBody` is a thumbs rating bound to a
chat `message_id` — so it is a `mailto:` to `support_email` (new Settings value, served by
`/v1/config` and added to the frontend's typed config client) with the question id in the
subject. No new reporting backend. (Upstream's own link is malformed — two `?` — and never
prefills the id.)

### 5.7 Export and import transport

Export is a plain `<a download href={satProgressExportUrl(today)}>` — the repo's existing
pattern for server files (`api/workspace/documents.ts`). Import is
`requestVoid("/sat/progress?today=…", {method: "PUT", body: file, headers: {"Content-Type":
"application/json"}}, SAT_IMPORT_TIMEOUT_MS)` — `requestVoid`, not `safeFetch`, which returns the
`Response` without throwing on a failure status: the file *is* JSON, so no multipart and no
client-side parse. `SAT_IMPORT_TIMEOUT_MS = 60_000` sits beside
`CDS_ADMIN_SLOW_REQUEST_TIMEOUT_MS` in `src/config.ts`; the 15 s default would cut a large
import off. `toastSatError` switches on `TransportError.status === 413` (the client has no 413 kind; it
arrives as a generic server error carrying the status) and on `kind === "invalid_edit"` for 422. Success uses
`toast.success` from `sonner` directly.

---

## 6. Content and tools

### 6.1 Rendering (`sat-html.ts`, `SatContent.tsx`)

`normalizeSatHtml(html)` — the upstream transforms, same order, same regexes (Q39–Q42) →
`satPurify.sanitize(html, SANITIZE_CONFIG)`, **whose hooks also scope figure styles (§6.2)** →
`dangerouslySetInnerHTML` on a `div.sat-content`. The memoised value is that final string.

One new dependency: `dompurify`. **`html-react-parser` is not adopted**: upstream uses it
only to add a class to `<table>` — one CSS selector (`.sat-content table`) — and the
browser's own HTML parser gets MathML and SVG namespaces right where React's element path
needs care.

**Memoisation is load-bearing, not an optimisation.** React leaves `dangerouslySetInnerHTML`
DOM alone only while the `__html` *string value* is unchanged, and the `mfenced` rewrite
(617 occurrences in 171 sampled items) runs a `DOMParser`. So `sat-html.ts` keeps a module
`Map` keyed by `(contentSha, field)` → sanitised string, filled once per field per session;
`SatContent` reads from it. Stable strings mean React never re-creates those text nodes on
re-render, which the highlighter also relies on (§6.3). (`components/ui/chart.tsx` already
uses `dangerouslySetInnerHTML` for generated CSS; this is its first use on content, fenced
inside `SatContent`.)

`.sat-content` is styled in `sat.css` (Q43a): tables, blanks, figures, inline images,
math-image height cap, `math { white-space: nowrap }` inside tables and options, and
`overflow-x: auto` so a wide expression scrolls instead of overflowing. Native MathML (Q44).

### 6.2 Sanitiser configuration

- **A dedicated instance.** `const satPurify = createDOMPurify(window)`, hooks registered
  once on *it* at module scope. `DOMPurify.addHook` mutates whatever instance it is called
  on and hooks accumulate, so hooks on the shared default import would leak into any future
  caller. `SatContent` and the G5 spec import this one instance.
- **Config = upstream's, ported:** `USE_PROFILES {html, svg, svgFilters, mathMl}` +
  `ADD_TAGS` + `ADD_ATTR`. Facts the config depends on, pinned as unit assertions rather
  than assumed: `USE_PROFILES` resets the allowed-tag set, `ADD_*` merge after it, and
  `FORBID_TAGS` wins over both; `semantics` and `annotation` survive only because
  `ADD_TAGS` lists them (they are not in the MathML profile), and they render correctly
  because MathML Core draws `<semantics>`'s first child; **`alttext`** — College Board's
  spoken form of every expression, 3,290 occurrences in the sample — survives only because
  `ADD_ATTR` lists it.
- **Hardening that G5 proves changes nothing visible:**
  `FORBID_TAGS: ["script", "foreignObject"]`. **`<style>` stays allowed**: the official bank
  uses it inside SVG figures (§3.1) and forbidding it would strip figure typography; that
  `style` survives the profile set is one more pinned assertion. It is made safe by a
  **selector-prefix rewrite**, not `@scope`: across the 204 samples the 14 blocks reduce to two
  bodies — `*{stroke-linecap:butt;stroke-linejoin:round;}` and a three-rule `.small` /
  `.heavy` / `.Rrrrr` font block with a multi-line comment between its rules — and both leak
  page-wide as written. **CSS comments are stripped before the rewrite** (otherwise that
  comment glues itself to the third selector and the whole block would be discarded). In an **`afterSanitizeElements` hook** on the instance — one pass, no extra parse or
  serialise — when the node is a `<style>`, `node.closest("svg")` decides remove-or-rewrite;
  the containing `<svg>` gets `data-sat-fig="<n>"` (a module counter, so ids are unique on the page and the
  memoised string is stable), and every selector in that block is prefixed with
  `[data-sat-fig="<n>"] ` (`[data-sat-fig="3"] *`, `[data-sat-fig="3"] .small`). ~15 lines, no
  browser-support question (tests assert the rewritten *shape*, never a specific `n`, which
  depends on how many fields the module has sanitised), no silent degradation, assertable under jsdom. A `<style>` that is
  not inside an `<svg>`, or whose text contains `@import`, `url(` or a selector the rewrite
  cannot parse as a plain comma list (which includes any nested at-rule such as `@media`; the
  corpus has none), is removed — and because DOMPurify's `removed` list does not record nodes a *hook* removes,
  **the rewrite keeps its own report of every block it dropped or could not parse**, which G5
  reads.
  A `uponSanitizeAttribute` hook
  drops `style` *declarations* containing `url(`, `expression` or `position` (the corpus's
  `url(#…)` references — `clip-path` ×906, `marker-end` ×22, `marker-start` ×20 — are attributes, untouched), restricts `href` / `xlink:href` to
  `#fragment`, and allows `data:` only on `<img>`.
- Because G5 runs this exact module over the whole corpus, there is no second copy of the
  allow-list to drift.

### 6.3 Highlighter — CSS Custom Highlight API over stored offsets

Upstream wraps text nodes in `<mark>` by hand; its un-highlight path throws (Q34), and what
is highlightable falls out of an ancestor test with surprising edges (Q33). Same tool, one
stated rule:

- **Highlightable text is the passage and the stem.** Never options, rationale, history or
  chrome. R&W questions only (Q33a).
- **Storage is data, not DOM:** per question, per field (`stimulus` | `stem`), a sorted list
  of `[start, end)` character offsets into the field's `textContent`. Offsets are well
  defined over the sanitised DOM (`<br>` and `<img>` contribute nothing, `<math>` its token
  text). They are **never persisted** and are dropped on question change (Q34).
- **`sat-highlighter.ts` is pure arithmetic** — add-and-merge, subtract, covered length —
  unit-tested without a DOM.
- **Painting:** offsets → `Range`s by walking the field's text nodes, registered as
  `CSS.highlights.set("sat", …)`; `::highlight(sat)` paints them (background colour only,
  which is all the API styles). No DOM mutation. Rebuilt from offsets on every mount, so the
  §5.4 skeleton swap and the ≤ 860px passage copy lose nothing.
- **Gesture:** on `pointerup` from a **mouse or pen** (upstream listens to `mouseup`, so
  touch never highlighted; a touch handler would also fight the native selection handles),
  with the mode on: clip every range of the selection to each highlightable field it
  touches; compute coverage over the **union** of those clipped ranges (so a multi-range
  Firefox selection cannot add and subtract in one gesture); > 50 % already highlighted →
  subtract, else add; clear the selection. A drag from passage into stem therefore
  highlights both parts on every width — upstream does that only on mobile, by accident.
- **Support:** Chrome 105+, Safari 17.2+, Firefox 140+. Where `CSS.highlights` is missing
  the button is disabled with a tooltip saying why. Trade-off (R6): painted highlights are
  not `<mark>` elements — they do not print and are not exposed to assistive technology.

### 6.4 Desmos (O3) and the tool windows

liprep ships Desmos's proprietary 3.1 MB `calculator.js` and Desmos's public demo API key;
neither is licensed for a production product. Its own last fallback is the right primary:
an `<iframe>` of the calculator College Board embeds in Bluebook.
`https://www.desmos.com/testing/cb-digital-sat/graphing` 302-redirects to
`/testing/collegeboard/graphing`; the final response has no `X-Frame-Options` and no
`frame-ancestors` (verified 2026-09-19). The post-redirect URL is the Settings value
`sat_desmos_embed_url`, served through `/v1/config`. Consequence for the owner (O3): the
calculator's configuration is College Board's — degree mode and the test feature set, which
is what Q36 configures by hand — and is not ours to change.

**One window shell, two tools.** `SatToolWindow` is controlled chrome — header, drag,
resize, dock / float, close — that **never unmounts its children**. `SatCalculator` mounts
it once for the life of the practice page; `SatReferenceSheet` is conditionally rendered,
so, as upstream, it reopens at its start position (Q37).

- **Never reparented.** Moving an iframe in the DOM reloads it. The calculator is one
  `position: fixed` element whose geometry comes from CSS custom properties.
- *Floating*: `transform: translate3d(x, y, 0)`; 580 × 480; bounds per Q35a. Drag uses
  **`setPointerCapture` on the header** at `pointerdown` (released on `pointerup` /
  `pointercancel`): capture retargets the move events to the header, so the drag survives
  crossing the cross-origin iframe — upstream's window-level `mousemove` loses them there.
  The clamp uses the window's real size and is re-applied on viewport resize (Q35).
- *Resize*: a 16 px pointer-driven corner handle in the shell's own gutter, same bounds —
  **not** native `resize: both`, whose gripper would sit under the iframe and whose inline
  `width` / `height` would override the docked geometry.
- *Docked*: the left column renders an empty slot below a single header; a `ResizeObserver`
  plus scroll / resize listeners in `SatCalculator` write `--sat-calc-top / left / w / h`
  onto the frame; docking sets those and ignores the floating size, floating restores it.
  Upstream hard-codes `top: 56px; width: 50%` against its own grid.
- *Hidden*: `visibility: hidden` — which is what makes it unfocusable and inert; the
  `inert` attribute does not reach into a nested browsing context — still mounted, so
  reopening shows the same graph. **Hidden whenever the current question is not Math**
  (Q35b), returning as it was on the next Math question.
- *≤ 860 px*: fullscreen with "Back to question"; the practice screen holds this as its
  `toolFullscreen` state, which the Enter handler reads (§5.5).
- **Stacking (DESIGN §4.1 — no invented z-index):** docked = base flow; floating tool
  window = `--z-sticky`; navigator popover = `--z-dropdown`; Info, analytics and reset
  dialogs and the mobile fullscreen tools = `--z-modal`. A dialog is always above a tool.

If a CSP is introduced at deploy, this feature needs `frame-src https://www.desmos.com` and
`img-src data:` — recorded in `docs/DEPLOY.md`.

### 6.5 Reference sheet

liprep's 11 SVGs + 1 PNG (MIT) → `frontend/public/sat/reference/`, through SVGO. Row 1: the four 2-D
formula figures **and the special-right-triangles figure in a double-width cell**, as
upstream; row 2: the other seven; then the three fact lines verbatim (Q37); real alt text for sheets
10–11; images not draggable and `select-none` (Q33b). 880 × 600, resizable within Q35a's bounds; `Esc` closes.

---

## 7. UI/UX

The full specification is `ui-spec.md`. What an engineer needs to know from here:

- **Method.** /impeccable `shape` in the product register, /better-ui for detail. **Where
  better-ui and DESIGN.md disagree, DESIGN.md wins**; `ui-spec.md` §9 lists each case.
- **Layout is computed against the content column, not the viewport** — the dashboard sits
  inside the shell beside a 312 px sidebar — using container queries.
- **Colour.** Status hues only where a state is claimed (correct / incorrect / mastered).
  **Difficulty has one neutral encoding everywhere**; sections are told apart by label,
  position and shape, never hue. One documented exception: the highlighter's yellow.
- **Eight enabling changes** precede the feature, one commit each — neutral for existing
  callers, except the `Checkbox` fix, which repairs a live bug (§8): `TokenBucket` move · `ChartFigure` move · `SegmentedControl`
  `columns` · `Checkbox` indeterminate glyph · `Meter` neutral variant · `ToggleBand` ·
  `Sheet` full variant · `content_disposition` made public.
- **DESIGN.md amendments shipped with the feature (P8):** §2.2 (the highlight exception,
  beside Law 2; `--chrome` on the practice bars as chrome-by-function) · §8 (the new literal
  content widths: 860 reading column, 480 Info dialog, 400 navigator) · §17.4 (erasing or
  replacing a student's whole history is confirmed in an `alertdialog`, not
  optimistic-with-undo) · §9.4 (routes) · §15.5 (SAT analytics as a second sanctioned Recharts
  surface, under the same text-equivalent and no-series-hue rules) · §17.5 (a continuous
  window drag is pointer-driven; HTML5 DnD cannot express it) · the `--sat-*` family and
  `--image-outline`.

---

## 8. Phases, order, gates

**Enabling changes — one commit each, before the feature. All are behaviour-neutral for
existing callers except E-4, which fixes a live bug and is called out as such:**

| # | Refactor | Touches |
|---|---|---|
| E-1 | `TokenBucket` → `adapters/_ratelimit.py` | + `_MAX_TOKEN_INTERVAL_S`; `adapters/collegedata/fetch.py`; `tests/adapters/test_collegedata_fetch.py` |
| E-2 | `ChartFigure` (that component only) → `components/workspace/chart-figure.tsx` | its four importers (`FactRangeChart`, `FactDistributionChart`, `GpaComparison`, `AcademicComparisonPlot`); comment-path updates where the old location is only *named*: `chances/summary-parity.test.tsx`, `chances/SchoolChancesPanel.test.tsx`, `styles/schools.css`; `ChartFoot`, `AxisCategoryTick`, `chart-tokens.ts` stay with the school tab |
| E-3 | `SegmentedControl` `columns` prop. `w-fit` stays the default for its five existing call sites; the grid and full width apply **only** when `columns` is passed, so the registry recipe is unchanged for them (and the header comment's "four call sites" becomes five) | `components/ui/segmented-control.tsx`, `lib/segmented-control.ts` |
| E-4 | **`Checkbox` on-state and indeterminate glyph — a visible bug fix, not a neutral refactor.** The primitive is Radix, which emits `data-state`, but its classes are Base UI's `data-checked:*`, so no checkbox in the app has ever drawn its filled checked state; an indeterminate box also draws a check. Switch to `data-[state=checked]:` / `data-[state=indeterminate]:` and add the dash glyph | `components/ui/checkbox.tsx`; its six callers are browser-checked in P7: `ClarifyQuestion`, `ExploreFilterBar`, `ExploreFilterPanel`, cds-admin `ReviewPanel` and `ApproveAnywayDialog`, `TaskRow` |
| E-5 | `Meter` `variant="neutral"` (today hard-coded `bg-primary`). Additive only — its off-scale `transition-all duration-500` is existing debt (DESIGN §20) and is **not** touched here, since changing it would alter every existing meter | `components/ui/meter.tsx` |
| E-6 | `ToggleBand`: a multi-select toggle row — a thin wrapper over the installed `@base-ui/react/toggle-group` (`multiple`, `value: readonly string[]`; its items emit `aria-pressed` and `data-pressed`, which is exactly what `lib/segmented-control.ts`'s unused `pressed` recipe keys on — a hand-written `aria-pressed` button would never match it) on `SegmentedControl`'s trough | new `components/ui/toggle-band.tsx` |
| E-7 | `Sheet` `variant="full"` — edge-to-edge, full height: one named variant instead of four override classes at the call site (the popup's width cap and `max-w-md`) | `components/ui/sheet.tsx` |
| E-8 | `_content_disposition` → `api/deps.py::content_disposition` (public, beside `etag_response`); no behaviour change | `api/deps.py`, `api/routes/documents.py` (its one call site) |

Order: P0 → E-1…8 → P1 → P2 → P3 → {P4 ∥ P5} → P6 → P7 → P8. One commit per phase,
conventional commits, staged file by file.

| Phase | Work | Gate |
|---|---|---|
| **P0** | branch; ADR 0043 drafted; O1–O9 put to the owner. **Nothing waits on O5 except publishing the bank** | — |
| **P1 Domain + harness** | `domain/sat/*`, taxonomy yaml, the upstream harness (§8.2) | every vector suite green; `ruff`, `mypy` clean |
| **P2 Bank** | `adapters/collegeboard`, CLI `fetch / build / audit`, SPR review; bank built **locally** (gitignored); raw archive copied off the workstation | G1–G10 pass, G5 included; bank < 25 MB; archive sha in the manifest and a second copy confirmed |
| **P3 Schema + API** | migration 0021 (applied *and* rolled back locally), `bank-sync` in `entrypoint.sh` and `dev.py run_stack`, `app/sat`, `api/routes/sat.py`, rate buckets, Settings, `.env.example` | route tests: auth scoping (A never sees B); the four statuses vs liprep semantics; empty lists = all; grading incl. O7; retry-safe submit; import replace + clamps; date window; read limit; a missing limiter still admits. security-reviewer + database-reviewer pass |
| **P4 Content + practice** | `dompurify`, content, practice screen, tools | vitest: html transforms vs upstream snapshots, sanitiser assertions (§6.2), highlighter arithmetic, session module (reveals, history, per-question in-flight, late response), timer (Q5a, Q25a), filter codec; `npm run build` green |
| **P5 Dashboard** | dashboard, filters ⇄ URL ⇄ storage, nav entry | counts on screen == SQL for every status × band fixture |
| **P6 Analytics** | dialog, five tabs, charts, export / import / reset | numbers on screen == `/stats` == upstream vectors for the seeded fixture user |
| **P7 Browser parity pass** | §8.4 | every inventory row ticked with evidence |
| **P8 Docs + ship** | `docs/ARCHITECTURE.md` § SAT practice; `DATABASE_GUIDE.md` (`counselle.sat_*`); the DESIGN.md amendments of §7; `docs/DEPLOY.md` (bank file, CSP entries); CLAUDE.md status entry; `THIRD_PARTY_NOTICES.md`; ADR 0043; PR. **Committing `bank.jsonl.gz` is its own commit, made only after O5** | workflow Phase 9 checklist |

### 8.1 Testing stance

The project rule governs ("a test has to earn its place; data-integrity code is tested
hard"), not the global 80 % rule. Earning it here: grading, normalisation, SPR extraction,
stats, the progress-file codec, the counts / session SQL, auth scoping, the HTML transforms
and sanitiser assertions, the highlighter arithmetic, the session module, the timer, the
filter codec. Not earning it: presentational components (the browser pass and `jest-axe`).

### 8.2 The differential harness — how "exactly the same" is checked

Committed under `tests/domain/sat/upstream/`: `README.md` (regeneration steps),
`upstream.patch`, `harness/` (a small vitest project with its own `package.json`),
`DIFFERENCES.md`, and the generated `vectors/*.json`, each stamped with the upstream commit
and the patch's sha256. liprep ships no tests and no vitest; the harness installs liprep's
runtime dependencies plus `vitest`, `jsdom` and `fake-indexeddb`, and configures the `@`
alias and `environment: "jsdom"`.

**What the patch is, honestly.** Two hunks, ~35 lines, reviewable at a glance:
1. `export` added to `parseNumericValue`, `checkIsCorrect` (`Practice.tsx:34, 48`) and
   `parseWrittenFraction` (`db.ts:108`) — keywords only.
2. In `RichContent.tsx`, the **five** `preprocessed = preprocessed.replace(…)` statements
   **and the `transformMfenced(preprocessed)` call** (`:140–163`, inside the component's
   `useMemo`) are lifted, unchanged and in order, into an exported `preprocessSatHtml(html)`
   that the `useMemo` then calls; `transformMfenced` (`:70`, module scope) gets an `export`.
   There is no binding to export otherwise. This *is* a small refactor of upstream, and the
   patch's review is what vouches that the statements did not change.

Import side effects: `db.ts` constructs two Dexie databases and parses `bluebook_ids.json`
at module scope — hence `fake-indexeddb/auto`.

| Suite | Inputs | Size |
|---|---|---|
| grading | every SPR question × {each key, leading-zero variants, fraction ↔ decimal, near-misses at 1e-5 and 1e-7, junk}; every mcq × A–D. O7's path has hand-derived vectors — upstream cannot produce them | ~20k |
| normalisation (G9) | every raw stub + detail pair, wrapped; the four compared rules only | 3,770 |
| spr extraction | every SPR rationale | ~560 |
| stats | 300 generated logs (seeded PRNG: 0–2,000 attempts; re-attempts; `solvedAt` ties; streak gaps; all 29 skills **plus unknown and empty domain / skill codes and out-of-range bands** (S17–S19); skills first seen on a non-first attempt (S18); < 8 skills with data (S9); frozen clock away from DST dates; half-way rounding cases) | 300 |
| progress file | export → import round trips, incl. A13a's defaults and junk rows | 20 |
| html transforms | every distinct HTML field in the bank, **pre-sanitise string output** | ~20k |

Python and vitest assert deep equality. **A stated limit:** the `mfenced` transform
serialises through `DOMParser` / `innerHTML`, so its byte-for-byte comparison is between our
port and upstream *both under jsdom*; that proves the two implementations agree, not that
jsdom's serialiser equals a browser's. The three-engine browser pass (§8.4) covers rendering.

### 8.3 Performance budget

`/session` for the whole bank < 150 KB gzipped, < 200 ms; `/counts` < 50 ms at 20k attempts;
`/questions/{id}` < 30 KB typical, legacy items ~20 KB with a 150 KB tail (each over 500 KB
is listed in `AUDIT.md`); `/stats` < 100 ms at 20k attempts. G5's corpus run (~20k fields, a `DOMParser` pass for each
`mfenced`-bearing one, under jsdom): expected 2–5 min; the measured figure goes in `AUDIT.md`. Bundle: Recharts is already in
the `app` entry chunk (the school page imports it statically), so the SAT chunks add
DOMPurify and the feature's own code — budget < 100 KB gz. **Gate:** `npm run build`'s chunk
table is recorded before and after in `artifacts/sat-practice/`, and the `app` entry chunk's
gz size must not grow (`landing.html` is a separate entry and cannot see this feature).
There is no CI; the phase checklist is what enforces it.

### 8.4 Browser parity pass

Real browser against the live backend on a throwaway account (`/browse`), both apps side by
side: liprep at `liprep.pages.dev` loaded with a JSON export of **our** bank
(`python -m app.sat export-liprep-json` — which also proves the bank is liprep-importable).
For each inventory row: perform the action in both; record match, *or the deliberate
difference the row names*, with a screenshot under `artifacts/sat-practice/parity/`. Widths
375 / 768 / 1024 / 1440, **with the sidebar expanded and collapsed**. Chrome, Firefox and
Safari for MathML, figure styling, the highlighter and the Desmos frame. Then
/impeccable `critique` and `audit`, and a /better-ui pass at 10 % animation speed; HIGH
findings block.

---

## 9. Risks

| # | Risk | Severity | Handling |
|---|---|---|---|
| **R0** | **Licence.** The source is College Board's *Educator* Question Bank. Its educator terms grant it "for the purpose of classroom teaching and internal reporting only" and state there is "no right to upload or post online, cache, reproduce, modify, display…" without written permission; its copyright guidance excludes "test prep and other commercial settings". Counselle would store the full bank and serve it to students | **Owner decision O5. Engineering cannot mitigate it.** | Options: (a) accept the exposure, as ADR 0038 did for CollegeData; (b) seek permission; (c) build and test privately, publish nothing until resolved. The design supports all three: the bank is one file outside git by default, `bank-sync` no-ops without it, and the read limit bounds bulk extraction. **Development never waits on O5; committing the bank and production do** |
| R1 | College Board changes or closes the endpoints | Med | the raw archive + bank are self-contained; the product never calls College Board at runtime |
| R2 | A content pattern outside the 204 samples (remote image, new tag, 5-option item) | Med | G4 / G5 fail the build naming the ids |
| R3 | SPR review volume larger than expected | Low–Med | the legacy estimate is 20–150; 200-item stop-and-re-plan threshold (§3.5) |
| R4 | Desmos later forbids framing | Low | one Settings URL; a partner API key is a one-file swap |
| R5 | The stats port diverges in an untested corner | Med | 300 generated logs incl. orphan codes, ties and half-way rounding; harness rerunnable |
| R6 | `CSS.highlights` missing; highlights not printable / not exposed to AT | Med | tool disabled with an explanation on old browsers; trade-off in §6.3 and the differences table |
| R7 | Bank file larger than estimated | Low | 25 MB stop; the out-of-repo path already exists |
| R8 | MathML differences across engines | Low | three-engine browser pass; MathML Core only; `mfenced` rewritten |
| R9 | Three migration heads | Low | `0021` depends on all three; applied and rolled back locally |
| R10 | O7 accepts something College Board would reject | Low | (d) requires an unambiguous exact value and a full field; vectors include College Board's own rejected forms; "full field" is labelled as our reading of their table |
| R11 | A reviewer confirms a wrong legacy SPR key | Low | each item is shown beside its sentence or `alt`; an entry is either the extractor's proposal confirmed by the reviewer, or a reviewer-authored `manual` key carrying its quoted source; corrections are one yaml line |

---

## 10. File manifest

**Create — backend:** `domain/sat/{__init__,types,taxonomy,normalize,grading,spr_answers,stats,progress_file}.py` · `adapters/collegeboard/{__init__,client}.py` · `adapters/_ratelimit.py` (E-1) · `app/sat/{__init__,__main__,bank,errors,models,service_questions,service_attempts,service_progress}.py` · `api/routes/sat.py` · `migrations/0021_sat_practice.sql` + `.rollback.sql` · `config/assets/sat/{taxonomy.yaml,spr_keys.yaml}` · `deploy/seed/sat/{MANIFEST.json,AUDIT.md}` (+ `bank.jsonl.gz` after O5) · `tests/domain/sat/*`, `tests/domain/sat/upstream/*`, `tests/app/sat/*`, `tests/api/test_sat_routes.py`
**Create — frontend:** everything in §5.2, tests included · `src/pages/{sat-dashboard-page,sat-practice-page}.tsx` · `src/styles/sat.css` · `src/components/workspace/chart-figure.tsx` (E-2) · `src/components/ui/toggle-band.tsx` (E-6) · `public/sat/reference/*`
**Create — docs:** `docs/adr/0043-sat-practice.md` · `THIRD_PARTY_NOTICES.md`
**Modify:** `api/main.py` (mount) · `api/deps.py` + `api/routes/documents.py` (E-8) · `api/ratelimit.py` (two checks, on both limiter classes) · `config/settings.py` (`sat_fetch_requests_per_second`, `sat_fetch_user_agent` + the shared contact-URL helper + the placeholder clause, `sat_bank_path`, `sat_attempt_max_seconds`, `sat_import_max_bytes`, `sat_writes_per_minute`, `sat_question_reads_per_minute`, `sat_desmos_embed_url`, `support_email`) · `.env.example` · `api/routes/config.py` + the frontend's typed config client (Desmos URL, support email) · `scripts/entrypoint.sh`, `scripts/dev.py` (`bank-sync`) · `.gitignore` (the bank file, until O5) · `adapters/collegedata/fetch.py` + `tests/adapters/test_collegedata_fetch.py` (E-1) · `frontend/src/app/router.tsx` · `frontend/src/app/shell/navigation.tsx` · `frontend/src/features/shell/sidebar-icons.tsx` · `frontend/src/components/ui/{segmented-control,checkbox,meter,sheet}.tsx` + `lib/segmented-control.ts` (E-3…5, E-7) · `frontend/src/features/schools/facts/charts/chart-shell.tsx` + its four importers + comment-path touches in `chances/summary-parity.test.tsx`, `chances/SchoolChancesPanel.test.tsx` and `frontend/src/styles/schools.css` (E-2) · `frontend/src/styles/semantic.css` (`--image-outline`, `--on-ink`) · `frontend/src/index.css` (import `sat.css`) · `frontend/src/config.ts` (`SAT_IMPORT_TIMEOUT_MS`, `SAT_SESSION_TIMEOUT_MS`) · `frontend/package.json` (+ `dompurify`, `sat:audit-html`) · `docs/ARCHITECTURE.md`, `docs/DATABASE_GUIDE.md`, `docs/DEPLOY.md`, `docs/adr/README.md`, `DESIGN.md`, `CLAUDE.md`, `README.md`
**Delete:** nothing.

---

## 11. Owner decisions

| # | Decision | Default | Blocks |
|---|---|---|---|
| O1 | Drop liprep's Home hero, About, GitHub star, Wall of Love (H-rows) | drop | — |
| O2 | Re-voice in-joke copy (greetings, reset guard) with **identical mechanics** — including the three-press reset | re-voice | — |
| O3 | Desmos: official College Board embed (its configuration is theirs) vs a partner API key | embed | — |
| O4 | Offline / PWA out of scope | out | — |
| **O5** | **College Board content licence (R0)** | **none — needs an answer** | committing the bank; production. Not development |
| O6 | Server-side grading: "Check answer" is one round trip and needs a connection (D2) | accept | — |
| O7 | Accept College Board's published free-response entry rule where liprep wrongly rejects (§4.3) | accept | — |
| O8 | The FIX list — upstream defects not reproduced (inventory, *Deliberate differences*). Veto any line | accept all | — |
| O9 | The dashboard greeting (F1). Counselle's house rule is no prose under a page title; liprep's greeting is part of its character | **keep**, as one line in the header's subtitle slot, recorded as the rule's one exception | — |

Notes for the owner that need no decision: the Bluebook exclusion follows College Board's
own list, which flags one question liprep's static copy does not (§3.1); analytics
stays a modal, as in liprep, although Counselle would normally make it a route.
