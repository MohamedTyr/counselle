# ADR 0043 — SAT practice: a ported liprep, College Board's own question bank, server-side grading

**Status:** Proposed / Draft — owner decisions O1–O9 outstanding (see "Owner decisions" below); most
are non-blocking defaults, but O5 blocks publishing the question bank and going to production.

## Context

Counselle has no SAT/ACT practice surface. liprep (`github.com/liprep/liprep` @ `c84d3dc`, MIT) is a
free, open-source Bluebook-style SAT practice app: a dashboard with per-skill filters and mastery
counts, a full-viewport practice screen with a calculator and reference sheet, and an analytics
suite (radar, pace, bands, domains, streak, heatmap) — all driven by a student-supplied JSON export
of College Board's own Question Bank, stored in IndexedDB, with grading and statistics computed
client-side in the browser.

The product request is "the same product, on Counselle": the same dashboard, the same practice
screen, the same tools, the same analytics, the same numbers — but with the bank fetched once from
College Board's own official source instead of a manual JSON upload, progress saved to the
student's Counselle account instead of IndexedDB, and Counselle's design system instead of
liprep's own CSS. `plans/sat-practice/parity-inventory.md` is the row-by-row behavioural contract
(every liprep row marked KEEP / ADAPT / FIX / DROP); `plans/sat-practice/ui-spec.md` is the UI/UX
specification; `plans/sat-practice/plan.md` is the full technical plan this ADR summarizes the
durable decisions from.

Two constraints shape every decision below. First, liprep's own code is not something this repo
wants to inherit wholesale: 1,100–1,400-line page components, ~6,000 lines of bespoke CSS with
hard-coded hex values (against DESIGN.md Law 1), IndexedDB as the only store, and a service worker
this product does not want. Second, the question bank itself is College Board's Educator Question
Bank content, fetched from unauthenticated JSON endpoints with no stated public-consumption terms —
a genuine licensing question this ADR cannot resolve in code (see "Risk R0" below).

## Decision

**D1 — the bank is fetched once, offline, built into a versioned seed file, and synced into
`counselle.sat_*` at boot. No crawler worker, no runtime call to College Board.** A CLI
(`python -m app.sat fetch | build | audit | bank-sync`) pulls College Board's four Question Bank
JSON endpoints, normalizes them into `deploy/seed/sat/bank.jsonl.gz` plus a `MANIFEST.json` and
`AUDIT.md`, and `bank-sync` upserts that file into the database on every boot
(`scripts/entrypoint.sh`, after migrations). The question bank changes a few times a year; there is
no product reason to hold a live connection to College Board at runtime, and every reason not to —
the product never depends on College Board's endpoints staying up.

**D2 — grading is server-side.** The question payload the client receives from `GET
/questions/{id}` carries no key and no rationale. `POST /questions/{id}/attempts` grades the
answer, records the attempt, and returns the verdict, key, and rationale in one round trip. This is
the one honesty-critical rule in the whole feature — the same class of rule ADR 0006's citation
envelope and the essay-honesty skill protect elsewhere — so it lives once, in `domain/sat/grading.py`,
hard-tested, and the recorded attempt is authoritative rather than a client-side claim the server
merely stores.

**D3 — statistics are a pure Python function over the student's attempt log, not SQL.**
`domain/sat/stats.py::compute_user_stats(attempts, today)` reproduces liprep's `getUserStatistics`
number-for-number, including its quirks (JS `Math.round`'s half-up behavior, `ORDER BY solved_at, id`
as the one definition of "latest", the local-date streak walk) — a pure function is what makes the
result checkable against upstream's own output vectors, which a SQL aggregate would not be.

**D4 — the dashboard lives inside the workspace shell; the practice screen is a full-viewport route
outside it.** Bluebook is a focus environment: liprep gives the practice screen the whole window, no
chrome, no sidebar. The dashboard is an ordinary workspace page under `/app/sat`.

**D5 — HTML is transformed and sanitized at render, in the browser, and a build gate runs that same
renderer over the whole bank and fails if it strips anything unexpected.** There is one sanitizer
(`frontend/src/features/sat/sat-html.ts`, a dedicated DOMPurify instance), not a server-side copy
and a client-side copy that can drift, and its correctness is measured against the real corpus
(`npm run sat:audit-html`, gate G5 in the plan), not asserted from a handful of samples.

**D6 — a launched practice session is fetched once per mount and held in the session's own state,
not in the query cache; everything in it is keyed by `question_id`.** `useSatSession` fetches
`GET /session` once when the practice route mounts and holds the light row list, per-question
answers, eliminations, and submit results for the life of that visit — exactly liprep's IndexedDB
session lifetime: loaded once per visit, re-evaluated on re-entry or reload, never silently
revalidated mid-session by a background refetch.

### Port, not fork

Three build strategies were considered for carrying liprep's behavior into Counselle:

| Option | Verdict |
|---|---|
| Embed liprep as-is (iframe or a second Vite entry, restyled) | Rejected — keeps IndexedDB as the store (no account sync, no server bank), a second router and font stack, and 6,000 lines of CSS with hard-coded hex; restyling it in place is itself a rewrite |
| Copy its files into `features/sat/` and refactor in place | Rejected — both halves of every file are wrong for Counselle (Dexie calls inline in components, class names bound to liprep's own CSS); replacing both leaves only the JSX skeleton and the pure logic, which is the chosen option with a worse history |
| **Port: reproduce behaviour from the parity inventory; carry pure logic over under differential tests** | **Chosen** |

liprep's *behaviour* is reproduced from `parity-inventory.md`; its *code* is not vendored. A small
set of pure functions — grading, HTML normalization, statistics, the SPR rationale-key extractor,
the progress-file codec — are ported function-for-function into `domain/sat/` and
`frontend/src/features/sat/sat-html.ts`, each module header naming the upstream function it ports,
with an MIT notice in `THIRD_PARTY_NOTICES.md`. These ports are checked against the upstream code
itself by a differential test harness (`tests/domain/sat/upstream/`): a small, reviewable two-hunk
patch adds `export` to liprep's private functions, a vitest project runs liprep's actual functions
against thousands of generated and corpus-derived inputs, and Python/vitest assert deep equality
between the port's output and upstream's. Everything else — the 1,100+-line page components, Dexie,
the bespoke CSS, the service worker — is replaced outright by Counselle's stack (React Router,
TanStack Query, the DESIGN.md token system, a Postgres-backed API).

**"Same product" has one rule with teeth: reproduce what a liprep user would call *the product*, not
what they would call *a bug*.** Upstream defects — the calculator stranded on a Reading question,
Enter submitting behind an open dialog, attempted counts mislabeled "solved" — are fixed, not
reproduced, and every fix is listed in the parity inventory's *Deliberate differences* table for the
owner to veto (O8).

### Server-side grading and the O7 acceptance path

Because grading is server-side (D2), `service_attempts.submit` is the single place the "is this
answer correct" rule is evaluated. `domain/sat/grading.is_correct` reproduces liprep's rule in
order: case-insensitive string match against any accepted key; leading-zero equivalence
(`.5` ≡ `0.5`); and, for free-response items, numeric equivalence within `1e-6`.

One acceptance path is added that liprep lacks, adopted as owner decision **O7**. College Board's
own digital-practice-test directions for free-response entry state that an answer may be truncated
or rounded to fit the entry field (5 characters positive, 6 with a negative sign), and their own
worked example accepts both the truncated and the rounded form. liprep accepts only the literal
forms its scraped key happens to list — for a key of `.9411`/`.9412` it marks a mathematically
correct `0.941` wrong. Telling a student a right answer is wrong is the one thing this product may
not do, so a fourth acceptance rule is added: when the key set yields one unambiguous exact value,
an entry that fills the field and equals that value truncated toward zero or rounded half-away-from-zero
is accepted, computed with `fractions.Fraction`/`Decimal`, never floats. This rule only ever adds
acceptances — it never overrides (a)–(c) into a rejection — and is pinned by hand-derived vectors
built from every fraction key in the bank plus College Board's own published accept/reject table.

### Free-response keys for the legacy disclosed corpus

The ~29 legacy disclosed items (§3.1 of the plan) predate College Board's structured question bank
and carry no key field at all for free-response items — the answer exists only as prose inside the
rationale (e.g. "The correct answer is 75."), and for a fractional or radical answer, sometimes only
inside an `<img>`'s spoken-math `alt` text. `domain/sat/spr_answers.py` ports liprep's rationale-key
extractor to propose a key for each; every proposal, and every reviewer-authored key where the
extractor proposed nothing, is recorded in `config/assets/sat/spr_keys.yaml` with its source
(`rationale`, `manual`, or `added` for a G10 cross-check finding) and the quoted sentence or `alt`
text it came from. **As shipped, this adjudication was performed by an AI agent, not a human
reviewer** (`spr_keys.yaml`'s own header: "Keys adjudicated by an AI agent on 2026-09-19; owner
spot-check pending" — plan risk R11) — a divergence from the plan's stated "every one is confirmed
by a person." `build` still fails while any legacy SPR item lacks an entry, so nothing ships
unadjudicated, but the confirming party is not yet a person. Closing R11 with an owner or reviewer
spot-check of the ~70 adjudicated entries is open work, not assumed done.

### The bank: a seed file, not a live dependency

The bank is fetched once by an offline CLI pipeline (`fetch → build → audit → bank-sync`), never at
request time. `fetch` talks to College Board's four unauthenticated Question Bank JSON endpoints
through a rate-limited `httpx` client (one token bucket across both hosts, 4 requests/second),
writing every response verbatim to a gitignored, lossless raw archive. `build` is pure and
deterministic — raw responses to `domain/sat/normalize.py` to `deploy/seed/sat/bank.jsonl.gz`,
sorted, stable key order, fixed gzip metadata — and runs no network or npm call. A battery of audit
gates (coverage, superset, identity, key correctness, HTML-render fidelity against the real
sanitizer, taxonomy parity, Bluebook-flag reconciliation, drift-vs-previous-manifest, normalizer
parity against the upstream harness, free-response key adjudication) must pass before a build is
considered good, and every gate's assertion is written to `AUDIT.md`, not asserted away silently.

`bank-sync` runs on every application boot, under an advisory lock so two instances starting
together serialize rather than deadlock. It is a no-op when the bank file's hash and row count
already match what is recorded in `sat_bank_meta`; otherwise it verifies the file's hash against its
own manifest and upserts it into `counselle.sat_questions` / `sat_question_content` /
`sat_question_aliases`. A missing bank file is a warning, not a boot failure — the app still starts
on whatever bank it already has. The sync never deletes rows: attempts and bookmarks reference
question ids, so a question absent from a refreshed bank is marked `retired_at` and kept, not
dropped.

**A retirement safety guard, added beyond the plan's original design.** `bank_sync.py` refuses (and
aborts the whole sync, changing nothing, the same as any other sync failure) to retire more than
30% of a populated `sat_questions` table (50+ live rows) in one pass — the signature of the wrong
file being synced against real data (a fixture bank, a build that silently produced an
empty/truncated file), not a real College Board refresh, which retires at most a handful of stale
ids per run. Below 50 live rows the check does not apply, so a small dev/test table can still be
freely rebuilt end to end. This guard exists only in code (`app/sat/bank_sync.py`), not in the
plan's original design, which described the retire-on-absence rule but not a bound on how much of
the table a single sync may retire.

Whether `bank.jsonl.gz` itself is committed to the repository is owner decision **O5** — see "Risk
R0" below. Until that is answered, the file sits at the same path, gitignored, and every code path
(sync, tests, local development) works identically either way.

### A read rate limit on question detail

Every other read endpoint in this codebase is unrestricted. `GET /questions/{id}` is not: it is the
one endpoint through which a signed-in account can walk an entire licensed question bank one request
at a time — 3,767 questions, fully enumerable by id. A dedicated read limit
(`sat_question_reads_per_minute`, defaulting well above any real student's usage with prefetch on)
turns a bulk-scrape attempt into a throttled, logged event rather than something the API quietly
permits. This is a narrow, deliberate exception to the codebase's otherwise-unlimited-GET norm,
made because this is the one surface where the exposure named in Risk R0 is actually reachable
through the product.

### The official Desmos embed (O3)

liprep ships Desmos's proprietary `calculator.js` bundle and Desmos's public demo API key — neither
licensed for a production product. The calculator tool is instead an `<iframe>` of the exact
calculator College Board itself embeds in Bluebook
(`https://www.desmos.com/testing/cb-digital-sat/graphing`, redirecting to
`/testing/collegeboard/graphing`; verified to carry no `X-Frame-Options` or `frame-ancestors`
restriction), served through a Settings value (`sat_desmos_embed_url`) rather than hard-coded. The
consequence for the owner: this calculator's feature set and configuration (degree mode, the test
feature set) are College Board's, not Counselle's, to change. A future partner API key, if ever
obtained, is a one-file swap.

### The CSS Custom Highlight API for passage/stem highlighting

liprep implements its yellow-highlighter tool by wrapping selected text nodes in `<mark>` elements
by hand, which has real defects: un-highlighting throws under some selections, and what counts as
"highlightable" falls out of an ancestor DOM test with surprising edges. The port instead stores
highlights as data, not DOM — a sorted list of `[start, end)` character offsets per question per
field (`stimulus` | `stem`), computed over the sanitized DOM's `textContent` — and paints them with
the CSS Custom Highlight API (`CSS.highlights.set(...)`, `::highlight(sat)`) rather than mutating
the DOM at all. Offsets are never persisted and are dropped on question change, matching liprep's
own behaviour. This trades browser-support breadth (Chrome 105+, Safari 17.2+, Firefox 140+; the
tool disables itself with an explanation where the API is missing) and print/assistive-technology
exposure (a painted highlight is not a `<mark>` element, so it does not print and is not exposed to
AT — recorded as risk R6) for correctness: the offset arithmetic is pure, unit-testable without a
DOM, and has none of liprep's un-highlight or ancestor-test defects.

## Rationale

- **Coverage and fidelity to "the same product" over a rewrite.** The product ask is explicitly
  liprep's own dashboard, practice screen, tools, and analytics — not a new SAT-practice design.
  Porting behaviour under differential tests against the real upstream code is the only strategy
  among the three considered that can make "identical numbers" a checked property rather than a
  hoped-for one; embedding or refactoring-in-place both keep code this repo does not want while
  still requiring the same behavioural verification work.
- **A pure grading function is the honesty-critical core, and it belongs in `domain/`.** Per ADR
  0017's layering, a fact this product must never get wrong — is this answer correct — sits in the
  pure core, hard-tested, with server-side grading (D2) as the only path a verdict can come from.
  This mirrors how ADR 0006 keeps citation and reading rules in code rather than in the model's
  head: the pattern here is the same discipline applied to a different honesty-critical fact.
- **A seed file plus boot sync, not a crawler worker, matches the data's actual cadence.** The
  question bank changes a few times a year. Running a live worker against College Board at request
  time or even on a schedule would add an operational dependency and a runtime failure mode for data
  that does not need runtime freshness — the same reasoning ADR 0038 used to choose a scheduled,
  code-typed scrape over a real-time fetch for CollegeData, applied here to an even slower-changing
  source.
- **The official Desmos embed is simpler and more honest than shipping a proprietary bundle without
  a license**, and it happens to be exactly what College Board itself serves to students inside
  Bluebook — there is no meaningful gap between "the real experience" and "what we are legally
  entitled to embed."
- **The CSS Custom Highlight API is the right tool for data-only, non-mutating highlighting**, and
  its browser-support ceiling is an honestly-recorded trade (R6), not a hidden one — the tool
  disables itself with an explanation rather than silently degrading to something that looks like it
  works.

## Alternatives considered

- **Embed liprep as-is (iframe or a second Vite entry).** Rejected — see "Port, not fork" above;
  keeps IndexedDB as the store, a second router/font stack, and unlicensed hex-coded CSS.
- **Copy liprep's files into `features/sat/` and refactor in place.** Rejected — see "Port, not
  fork" above; both the storage layer and the styling layer of every copied file are wrong for this
  product, leaving the same pure-logic-plus-JSX-skeleton result as the chosen option, with worse
  history.
- **Client-side grading, with the key shipped in the question payload.** Rejected: the question
  payload would then carry the answer key to a Bluebook-style question the student is actively
  answering, making the honesty-critical "is this correct" decision a client-trusted claim rather
  than a server fact — unacceptable for the same reason ADR 0006 keeps reading rules server-side.
- **A live or scheduled crawler against College Board, rather than an offline seed file.** Rejected:
  the bank changes infrequently, a runtime dependency on College Board's endpoints buys nothing the
  product needs, and it would multiply the exposure named in Risk R0 by adding a recurring live-crawl
  surface instead of a one-time offline fetch.
- **A partner Desmos API key instead of the official Bluebook embed.** Not chosen for launch (O3
  defaults to the embed): no partnership exists today, and the embed already reproduces exactly what
  students see in the real Bluebook app. Recorded as a one-file swap (`sat_desmos_embed_url`) if a
  partner key is obtained later (risk R4).
- **Hand-wrapping selected text in `<mark>` elements, as liprep does.** Rejected: liprep's own
  implementation is the source of two named parity-inventory defects (an un-highlight path that
  throws, and a surprising ancestor-based highlightability test); the offset-based, DOM-non-mutating
  approach has neither.

## Risk R0 — College Board content licence

**The single largest open risk in this feature is legal, not technical, and engineering cannot
mitigate it.** College Board's SAT Suite Question Bank is fetched here as the *Educator* Question
Bank: its own terms grant its content "for the purpose of classroom teaching and internal reporting
only," state there is "no right to upload or post online, cache, reproduce, modify, display…"
without written permission, and its copyright guidance explicitly excludes "test prep and other
commercial settings." Counselle, under this plan, would store the full bank server-side and serve it
to students inside a commercial product — a use these terms do not appear to authorize.

This is a **contractual risk**, in the same family as ADR 0038's Risk R0 for CollegeData's Terms of
Use, and it is **not resolved by anything in this design**. What the design *does* do is keep every
option open and pay no cost for delaying the decision:

- The bank file is gitignored by default, sitting at the same on-disk path either way — nothing
  about local development, testing, or the sync path depends on whether it is ever committed.
- `bank-sync` no-ops cleanly with no bank file present; the app boots and the rest of the feature is
  fully exercisable against a locally-built bank that never leaves the workstation.
- The read rate limit on `GET /questions/{id}` (above) bounds how fast the *stored* bank could be
  bulk-extracted back out through the product's own API, regardless of what is decided about
  publishing it.
- No bulk-export endpoint of the bank exists or is planned; the data is served only through the
  product's own practice-screen surfaces.

**This is owner decision O5, and it has no default.** The options, all supported by the design as
built: (a) accept the exposure, as ADR 0038 did for CollegeData's Terms of Use; (b) seek written
permission from College Board; (c) build and test the feature privately, and publish nothing — not
the bank file, not a production deployment — until the question is resolved. **Development of this
feature never waits on O5. Committing `bank.jsonl.gz` to the repository, and any production
deployment of this feature, do.**

## Owner decisions

All nine are choices the plan makes to reach a working, reviewable design without stalling
development on unanswered product questions. Each default below is the plan's own working
assumption — **proceeding on default, owner may veto** — except O5, which has no default and is
covered separately above.

| # | Decision | Default | Blocks |
|---|---|---|---|
| O1 | Drop liprep's marketing chrome (its Home hero, About page, GitHub star prompt, Wall of Love) | drop — **proceeding on default, owner may veto** | — |
| O2 | Re-voice liprep's in-joke copy (dashboard greetings, the reset guard) with identical mechanics, including the three-press reset confirmation | re-voice — **proceeding on default, owner may veto** | — |
| O3 | Desmos calculator: the official College Board embed (configuration is College Board's) vs. a partner API key | embed — **proceeding on default, owner may veto** | — |
| O4 | Offline / PWA support | out of scope — **proceeding on default, owner may veto** | — |
| **O5** | **College Board content licence (Risk R0, above)** | **none — needs an answer; not a default** | committing the bank file; production. **Not development** |
| O6 | Server-side grading: "Check answer" becomes one round trip and requires a connection (D2) | accept — **proceeding on default, owner may veto** | — |
| O7 | Accept College Board's own published free-response entry rule where liprep would wrongly reject a correct, field-filling answer (see "Server-side grading and the O7 acceptance path" above) | accept — **proceeding on default, owner may veto** | — |
| O8 | The full FIX list: upstream defects deliberately not reproduced, enumerated row-by-row in `parity-inventory.md`'s *Deliberate differences* table | accept all — **proceeding on default, owner may veto any individual row** | — |
| O9 | The dashboard greeting: Counselle's house rule is no prose under a page title, but liprep's greeting is treated as part of its character | keep, as one line in the header's subtitle slot, recorded as the rule's one named exception — **proceeding on default, owner may veto** | — |

## Consequences

- Counselle gains a full SAT practice surface with College Board's own official question content,
  grading, and statistics reproduced to the same numbers liprep itself would produce — checked, not
  assumed, by a differential test harness run directly against upstream's code.
- The honesty-critical grading rule now exists in exactly one place (`domain/sat/grading.py`),
  server-side, following the same pattern ADR 0006 established for citations — no client-trusted
  answer key exists anywhere in the payloads the browser receives.
- **Stated plainly, without softening: the ~70 legacy free-response answer keys that decide whether
  a student's typed answer is graded right or wrong were confirmed by an AI agent, not by a human
  reviewer**, contrary to this plan's own design ("every one is confirmed by a person," §3.5) —
  `config/assets/sat/spr_keys.yaml`'s own header records the adjudication date and that an owner or
  reviewer spot-check is still pending (plan risk R11). This sits inside the one part of the feature
  this ADR calls honesty-critical, so it is not a minor process footnote: until that spot-check
  happens, "server-side grading is the one honesty-critical core" is true of the *code path*, not
  yet fully true of the *data* that path grades against for these ~70 items.
- A new, narrow exception to this codebase's otherwise-unlimited-GET convention exists
  (`sat_question_reads_per_minute`), justified specifically by the enumerable, licensed nature of the
  question bank this feature serves.
- The feature's frontend inherits liprep's own long-lived browser requirements for two named tools:
  the CSS Custom Highlight API (Chrome 105+, Safari 17.2+, Firefox 140+, with a disabled fallback
  elsewhere) and the Desmos iframe embed (a College Board dependency this product does not control
  the configuration of).
- The question bank is a seed artifact with a defined refresh path (`fetch → build → audit →
  bank-sync`), not a live dependency — College Board's endpoints going away or changing shape after a
  successful build has no runtime effect on the shipped product.
- **The Counselle agent has no access to SAT practice data at all — not even read-only.** Unlike the
  facts store, where the agent is a scoped reader (ADR 0038), `counselle.sat_*` has no agent tool of
  any kind pointed at it; `app/sat/` exists as the seam a later plan would use, and none exists yet.
  This is a stricter isolation than the facts-store read boundary, not an instance of it.
- A sanitiser hardening pass beyond the plan's original `sat-html.ts` design — found by a security
  review during P4, not anticipated in `plan.md` §6.2 — forbids `<form>`, `<input>`, `<button>`,
  `<select>`, `<textarea>`, and `<option>` outright (College Board's own default DOMPurify profile
  allowances would otherwise let a `<form action="https://…">` render and submit, or an orphaned
  `<input>`/`<button>` bind to one via a bare `form="…"` attribute, straight out of question
  content — a native, no-JavaScript phishing vector with no legitimate use in passages, stems,
  options, or rationales); `action`/`method` attributes are forbidden as defense in depth. The one
  legitimate use MathML makes of a `form` attribute (`<mo form="prefix">`, a stretchy fence's
  open/close direction) is preserved by scoping that attribute, via a `uponSanitizeAttribute` hook,
  to the MathML tag set only — DOMPurify's `ADD_ATTR` allow-list is flat and not element-scoped, so
  without that hook `form` would still survive on any element, including the forbidden ones' would-be
  descendants.
- **This ADR cannot be moved to Accepted while O5 is unanswered.** Development, testing, and review
  of the feature can and does proceed against a locally-built, gitignored bank in the meantime;
  committing the bank file and any production deployment are the two points where O5's answer
  becomes load-bearing, and both are named explicitly as blocked in the owner-decisions table above.
