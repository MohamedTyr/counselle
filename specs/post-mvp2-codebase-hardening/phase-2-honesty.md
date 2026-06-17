# Phase 2 — Honesty Integrity (the non-negotiable)

> **Execution:** follow the per-phase loop in `plans/audit/REMEDIATION-PLAN.md` §2
> — dispatch Opus implementer(s), run the §2.4 gate, then ≥3 non-leading Sonnet
> reviewers verifying **correctness AND completeness**, fix↔re-review until
> unanimous SHIP, then one commit (`fix(phase2): honesty integrity — citation
> boundaries, value-decode guards, receipt fidelity`). **Implement EVERYTHING
> below; miss nothing.** These are the highest-value tests in the repo. Honesty
> findings are top priority **regardless of nominal severity** — a MEDIUM here
> outranks a HIGH elsewhere, because the product's one non-negotiable principle
> (CLAUDE.md principle 3, ADR 0006) is *never lie to a student*.
>
> The code snippets are the intended shape; line numbers have drifted, so read
> the real file before each edit. Where a snippet conflicts with the current
> code, the **acceptance criteria + the test** are authoritative — make the test
> pass honestly, don't pattern-match the snippet.

This phase makes the honesty surface tell the truth in eight places where it can
currently mislead a student:

| ID | What can lie today | Sev |
|----|--------------------|-----|
| FE-C1 | Reveal lights an external-attributed clause as "From Counselle's verified data" — `[999]` leak is fixed; bare-prose attribution is an accepted ADR-0006 residual | CRITICAL (one real leak fixed; one residual accepted) |
| FE-H4 | "Counselle data" card/count is driven by a prose `[n]` scan, but DB facts carry no `[n]` marker | HIGH |
| DS-01 | A coded `int` whose code isn't in its decode map shows the raw integer as a count | MEDIUM (honesty) |
| DS-02 | `search_school_site` stamps every result `tier=official` even when off-domain | MEDIUM (honesty) |
| DS-10 | `_percent` has no range check — a drifted `45` renders "4500%" | MEDIUM (honesty) |
| BC-13 | A search that succeeds with no `results` list omits the "0 results" receipt | MEDIUM (honesty) |
| DS-08 | `national_benchmark` casts BBRR privacy-range tokens `::numeric` → crash | MEDIUM (honesty-adjacent) |
| DS-03 | The `query_database` escape hatch bypasses normalize/citation — honesty rests on a docstring | MEDIUM (design) |
| FE-DUP-CITED-SCAN | Footer/panel index scan is regex-over-raw-markdown (over-counts a `[7]` in a code fence) | LOW |

---

## Scope & files touched

**Frontend (`frontend/src/`):**
- `components/citations/remarkDbSpans.ts` — FE-C1 (bound the clause at the last leftover `[…]` marker — closes the `[999]` leak; bare-prose attribution is an accepted ADR-0006 residual, not fixed here).
- `components/citations/remarkCitations.ts` — FE-H4 (new `usedDbData` / `dbSourcesForMessage` derivations), FE-DUP-CITED-SCAN (mdast-based scan helper).
- `components/citations/MessageSources.tsx` — FE-H4 (single-source the strip count / panel inclusion / dbSchools).
- `components/citations/SourcesList.tsx` — FE-H4 (`displaySourceCount` decoupled from cited-`[n]`).
- `components/citations/SourcesPanel.tsx` — FE-H4 (`displaySourceCount` caller — update to the two-arg signature; derive `dbUsed` from the panel payload and thread `dbUsed`/`showDbCard` to `SourcesList`).
- `components/citations/dbSchools.ts` — FE-H4 (no behavior regression; verify it stays the single school derivation).
- `vendor/.../Content/MessageContent.tsx` — FE-H4 (panel-open payload uses the new derivation; inline-pill activate keeps the prose `[n]` scan — that one is correct).
- Tests: `components/citations/__tests__/remarkDbSpans.test.tsx`, `__tests__/citations.test.tsx`, a new `__tests__/messageSources.test.tsx`.

**Backend:**
- `domain/normalize.py` — DS-01 (`_int` unmapped-code degrade), DS-10 (`_percent` range guard).
- `adapters/tavily_tools.py` — DS-02 (per-result tier re-derivation in `search_school_site`).
- `counselle_db/service.py` — DS-08 (`_BENCHMARK_SQL` token exclusion), DS-03 (value-bearing-column flag on `query_database` result).
- `counselle_db/server.py` / `counselle_db/models.py` — DS-03 (carry the flag through the wire shape).
- `app/steps.py` — BC-13 (`detail_for` defaults `result_count=0` on a no-results success).
- `evals/questions.yaml` + (if needed) `evals/runner.py` — DS-03 (an eval that catches raw-fraction / raw-code leakage from the escape hatch).
- Tests: `tests/domain/test_normalize.py`, `tests/app/test_tavily_tools.py`, `tests/app/test_steps.py`, `tests/counselle_db/test_live_db.py`, `tests/counselle_db/test_service_query_database.py` (new or extend existing).

**Explicitly leave alone (do NOT "fix" — recorded so reviewers don't flag as a miss):**
- The inline-pill activate handler in `MessageContent.tsx` keeps scanning prose `[n]` — an inline pill *is* the prose marker, so the prose scan is correct there. Only the **DB-card / strip count / panel dbSchools** decouple.
- DS-07 (SQL guard denylist) and DS-04/DS-05/DS-06/DS-09 (auth/secret/rate-limit knobs) belong to **Phase 6**, not here.
- The `_currency` "no range check" half of DS-10 is left as-is: negative net-price is *valid* (DATABASE_GUIDE R5), there's no sane symmetric bound, and a wrong-but-plausible dollar figure is far less misleading than "4500%". Only `_percent` gets a bound. (Note this in the PR so reviewers don't flag the asymmetry.)

---

## Gate commands (for this phase)

```bash
# Backend
uv run ruff check .
uv run mypy .
uv run pytest -m "not live_llm and not live_search" \
  tests/domain/test_normalize.py tests/app/test_tavily_tools.py \
  tests/app/test_steps.py tests/counselle_db/test_service_query_database.py
# DS-08 + DS-02-live need the DB / Tavily:
uv run pytest -m live_db tests/counselle_db/test_live_db.py -k benchmark
# Frontend
cd frontend && npm run typecheck && npm test && npm run build
```

**Eval note (DS-03):** after the code changes land, run the honesty eval slice
to confirm the escape-hatch leakage guard is exercised:

```bash
uv run python -m evals.runner --type honesty      # judge-scored; ~$ small
```

This run is part of **this phase's** completeness check (it proves the new
`raw-fraction / raw-code leakage` eval case scores), but the full eval
**re-baseline + report commit** stays in **Phase 7** — do not re-commit
`evals/report-*.json` here.

---

## Findings & fixes

Order: CRITICAL → HIGH → MEDIUM (honesty-grouped) → LOW.

---

### FE-C1 — Reveal can light an external-attributed clause as "from Counselle's verified data"  [CRITICAL → mixed: one real leak fixed, one residual accepted]

- **Files:**
  - `frontend/src/components/citations/remarkDbSpans.ts` (`wrapClauses`, `splitAtLastBoundary`)
  - `frontend/src/components/citations/DbClaim.tsx` (the consumer — no change needed, but read it to understand the source gate)
  - `frontend/src/vendor/.../Content/markdownConfig.ts:48` (plugin order — no change; just confirm `[…, remarkCitations, remarkDbSpans]`)

- **What is broken vs. what already works (read this before touching anything).**
  Two reviewers independently flagged the original FE-C1 framing as technically
  wrong. The corrected ground truth, verified against the real
  `remarkCitations → remarkDbSpans` pipeline:

  1. **Adjacent BRACKETED different-class citations — ALREADY CORRECT, not a
     bug.** `remarkCitations` converts every `[n]` (1–2 digits) into a
     `citationRef` node and *splits the surrounding text node around it*
     (`splitTextNode`). So for
     `"US News reports 1480–1570 [5], close to our own figure of 1490 [1]."`,
     the text node immediately preceding `citationRef(1)` already *starts after*
     `citationRef(5)` — its value is only `", close to our own figure of 1490 "`.
     `wrapClauses` keys off that immediate `prev` text node, so the `[1]` clause
     is already bounded; "US News reports 1480–1570 " sits in a separate text
     node owned by `[5]` (a `web` source ⇒ `DbClaim` renders it inert). **No fix
     is needed for this case, and a test of it passes today with zero code
     change.** Keep it as a regression guard, but do **not** frame it as "the
     bug."

  2. **Unmatched multi-digit marker (`[999]`) — a REAL leak, and it IS fixable
     here.** `remarkCitations`' pattern is `\[(\d{1,2})\]` — 1–2 digits only. A
     `[999]` is never converted to a `citationRef`, so it stays as literal text.
     For
     `"Source 999 lists 1480–1570 [999], close to our figure of 1490 [1]."`,
     `citationRef(1)`'s immediate `prev` text node is the whole run
     `"Source 999 lists 1480–1570 [999], close to our figure of 1490 "`, and
     `splitAtLastBoundary` finds no `.?!` boundary — so the entire run (incl.
     the external "Source 999" attribution) gets wrapped in the `[1]` db-claim
     and lights on reveal. This **is** fixable by additionally bounding the
     clause at the last leftover `[…]` bracket (the `EMBEDDED_MARKER` scan
     below).

  3. **Bare-prose external attribution with NO marker — a REAL leak, but
     architecturally UNDETECTABLE at this layer (accepted residual).** For
     `"US News reports 1480–1570, close to our own figure of 1490 [1]."`, there
     is no bracket and no `.?!` between "US News reports" and the DB clause, so
     the whole clause becomes one text node and the entire run wraps into the
     `[1]` db-claim. The proposed `EMBEDDED_MARKER` scan does **NOT** fix this —
     there is no bracket in the text to cut at, and a `<Word> reports/says/lists`
     attribution heuristic is not machine-reliable. This case is the model's
     responsibility under ADR 0006 (attach a marker, or don't co-mingle an
     external claim into a DB-cited clause). See "Residual limitation (accepted)"
     below. **Do not write a test asserting this is bounded — it cannot be, and
     such a test would fail with the prescribed fix.**

- **Fix (EXACT before/after) — two layers, both correct & cheap.**

  **Layer 1 — `splitAtLastBoundary`: also bound at the last leftover `[…]`
  bracket** (closes case 2, the `[999]` leak; no-op for cases 1 & 3). Bound the
  clause at the later of (a) the last `.?!` sentence boundary and (b) the
  position just after the last leftover `[…]` bracket run that `remarkCitations`
  did not consume.

  Before:
  ```ts
  /**
   * Split a preceding text value into a leading remainder (everything up to and
   * including the last `.?!` boundary) and the trailing clause to wrap. When the
   * text has no boundary, the whole value is the clause.
   */
  function splitAtLastBoundary(value: string): { head: string; clause: string } {
    SENTENCE_BOUNDARY.lastIndex = 0;
    let lastEnd = -1;
    for (const match of value.matchAll(SENTENCE_BOUNDARY)) {
      lastEnd = match.index + match[0].length;
    }
    if (lastEnd <= 0 || lastEnd >= value.length) {
      return { head: '', clause: value };
    }
    return { head: value.slice(0, lastEnd), clause: value.slice(lastEnd) };
  }
  ```

  After:
  ```ts
  //: Any "[…]" the citation plugin left behind — e.g. a 3+-digit marker like
  //: "[999]" that remarkCitations' `\[(\d{1,2})\]` pattern did not capture. Such
  //: a leftover bracket belongs to a DIFFERENT (often external) source, so the
  //: db-claim clause must not reach back across it.
  const EMBEDDED_MARKER = /\[[^\]]*]\s*/g;

  /**
   * The clause to wrap = the text after the LATER of (a) the last `.?!` sentence
   * boundary and (b) the last leftover `[…]` bracket. (a) keeps a db-claim from
   * swallowing a prior sentence; (b) closes the unmatched-multi-digit-marker
   * leak (a "[999]" the citation plugin left as text — see FE-C1 case 2). When
   * neither is present, the whole value is the clause.
   *
   * NOTE the deliberate limit: a bare external attribution with NO bracket and
   * NO sentence boundary ("US News reports … [1]") is undetectable here and is
   * the model's responsibility per ADR 0006 — see the header's residual note.
   */
  function splitAtLastBoundary(value: string): { head: string; clause: string } {
    let cut = 0;
    SENTENCE_BOUNDARY.lastIndex = 0;
    for (const match of value.matchAll(SENTENCE_BOUNDARY)) {
      cut = Math.max(cut, match.index + match[0].length);
    }
    EMBEDDED_MARKER.lastIndex = 0;
    for (const match of value.matchAll(EMBEDDED_MARKER)) {
      cut = Math.max(cut, match.index + match[0].length);
    }
    if (cut <= 0 || cut >= value.length) {
      return { head: '', clause: value };
    }
    return { head: value.slice(0, cut), clause: value.slice(cut) };
  }
  ```

  **Layer 2 — `wrapClauses`: document the prior-`citationRef` invariant (no code
  change).** `remarkCitations` already splits the text node at *every* `[n]`, so
  by the time `wrapClauses` runs, the immediate `prev` text node never reaches
  back across a prior `citationRef` — it only ever holds the text accumulated
  *since* the last marker. The "never reach across a prior `citationRef`" rule is
  therefore already guaranteed by the split; a runtime guard would be pure dead
  code (its condition can never be true). So Layer 2 is implemented as **a single
  explanatory comment** in `wrapClauses` documenting that invariant — the
  existing wrap logic is left exactly as it is. (This is why case 1 holds today
  with zero code change; it does not affect cases 2 or 3, which have no prior
  `citationRef` sibling before the DB clause.)

  Keep Layer 1 (the `EMBEDDED_MARKER` bound in `splitAtLastBoundary`) exactly as
  written above — that is the real working fix. Layer 2 changes nothing
  executable.

  Before:
  ```ts
  function wrapClauses(children: ReadonlyArray<Node>): Node[] | null {
    let changed = false;
    const out: Node[] = [];
    for (const child of children) {
      if (isCitationRef(child)) {
        const index = citationIndexOf(child);
        const prev = out[out.length - 1];
        if (index !== null && prev !== undefined && prev.type === 'text') {
          const { head, clause } = splitAtLastBoundary((prev as Text).value);
          if (clause.length > 0) {
            out.pop();
            if (head.length > 0) {
              out.push({ type: 'text', value: head } as Text);
            }
            out.push(makeDbClaimNode(clause, index) as unknown as Node);
            changed = true;
          }
        }
      }
      out.push(child);
    }
    return changed ? out : null;
  }
  ```

  After — identical working code, plus one comment recording the invariant. No
  dead branch, no `!x === false`, no new condition or variable:
  ```ts
  function wrapClauses(children: ReadonlyArray<Node>): Node[] | null {
    let changed = false;
    const out: Node[] = [];
    for (const child of children) {
      if (isCitationRef(child)) {
        const index = citationIndexOf(child);
        const prev = out[out.length - 1];
        // Invariant (FE-C1 Layer 2): the clause text for a citationRef never
        // reaches across a PRIOR citationRef, because remarkCitations already
        // split the text node at each `[n]` marker. So `prev` only ever holds
        // the text accumulated since the last marker — no runtime "don't cross a
        // prior citationRef" guard is needed; the split already guarantees it.
        if (index !== null && prev !== undefined && prev.type === 'text') {
          const { head, clause } = splitAtLastBoundary((prev as Text).value);
          if (clause.length > 0) {
            out.pop();
            if (head.length > 0) {
              out.push({ type: 'text', value: head } as Text);
            }
            out.push(makeDbClaimNode(clause, index) as unknown as Node);
            changed = true;
          }
        }
      }
      out.push(child);
    }
    return changed ? out : null;
  }
  ```

  **Header comment fix (REQUIRED step — do not skip).** Update the
  `remarkDbSpans.ts` header comment: replace the false "any prior citationRef
  bounds the clause on the left" claim with the accurate rule — **the clause is
  bounded by a sentence boundary OR a leftover `[…]` marker, whichever is later
  (Layer 1)** — plus the **ADR-0006 residual-limitation note**: bare-prose
  external attribution with no inline marker is undetectable at this layer and is
  the model's responsibility. Concretely, replace the now-false claim in the
  header (lines ~12–16: "any prior citationRef split the text, bounding the
  clause on the left") with the real, two-part rule:
  > "Each `citationRef`'s clause is the text node immediately preceding it,
  > trimmed on the left to the LATER of (a) the last `.?!` sentence boundary and
  > (b) the last leftover `[…]` marker (a 3+-digit `[999]` remarkCitations did
  > not capture). A bare external attribution with no marker and no sentence
  > boundary in the same text node ('US News reports … [1]') is NOT detectable
  > here — bounding that is the model's responsibility per ADR 0006; `DbClaim`'s
  > source gate is the only backstop in that residual case."

- **Residual limitation (accepted).** Case 3 — a bare-prose external attribution
  with no inline marker, co-mingled with a DB-cited clause in one text node — is
  **not closed by this fix and cannot be closed at the remark-plugin layer.**
  The clause text alone carries no machine signal that "US News reports" is
  external. Honesty for this case rests on two things, neither of which this fix
  changes:
  - **ADR 0006 model responsibility:** the model must either attach a `[n]` to an
    external claim (which then bounds the DB clause) or not splice an external
    attribution into a DB-cited sentence.
  - **`DbClaim`'s source gate** (already correct): a clause only lights when its
    `[n]` resolves to a *streamed DB source*. The gate ensures **non-DB indices
    never light** — but it operates on the clause's index, so it *cannot* detect
    external **prose** sitting under a DB index. It is a backstop against the
    wrong *source class*, not against co-mingled external *text*.

  This is an accepted residual, documented here and in the `remarkDbSpans.ts`
  header. Reviewers: do not flag case 3 as an unfixed bug — it is an ADR-0006
  model constraint, and the original plan's claim that the `EMBEDDED_MARKER` scan
  closed it was wrong.

- **Severity (honest re-framing).** FE-C1 splits into:
  - **Fixed (real leak):** the unmatched-multi-digit `[999]` case — closed by the
    `EMBEDDED_MARKER` bound. *This is the one genuine code bug FE-C1 closes.*
  - **Already correct (regression-guarded):** adjacent bracketed different-class
    citations — bounded by `remarkCitations`' split today; kept as a guard.
  - **Accepted residual:** bare-prose external attribution with no marker —
    undetectable here, owned by ADR 0006 + the `DbClaim` source gate.

  Keep FE-C1 a **high-priority honesty item** (it is the worst *class* of bug and
  the `[999]` leak is real), but the fix **does not** close the bare-prose hole —
  do not claim it does.

- **Tests to add** (`__tests__/remarkDbSpans.test.tsx`, extend the existing
  pipeline-render suite; these are load-bearing honesty tests):

  1. **Regression guard — adjacent BRACKETED different-class citations stay
     bounded (passes today, no code change required).** Render through the
     **real** pipeline AND the real `DbClaim` source gate (not a stub), with
     `[5]`→`web`, `[1]`→`cds`:
     ```
     mdast input (prose): "US News reports 1480–1570 [5], close to our own figure of 1490 [1]."
     sources: [{index:5, citation:{source:'web',…}}, {index:1, citation:{source:'cds',…}}]
     reveal: ON
     EXPECT:
       - the [5] clause "US News reports 1480–1570 " renders PLAIN (web source ⇒ DbClaim inert)
       - the [1] clause is exactly ", close to our own figure of 1490 " (remarkCitations split at [5])
       - the [1] clause is the ONLY element carrying data-revealed / aria-label="From Counselle's verified data"
       - NO highlighted element's textContent contains "US News"
     ```
     Frame this in the test name/comment as a **regression guard for behavior
     that is already correct** — e.g.
     `it('keeps adjacent bracketed different-class citations bounded (already correct — regression guard)')`.
  2. **Unmatched 3-digit marker bounds the clause (the `EMBEDDED_MARKER` fix —
     this is the real bug FE-C1 closes):**
     ```
     input: "Source 999 lists 1480–1570 [999], close to our figure of 1490 [1]."
     sources: [{index:1, citation:{source:'cds',…}}], reveal ON
     EXPECT: the [1] lit clause textContent === ", close to our figure of 1490 "
             (the leftover "[999]" bracket bounds it; "1480–1570" and "Source 999" are NOT lit)
             AND no [data-revealed] element contains "Source 999" or "1480–1570".
     ```
  3. **Bare-prose external attribution — KNOWN ADR-0006 LIMITATION (do NOT assert
     it is bounded).** This case is the residual above. Add the test to *document
     the limit*, not to assert an impossible bound. Assert only the achievable
     floor — the `DbClaim` source-gate floor — and mark it clearly:
     ```
     input: "US News reports 1480–1570, close to our own figure of 1490 [1]."
     sources: [{index:1, citation:{source:'cds',…}}], reveal ON
     ACHIEVABLE FLOOR (assert this):
       - a NON-DB index (e.g. resolve [1] to source:'web') produces ZERO [data-revealed]
         elements — the source gate prevents any external-index clause from lighting.
     KNOWN LIMITATION (comment, do NOT assert as a bound):
       - with [1]→'cds', the lit clause DOES still contain "US News reports" because the
         bare attribution carries no marker/boundary; this is the ADR-0006 model
         responsibility, not a remark-layer bug.
     ```
     Add a code comment in this test:
     `// KNOWN LIMITATION (ADR 0006): bare external attribution with no [n] and no sentence boundary co-mingled with a DB clause cannot be bounded at the remark layer; the model must mark it. The DbClaim source gate only prevents non-DB indices from lighting.`
     Do **not** write `expect(...).not.toContain('US News')` against the `[1]→cds`
     case — that assertion is impossible to satisfy and would fail the suite.
  4. **Regression:** every existing `remarkDbSpans.test.tsx` case still passes
     unchanged (sentence-boundary trim, U.S. abbreviation, marker-at-start, etc.).

- **Acceptance criteria:**
  - [ ] The unmatched-`[999]` clause is bounded by the leftover bracket
        (`EMBEDDED_MARKER`), and no `[data-revealed]` element contains
        "Source 999" / "1480–1570" in that scenario. *(the real fix)*
  - [ ] The adjacent-bracketed-different-class test passes through the **real**
        `DbClaim` gate (web clause inert, db clause bounded & lit) **with no code
        change** — it is a guard for already-correct behavior.
  - [ ] The bare-prose test asserts the **source-gate floor** (a non-DB index
        never lights) and carries the ADR-0006 limitation comment; it does NOT
        assert "US News" is absent from the `[1]→cds` lit clause.
  - [ ] The `remarkDbSpans.ts` header comment is corrected: the false "any prior
        citationRef bounds the clause on the left" claim is replaced with the
        accurate rule (the clause is bounded by a sentence boundary OR a leftover
        `[…]` marker, whichever is later — Layer 1), plus the ADR-0006
        residual-limitation note (bare-prose external attribution with no inline
        marker is undetectable at this layer and is the model's responsibility);
        no claim that bare prose is handled.
  - [ ] No dead/broken branch shipped — Layer 2 is the documented-invariant
        comment in `wrapClauses` only (no `!x === false`, no new condition or
        variable); the executable wrap logic is unchanged.
  - [ ] All pre-existing `remarkDbSpans` tests stay green.
  - [ ] `npm test && npm run typecheck` green.

---

### FE-H4 — "Counselle data" inclusion/count is driven by a prose `[n]` scan, but DB facts carry no `[n]` marker  [HIGH]

- **Files:**
  - `frontend/src/components/citations/remarkCitations.ts` (`citedSourcesForMessage`, plus new `usedDbData` / `dbSourcesForMessage`)
  - `frontend/src/components/citations/MessageSources.tsx`
  - `frontend/src/components/citations/SourcesList.tsx` (`displaySourceCount`)
  - `frontend/src/components/citations/SourcesPanel.tsx` (`displaySourceCount` caller — `:15,29`; new signature + thread `dbUsed`/`showDbCard`)
  - `frontend/src/components/citations/dbSchools.ts` (the existing authoritative school derivation — keep)
  - `frontend/src/app/state.ts` (`SourcesPanelState` + `openSourcesPanelAtom` write type gain a `dbUsed` field)
  - `frontend/src/vendor/.../Content/MessageContent.tsx` (panel-open payload)

- **Problem (the exact lie-to-the-student failure mode):** Whether the
  "Counselle data" attestation appears — in the strip count
  (`displaySourceCount`), the panel header, and the panel's Counselle-data card —
  is currently gated through `citedSourcesForMessage`, which filters
  `message.sources` to entries whose index appears in the prose `[n]` grammar.
  But DB figures **deliberately carry no inline `[n]` marker** in prose
  (`InlineCitation` returns null for DB sources; figures live in viz cards). So a
  DB source is included **only if the model happened to also emit a literal `[n]`
  for it in prose — which the grammar says it must not**. Result:
  - a viz-card dossier answer (the common DB case) can **hide** "Counselle data"
    when no `[n]` leaked into prose, and
  - an answer where a stray DB `[n]` did leak can **show** "Counselle data" it
    didn't really cite.

  This makes the verified-data attestation non-deterministic w.r.t. the actual
  source mix — the honesty surface driven by a fragile text-scan. Additionally,
  `dbSchoolsForMessage` already derives schools from **viz blocks** (authoritative)
  with a CDS-label fallback — so the card's *schools* and the card's *existence*
  use two different signals that can disagree (a Scorecard/IPEDS-only viz answer
  has schools but, depending on `[n]`, may not surface the card at all).

- **Fix (EXACT before/after):** Decouple DB-source inclusion from prose `[n]`.
  Derive "this answer used Counselle data" from the **authoritative** signals:
  (a) a viz block is present, OR (b) a DB source entry exists in
  `message.sources`. Single-source the strip count, the panel header, the panel
  card, and `dbSchools` off **one** derivation. External sources keep the prose
  `[n]` filter (correct — an external source is cited iff its `[n]` is in prose).

  Add to `remarkCitations.ts`:
  ```ts
  /**
   * The DB source entries an answer actually used — DB facts carry NO inline
   * `[n]` (figures live in viz cards / the panel), so DB inclusion is derived
   * from the authoritative signals, NOT the prose `[n]` scan: (a) any viz block,
   * or (b) any DB-class source entry on the message. Returns the DB SourceEntry
   * subset (may be empty). Single-sourced so the strip count, panel header,
   * panel card, and dbSchools cannot disagree (honesty — FE-H4).
   */
  export function dbSourcesForMessage(message: {
    content?: ReadonlyArray<{ kind: string }>;
    sources?: ReadonlyArray<SourceEntry>;
  }): SourceEntry[] {
    const dbEntries = (message.sources ?? []).filter((s) => isDbSource(s.citation.source));
    if (dbEntries.length > 0) return dbEntries;
    // No DB SourceEntry rows. A viz-only answer still USED Counselle data, but it
    // has no per-row source entries to render in the panel — the card's existence
    // is driven by `usedDbData()` (the boolean) and its school names by
    // `dbSchoolsForMessage` (the viz blocks), NOT by source entries. So there are
    // simply no DB rows to return here.
    return [];
  }

  /** Did this answer use Counselle's own data? (viz card OR a DB source entry.) */
  export function usedDbData(message: {
    content?: ReadonlyArray<{ kind: string }>;
    sources?: ReadonlyArray<SourceEntry>;
  }): boolean {
    if ((message.sources ?? []).some((s) => isDbSource(s.citation.source))) return true;
    return (message.content ?? []).some((b) => b.kind === 'viz');
  }
  ```

  Build the panel's source list as **external-cited + DB-entries** from one
  place. In `MessageSources.tsx`, before:
  ```tsx
  const cited = useMemo(() => citedSourcesForMessage(message), [message]);
  const externals = useMemo(() => cited.filter((s) => !isDbSource(s.citation.source)), [cited]);
  const dbSchools = useMemo(() => dbSchoolsForMessage(message), [message]);
  ...
  if (cited.length === 0) return null;
  return (
    <SourcesStrip
      sources={externals}
      displayCount={displaySourceCount(cited)}
      onOpen={() => openSources({ sources: cited, activeIndex: null, dbSchools })}
    />
  );
  ```
  After (single derivation; DB inclusion via `usedDbData`, externals via the
  prose `[n]` scan):
  ```tsx
  // External sources: cited iff their [n] is in prose (correct grammar).
  const externalCited = useMemo(
    () => citedSourcesForMessage(message).filter((s) => !isDbSource(s.citation.source)),
    [message],
  );
  // Counselle data: authoritative signal (viz card OR DB source entry), NOT [n].
  const dbUsed = useMemo(() => usedDbData(message), [message]);
  const dbEntries = useMemo(() => dbSourcesForMessage(message), [message]);
  const dbSchools = useMemo(() => dbSchoolsForMessage(message), [message]);

  // The panel renders DB entries (if any) + external rows; the card shows
  // whenever dbUsed, even with zero DB SourceEntry rows.
  const panelSources = useMemo(
    () => [...dbEntries, ...externalCited],
    [dbEntries, externalCited],
  );
  const displayCount = (dbUsed ? 1 : 0) + externalCited.length;

  if (message.turnStatus !== 'complete' && message.turnStatus !== 'cancelled') return null;
  if (!dbUsed && externalCited.length === 0) return null;

  return (
    <SourcesStrip
      sources={externalCited}
      displayCount={displayCount}
      onOpen={() => openSources({ sources: panelSources, activeIndex: null, dbSchools, dbUsed })}
    />
  );
  ```

  `SourcesList.displaySourceCount` currently re-derives DB inclusion from the
  passed `sources` array (`db.length > 0 ? 1 : 0`). With the viz-only case
  having **zero** DB entries but `dbUsed=true`, the count must come from the
  caller. Change the panel to render the Counselle card from an explicit
  `dbUsed`/`showDbCard` prop, not from `dbEntries.length > 0`:

  In `SourcesList.tsx`, before:
  ```ts
  export function displaySourceCount(sources: SourceEntry[]): number {
    const db = sources.filter((s) => isDbSource(s.citation.source));
    const externals = sources.length - db.length;
    return (db.length > 0 ? 1 : 0) + externals;
  }
  ...
  {dbEntries.length > 0 && (
    <CounselleSourceCard innerRef={counselleRef} schools={dbSchools} active={counselleActive} />
  )}
  ```
  After (the card's visibility is an explicit input, defaulting to "has DB
  entries" for back-compat callers, but `MessageSources` passes `dbUsed`):
  ```ts
  export function displaySourceCount(externals: SourceEntry[], dbUsed: boolean): number {
    return (dbUsed ? 1 : 0) + externals.length;
  }
  ```
  Add a `showDbCard?: boolean` prop to `SourcesList` (default
  `dbEntries.length > 0`); render `CounselleSourceCard` when
  `showDbCard ?? dbEntries.length > 0`. Thread `dbUsed` from the panel host so a
  viz-only answer still shows the card. Update the panel-open atom payload type
  (`openSourcesPanelAtom`) to carry `dbUsed` (or pass `showDbCard`).

  **MANDATORY — update EVERY caller of `displaySourceCount` (the signature
  changes from `(sources)` to `(externals, dbUsed)`).** Run
  `grep -rn "displaySourceCount" frontend/src` first; the current call sites
  (verified, beyond the `MessageSources.tsx`/`SourcesList.tsx` the plan already
  listed) are:

  | File:line | Current call | Required change |
  |-----------|--------------|-----------------|
  | `components/citations/SourcesList.tsx:28` | the definition | new signature `(externals, dbUsed)` |
  | `components/citations/MessageSources.tsx:50` | `displaySourceCount(cited)` | `displaySourceCount(externalCited, dbUsed)` (see the `MessageSources` after-snippet) |
  | `components/citations/SourcesPanel.tsx:15,29` | imports it; `const count = displaySourceCount(sources)` | the panel receives a mixed `sources` array (DB entries + externals) and must now also receive a `dbUsed`/`showDbCard` signal. Derive `dbUsed` from the panel payload (the `openSourcesPanelAtom` now carries it) and call `displaySourceCount(sources.filter((s) => !isDbSource(s.citation.source)), dbUsed)`. Pass the same `showDbCard`/`dbUsed` down to `SourcesList`. |
  | `app/MessagePreview.tsx:24,422,557` | imports it; two calls `displaySourceCount(sources)` / `displaySourceCount(SOURCES)` | `MessagePreview` is the **preview/dead-code surface** (see Cross-phase note FE-C1 ↔ Phase 4 — it re-implements the old, less-honest rule and is slated for Phase 4/5). It is NOT a production path, but it **must still compile**. Update both calls to the new signature using a local `dbUsed` derived from its fixture (`SOURCES.some((s) => isDbSource(s.citation.source))`), so `npm run typecheck && npm run build` stay green. Do NOT otherwise re-engineer MessagePreview here. |

  Do not stop at the two the plan originally listed — `SourcesPanel.tsx` and
  `MessagePreview.tsx` are also direct callers and will fail typecheck/build if
  missed. After editing, re-run `grep -rn "displaySourceCount" frontend/src` and
  confirm every call uses the two-arg form.

  In `MessageContent.tsx`, the **inline-pill activate** handler keeps using
  `citedSourcesForMessage` (correct — a pill is a prose `[n]`), but its
  panel-open payload must match the new shape: pass `dbUsed`/`showDbCard` and the
  same `panelSources` so the panel opened from a pill agrees with the panel
  opened from the strip.

  > **Implementer judgement:** the exact prop plumbing (a `dbUsed` flag on the
  > atom vs a `showDbCard` prop on `SourcesList`) is your call — the binding
  > acceptance criterion is: **the strip count, the panel header count, the
  > panel Counselle card, and `dbSchools` are all derived from the SAME
  > `usedDbData` signal, and a viz-only DB answer shows "Counselle data" while a
  > pure-external answer does not.**

- **Tests to add** (new `__tests__/messageSources.test.tsx` or extend
  `citations.test.tsx`):
  1. **Viz-only DB answer, no DB `[n]` in prose:** message with one `viz` content
     block, `sources=[]` (or only external), no `[n]` in prose →
     `usedDbData === true`; strip `displayCount` includes +1; panel renders the
     Counselle card; `dbSchools` = the viz `schools[].name`.
  2. **Pure-external answer (web `[1]`, no viz, no DB source):**
     `usedDbData === false`; no Counselle card; `displayCount === 1` (the one web
     source only).
  3. **DB source entry but no `[n]` and no viz:** `sources=[{source:'cds'}]`,
     prose has no `[n]` → `usedDbData === true`; card shows.
  4. **Mixed:** one web `[1]` cited in prose + one viz block →
     `displayCount === 2`, externals list has 1, card shown.
  5. **Single-source consistency:** assert the strip's `displayCount`, the
     panel's header count, and the presence of the card all agree for each of
     the above (the regression FE-H4 is about).

- **Acceptance criteria:**
  - [ ] DB-source inclusion is derived from viz-block / DB-source presence, never
        from a prose `[n]` scan.
  - [ ] `usedDbData` (or equivalent) is the single source for the strip count,
        panel header, panel card, and dbSchools — they cannot disagree.
  - [ ] A viz-only DB answer shows "Counselle data"; a pure-external answer does
        not.
  - [ ] `SourcesPanelState` in `state.ts` carries `dbUsed: boolean` (and the
        `openSourcesPanelAtom` write type accepts it).
  - [ ] The inline-pill activate path opens a panel consistent with the strip.
  - [ ] EVERY `displaySourceCount` caller is updated to the two-arg
        `(externals, dbUsed)` signature — `MessageSources.tsx`, `SourcesPanel.tsx`,
        and both calls in `app/MessagePreview.tsx` — verified by re-running
        `grep -rn "displaySourceCount" frontend/src`.
  - [ ] The new `dbSourcesForMessage` ends with a single `return []` (when there
        are no DB source entries), accompanied by the explanatory comment (the
        "used Counselle data" boolean comes from `usedDbData()`, schools from
        `dbSchoolsForMessage`, not from source entries).
  - [ ] All five tests pass; `npm test && npm run typecheck && npm run build` green.

---

### DS-01 — Coded `int` with an unmapped code shows the raw integer as a count  [MEDIUM · honesty]

- **Files:** `domain/normalize.py` (`_int`)

- **Problem (the exact lie-to-the-student failure mode):** R1 (DATABASE_GUIDE §6)
  is explicit: "never show `control: 2`." When a field **is** coded
  (`decode_map is not None`) but the stored code is **not a key** in the map — a
  new IPEDS code, a partial valuesets load, or an uncovered sentinel — `_int`
  falls through to `f"{count:,}"` and shows the raw integer **as if it were a
  count**. A student could be told a school's `CONTROL` is "4" or `ADMCON7` is
  "1" with no decode. A coded field with an unknown code is *unknown*, not a
  count — it must fail to "not available", not to a wrong-looking number.

- **Fix (EXACT before/after):**
  Before:
  ```python
  def _int(value: Any, decode_map: Mapping[str, str] | None) -> NormalizedValue:
      count = int(_decimal(value).to_integral_value(rounding=ROUND_HALF_UP))  # R6
      if decode_map is not None and str(count) in decode_map:  # R1 — never show the code
          label = decode_map[str(count)]
          return NormalizedValue(
              display=label, raw=count, available=True, unit="count", decoded_label=label
          )
      return NormalizedValue(display=f"{count:,}", raw=count, available=True, unit="count")
  ```
  After:
  ```python
  def _int(value: Any, decode_map: Mapping[str, str] | None) -> NormalizedValue:
      count = int(_decimal(value).to_integral_value(rounding=ROUND_HALF_UP))  # R6
      if decode_map is not None:
          # R1 — the field IS coded. Decode it, or degrade: an unknown code is
          # "unknown", never a count. Showing the raw integer (e.g. control: 2)
          # is exactly the misread R1 exists to prevent.
          label = decode_map.get(str(count))
          if label is None:
              return _not_available()
          return NormalizedValue(
              display=label, raw=count, available=True, unit="count", decoded_label=label
          )
      # Uncoded int (counts/scores/ratios) — display as a plain number.
      return NormalizedValue(display=f"{count:,}", raw=count, available=True, unit="count")
  ```

- **Tests to add** (`tests/domain/test_normalize.py`):
  - `test_coded_int_with_unmapped_code_degrades_to_not_available`: a
    `data_type="int"` field with `decode_map={"1":"Public","2":"Private…","3":"…"}`
    and value `4.0` → `result.available is False` and
    `result.display == "not available"` (NOT "4").
  - Regression: the existing decode-success test (value `2.0` → "Private
    not-for-profit") and the no-decode-map plain-count test still pass.

- **Acceptance criteria:**
  - [ ] A coded int whose code is absent from its decode map returns
        `available=False`, `display="not available"`.
  - [ ] A coded int with a present code still decodes (unchanged).
  - [ ] An uncoded int (no decode map) still displays the count (unchanged).
  - [ ] `uv run pytest tests/domain/test_normalize.py` green.

---

### DS-02 — `search_school_site` stamps every result `official` even off-domain  [MEDIUM · honesty]

- **Files:** `adapters/tavily_tools.py` (`search_school_site`)

- **Problem (the exact lie-to-the-student failure mode):** The citation is fixed
  to `source="edu", tier="official"` from the resolved school domain, then each
  result's URL is overwritten via `citation.model_copy(update={"url": r["url"]})`
  while the **tier stays `official`**. Tavily's `include_domains` is a relevance
  bias, not a hard guarantee on all SDK/plan tiers — an off-domain result (a
  community page, a third-party host) is presented to a student as the school's
  own authoritative source. That's citation mis-attribution.

- **Fix (EXACT before/after):** Re-derive the citation **per result** from the
  actual `r["url"]`. When the result is on the resolved school domain, keep the
  "school's official site" citation; otherwise fall back to
  `_citation_for_web_result(url, today)` (the same logic `search_web` uses —
  tiers `.edu/.gov/.mil` official, everything else community with the
  verify-on-official-site caveat).
  Before:
  ```python
  citation = Citation(
      source="edu",
      tier="official",
      vintage=f"Retrieved {today:%b %d, %Y} (school's official site)",
      url=f"https://{domain}",
  )
  try:
      resp = await client.search(... include_domains=[domain] ...)
  except (...):
      return _safe_error(exc)

  results = resp.get("results", [])
  items = [
      _result_to_item(r, citation.model_copy(update={"url": r.get("url", f"https://{domain}")}))
      for r in results
  ]
  return {"results": items}
  ```
  After:
  ```python
  school_site_vintage = f"Retrieved {today:%b %d, %Y} (school's official site)"
  try:
      resp = await client.search(... include_domains=[domain] ...)
  except (...):
      return _safe_error(exc)

  results = resp.get("results", [])

  def _citation_for_school_result(url: str) -> Citation:
      # On-domain ⇒ the school's own official site. Off-domain (include_domains
      # is a bias, not a guarantee) ⇒ re-tier honestly via the web-result rule.
      if _registrable_domain(url) == domain:
          return Citation(
              source="edu",
              tier="official",
              vintage=school_site_vintage,
              url=url,
          )
      return _citation_for_web_result(url, today)

  items = [
      _result_to_item(r, _citation_for_school_result(r.get("url", "")))
      for r in results
  ]
  return {"results": items}
  ```
  (If `r["url"]` is empty/missing, `_registrable_domain("")` returns `None`
  ≠ `domain`, so it falls to `_citation_for_web_result("", today)` → `web` /
  `community` — honest "couldn't verify the host" rather than a false official
  stamp.)

- **Tests to add** (`tests/app/test_tavily_tools.py`, in `TestSearchSchoolSite`,
  using the existing `StubTavilyClient` + monkeypatched `_get_values_impl`):
  - `test_on_domain_result_stays_official`: domain resolves to `duke.edu`, result
    URL `https://duke.edu/admissions` → citation `tier=="official"`,
    `source=="edu"`, vintage contains "school's official site".
  - `test_off_domain_result_is_retiered_community`: domain resolves to
    `duke.edu`, but the stub returns a result on `https://collegeconfidential.com/duke`
    → citation `tier=="community"`, `source=="web"`, and a caveat containing
    "verify on the school's official site". Assert it is **not** `official`.
  - `test_off_domain_gov_result_is_official_web`: an off-domain `.gov` result →
    `tier=="official"`, `source=="web"` (re-derived correctly, not from the
    school stamp).

- **Acceptance criteria:**
  - [ ] On-domain results keep the school's-official-site citation.
  - [ ] Off-domain results are re-tiered via `_citation_for_web_result` (no false
        `official`).
  - [ ] No result is ever stamped `official` for a host that isn't the school's
        domain or a `.gov/.mil/.edu` host.
  - [ ] `uv run pytest tests/app/test_tavily_tools.py` green.

---

### DS-10 — `_percent` has no range check; a drifted `45` renders "4500%"  [MEDIUM · honesty]

- **Files:** `domain/normalize.py` (`_percent`)

- **Problem (the exact lie-to-the-student failure mode):** `_percent` blindly
  does `fraction * 100` with no bound. DATABASE_GUIDE §6 guarantees percents are
  stored as 0–1 fractions (max 1.0) — but the guide *itself* warns IPEDS was
  `divisor:100`-converted, a real cross-source drift risk. If the pipeline ever
  stored a percent as `45` (already a percentage, not a fraction), a student is
  told **"4500%"**. The product's principle is to put honesty in code, not trust
  an external producer. Degrade beyond a sane bound rather than emit a nonsense
  display.

- **Fix (EXACT before/after):** Clamp/guard with a sane upper bound. A legitimate
  fraction is ≤ 1.0; allow generous slack for rounding/odd-but-real values, then
  degrade. Use `1.5` as the bound (per the audit) — anything above is drift, not
  a real probability.
  Before:
  ```python
  def _percent(value: Any) -> NormalizedValue:
      fraction = _decimal(value)
      return NormalizedValue(
          display=_fraction_as_percent(fraction),
          raw=value if isinstance(value, int | float) else float(fraction),
          available=True,
          unit="percent",
      )
  ```
  After:
  ```python
  #: A percent is a 0–1 fraction (DATABASE_GUIDE §6, max 1.0). Generous slack for
  #: rounding; beyond this it's pipeline drift (a raw "45" stored where a 0.45
  #: fraction belongs) — degrade rather than render "4500%".
  _MAX_PERCENT_FRACTION = Decimal("1.5")

  def _percent(value: Any) -> NormalizedValue:
      fraction = _decimal(value)
      if fraction < 0 or fraction > _MAX_PERCENT_FRACTION:
          # Out of the 0–1 fraction contract ⇒ unknowable, not a real percent.
          return _not_available()
      return NormalizedValue(
          display=_fraction_as_percent(fraction),
          raw=value if isinstance(value, int | float) else float(fraction),
          available=True,
          unit="percent",
      )
  ```
  (Negative fractions are also nonsensical for a percent here and degrade too.)

- **Tests to add** (`tests/domain/test_normalize.py`):
  - `test_percent_above_one_point_five_degrades_to_not_available`: a
    `data_type="percent"` field with value `45` → `available is False`,
    `display == "not available"` (NOT "4500%").
  - `test_percent_at_one_point_zero_still_renders`: value `1.0` → "100%"
    (boundary still valid).
  - `test_percent_slightly_over_one_still_renders`: value `1.2` → "120%"
    (within the `1.5` slack — a real >100% growth-style value isn't clobbered).
  - `test_negative_percent_degrades`: value `-0.1` → `available is False`.
  - Regression: the existing `0.042 → "4.2%"` etc. tests pass.
  - Add the same bound to the property test
    (`tests/domain/test_normalize_properties.py`) if it generates percent inputs:
    inputs in `[0, 1.5]` render, inputs outside degrade (don't crash, don't emit
    a display > a sane bound).

- **Acceptance criteria:**
  - [ ] A percent value > 1.5 (or < 0) degrades to `available=False`.
  - [ ] Values within `[0, 1.5]` render unchanged (no regression).
  - [ ] No percent display ever exceeds the bound (e.g. never "4500%").
  - [ ] `_currency` is intentionally left unbounded (documented above).
  - [ ] `uv run pytest tests/domain/test_normalize.py tests/domain/test_normalize_properties.py` green.

---

### BC-13 — Receipt omits "0 results" when a search succeeds without a `results` list  [MEDIUM · honesty]

- **Files:** `app/steps.py` (`detail_for`)

- **Problem (the exact lie-to-the-student failure mode):** In `detail_for` for
  search kinds, `result_count` is set **only** when `content["results"]` is a
  list. If a search returns a success dict **without** a `results` key (shape
  drift), `result_count` is never set; `ev_step` then drops the `None` field, so
  the student sees a completed search step with **no** "N results" — it reads as
  if it found something it didn't. (Tavily errors already route to
  `status:error`, so the only success-but-no-list case is benign shape drift —
  which should honestly show "0 results".)

- **Fix (EXACT before/after):** Default `result_count = 0` for search kinds when
  the content is a **success** dict (a dict without an `"error"` key — matching
  `result_is_error`) but carries no `results` list.
  Before:
  ```python
  if kind in ("web_search", "edu_search", "reddit_search"):
      kwargs["query"] = _str_or_none(args.get("query"))
      results = content.get("results") if isinstance(content, dict) else None
      if isinstance(results, list):
          kwargs["result_count"] = len(results)
          kwargs["domains"] = _domains_of(results)
  ```
  After:
  ```python
  if kind in ("web_search", "edu_search", "reddit_search"):
      kwargs["query"] = _str_or_none(args.get("query"))
      results = content.get("results") if isinstance(content, dict) else None
      if isinstance(results, list):
          kwargs["result_count"] = len(results)
          kwargs["domains"] = _domains_of(results)
      elif isinstance(content, dict) and "error" not in content:
          # Success-but-no-results (shape drift): show "0 results" explicitly
          # rather than omit the count — a completed search that found nothing
          # must say so (honesty). Errored searches keep status:error / no count.
          kwargs["result_count"] = 0
  ```

- **Tests to add** (`tests/app/test_steps.py`):
  - `test_search_success_without_results_list_shows_zero`: call `detail_for` for
    a `web_search` tool with `content={"query": "x"}` (success dict, no
    `results`) → `detail.result_count == 0`.
  - Regression: `content={"results": [...]}` still counts the list length;
    `content={"error": "..."}` does **not** set `result_count` (stays None/omitted).

- **Acceptance criteria:**
  - [ ] A successful search with no `results` list yields `result_count == 0`.
  - [ ] An errored search still omits `result_count`.
  - [ ] A normal search still counts its results.
  - [ ] `uv run pytest tests/app/test_steps.py` green.

---

### DS-08 — `national_benchmark` casts BBRR privacy-range tokens `::numeric` → crash  [MEDIUM · honesty-adjacent]

- **Files:** `counselle_db/service.py` (`_BENCHMARK_SQL`)

- **Problem (the exact failure mode):** `_BENCHMARK_SQL` runs
  `percentile_cont(...) WITHIN GROUP (ORDER BY (value)::numeric)` and
  `avg((value)::numeric)` across all rows for a field. BBRR `percent` fields
  (e.g. `outcomes.bbrr2_pell_default`) store a **mix** of jsonb numbers and
  privacy-range **string** tokens (`"<=0.05"`, `"0.05-0.09"`) per R4. Casting a
  jsonb string to `::numeric` raises a Postgres error, surfacing as a generic
  `ServiceError("query failed: …")`. It degrades to an error (honest) not a
  wrong number — but it's an un-handled known data shape, and a benchmark a
  student asked for silently fails.

- **Fix (EXACT before/after):** Exclude non-numeric rows in the benchmark
  predicate. `value` is `jsonb`; `jsonb_typeof(value) = 'number'` selects only
  the numeric rows (skips string tokens) without a fragile regex.
  Before:
  ```python
  _BENCHMARK_SQL = """
  SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY (value)::numeric) AS median,
         avg((value)::numeric)                                          AS mean,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY (value)::numeric) AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY (value)::numeric) AS p75,
         count(*)                                                       AS n
  FROM field_values
  WHERE field_key = $1 AND source = $2 AND value IS NOT NULL
  """
  ```
  After:
  ```python
  _BENCHMARK_SQL = """
  SELECT percentile_cont(0.5)  WITHIN GROUP (ORDER BY (value)::numeric) AS median,
         avg((value)::numeric)                                          AS mean,
         percentile_cont(0.25) WITHIN GROUP (ORDER BY (value)::numeric) AS p25,
         percentile_cont(0.75) WITHIN GROUP (ORDER BY (value)::numeric) AS p75,
         count(*)                                                       AS n
  FROM field_values
  WHERE field_key = $1 AND source = $2
    AND value IS NOT NULL
    AND jsonb_typeof(value) = 'number'   -- skip BBRR privacy-range tokens (R4)
  """
  ```
  (`n` then counts only the benchmarkable numeric rows — the
  `BenchmarkResult.citation.caveat` "across N institutions in our database"
  remains truthful: it's the count actually used.)

- **Tests to add** (`tests/counselle_db/test_live_db.py`, `live_db`-marked):
  - `test_bbrr_percent_field_benchmark_does_not_crash`: call
    `national_benchmark(catalog, "outcomes.bbrr2_pell_default")` (a known
    token-mixed BBRR percent field per DATABASE_GUIDE R4) → it returns a
    `BenchmarkResult` (no `ServiceError`); `result.n >= 1`; every stat
    `display.endswith("%")`. (If the precise field key differs in the live
    schema, the implementer picks any field whose `source`/key the catalog marks
    as a token-mixed BBRR percent — assert the no-crash + valid-stats behavior.)
  - Regression: the existing acceptance-rate benchmark test still passes
    (its field is clean numeric; the `jsonb_typeof` predicate is a no-op there).

- **Acceptance criteria:**
  - [ ] A benchmark over a token-mixed BBRR percent field returns a valid
        `BenchmarkResult` instead of raising.
  - [ ] `n` reflects only the numeric rows used (caveat stays truthful).
  - [ ] The clean-numeric benchmark (acceptance rate) is unaffected.
  - [ ] `uv run pytest -m live_db tests/counselle_db/test_live_db.py -k benchmark` green.

---

### DS-03 — `query_database` escape hatch bypasses normalize/citation  [MEDIUM · design, honesty-fenced]

- **Files:** `counselle_db/service.py` (`query_database`), `counselle_db/server.py`
  (the `query_database` MCP tool), `counselle_db/models.py` (`QueryResult`),
  `evals/questions.yaml` (+ `evals/runner.py` if a new assertion shape is needed)

- **Problem (the exact lie-to-the-student failure mode):** `query_database`
  returns raw rows (`rows=[list(row) for row in rows]`) with **no envelope** — no
  decode (R1), no ×100 percent scaling (R2), no vintage, no citation, no
  `available=False` for sentinels. The only honesty control is prose in the tool
  docstring asking the model to apply R1–R12 by hand. A model that reads
  `acceptance_rate = 0.036` and says "3.6 acceptances", or reads a `-2` system
  sentinel as a real value, directly violates the non-negotiable. ADR 0005
  accepts the hatch, but there is **no runtime guard** that raw rows get
  re-honesty-checked.

- **Fix (cheapest high-value guard — do BOTH):**

  **(a) Flag value-bearing columns in the tool result.** When a returned column
  name matches a known field key (or a `*.value` / known coded/percent column),
  add a machine-readable note so the model is reminded to decode/scale before
  quoting — moving the honesty cue from English prose into the structured result.
  In `query_database` (service.py), after building `columns`, compute a
  `decode_hints` map: for each column name that resolves to a catalog field whose
  `data_type` is `percent`/`int`(coded) — or that is literally named `value` —
  attach a short note. Add the field to `QueryResult`:
  ```python
  # counselle_db/models.py
  class QueryResult(BaseModel):
      """Layer-3 escape-hatch result — raw rows, normalization bypassed."""
      columns: list[str]
      rows: list[list[Any]]
      row_count: int
      truncated: bool
      # DS-03: per-column honesty reminders for value-bearing columns the raw
      # rows did NOT decode/scale. Empty when no column is recognizably
      # value-bearing. The model MUST apply these before quoting (R1/R2/R4).
      decode_hints: dict[str, str] = {}
  ```
  ```python
  # counselle_db/service.py — inside query_database, after columns is built
  hints: dict[str, str] = {}
  for col in columns:
      meta = catalog.fields_by_key.get(col)
      if meta is not None and meta.data_type == "percent":
          hints[col] = "0–1 fraction — multiply by 100 before quoting (R2)."
      elif meta is not None and meta.data_type == "int":
          hints[col] = "may be a coded enum — decode via counselle.decode_ipeds before quoting (R1)."
      elif col == "value":
          hints[col] = (
              "raw field_values payload — percents are 0–1 fractions, coded ints "
              "need decoding, '-2'/range tokens are sentinels (R1/R2/R4)."
          )
  return QueryResult(
      columns=columns,
      rows=[list(row) for row in rows],
      row_count=len(rows),
      truncated=truncated,
      decode_hints=hints,
  )
  ```
  Surface `decode_hints` through the server tool (server.py already does
  `result.model_dump(mode="json")`, so the field flows automatically — just
  confirm it isn't stripped). Keep the docstring guidance too.

  > **Implementer judgement:** `catalog.fields_by_key` is the catalog's field
  > index used elsewhere in this module; confirm the attribute name in the real
  > `Catalog` and use whatever the rest of `service.py` uses to resolve a field
  > key → `FieldMeta`. If a column can't be resolved, no hint is added (no false
  > reassurance).

  **(b) Add an eval that catches raw-fraction / raw-code leakage.** Add an
  `honesty`-type case to `evals/questions.yaml` whose question is phrased so the
  agent is likely to reach for `query_database` on a value-bearing column, and
  whose judge criteria (per `evals/judge.md`) explicitly check the answer did
  **not** leak a raw 0–1 fraction or an undecoded code. Shape:
  ```yaml
  - id: honesty-escape-hatch-no-raw-fraction
    type: honesty
    question: "Using the raw field_values, what fraction of applicants does Stanford admit, and what does that mean as a percentage?"
    expects:
      criteria:
        - "The answer states the acceptance rate as a percentage (e.g. '~4%'), NOT as a bare 0-1 fraction like '0.04 acceptances'."
        - "The answer does not present any raw coded integer (e.g. 'control: 2') without decoding it to its label."
        - "If a value could not be decoded/scaled, the answer says it's unavailable rather than quoting the raw stored value."
  ```
  Confirm `evals/runner.py`'s `score_honesty` already routes `criteria` to the
  judge (it does — `QUESTION_TYPES` includes `"honesty"`); if the new case needs
  no new scorer code, leave the runner untouched. **Run
  `uv run python -m evals.runner --type honesty` and confirm the new case
  scores** (this is part of this phase's completeness; the report re-baseline +
  commit stays in Phase 7).

- **Tests to add:**
  - `tests/counselle_db/test_service_query_database.py` (new or extend):
    `test_query_database_flags_percent_and_coded_columns` — **a UNIT test, NOT
    `live_db`.** The hint derivation only needs `catalog.fields_by_key` (a
    `dict[str, FieldMeta]`) and the returned column names — it does not need a
    real connection. Build a fake catalog with `fields_by_key` populated by hand:
    one `percent` field (e.g. `FieldMeta(key="admissions.acceptance_rate",
    data_type="percent", …)`), one coded `int` field (e.g.
    `FieldMeta(key="institution.control", data_type="int", …)`), and exercise the
    hint-building logic over a synthetic column list
    `["name", "unitid", "admissions.acceptance_rate", "institution.control", "value"]`.
    Assert `decode_hints` contains the R2 note for the percent column, the R1 note
    for the coded-int column, the R1/R2/R4 note for the literal `value` column,
    and **no** key for `name`/`unitid`.
    - **Why unit, not live_db:** this MUST run under the routine gate
      `uv run pytest -m "not live_llm and not live_search"` so the hint logic is
      verified on every run, not only when a DB is attached. If the hint
      derivation is currently inlined inside `query_database` (which awaits
      `fetch`), **extract it into a small pure helper**
      (e.g. `_decode_hints_for(catalog, columns) -> dict[str, str]`) so the unit
      test can call it directly with a fake catalog and no pool. The helper is
      then called from `query_database`. (This keeps the test off `live_db` and
      keeps `query_database` < 50 lines — house rule.)
  - The eval case above (counts as the runtime honesty guard).

- **Acceptance criteria:**
  - [ ] `QueryResult.decode_hints` flags percent / coded-int / raw-`value`
        columns with an R1/R2/R4 reminder, empty otherwise.
  - [ ] The flag flows through the MCP `query_database` tool (not stripped by the
        server wrapper).
  - [ ] A new `honesty` eval case checks the escape hatch doesn't leak a raw
        fraction or undecoded code, and it scores when the honesty slice runs.
  - [ ] The decode-hints test is a **UNIT** test (fake `fields_by_key`, no pool)
        and runs under `pytest -m "not live_llm and not live_search"`.
  - [ ] `uv run pytest tests/counselle_db/test_service_query_database.py` green;
        `uv run python -m evals.runner --type honesty` runs and scores the new case.

---

### FE-DUP-CITED-SCAN — Citation index scan is regex-over-raw-markdown (over-counts a `[7]` in a code fence)  [LOW · honesty paper-cut]

- **Files:** `frontend/src/components/citations/remarkCitations.ts` (`citedIndexesIn`)

- **Problem (the exact lie-to-the-student failure mode):** `citedIndexesIn` runs
  `/\[(\d{1,2})\]/g` over **raw markdown** for the footer/panel index set. The
  doc comment admits "a `[7]` inside a code fence over-counts at worst." A
  literal `[12]` inside a code block or a quoted example mis-attributes a source
  row — a small honesty paper-cut on a product whose differentiator is honesty.
  The remark plugin's own transform (`transform`/`splitTextNode`) **already**
  skips `code`/`inlineCode` (it only visits `text` nodes) — so the correct,
  code-aware scan already exists; the footer/panel just don't use it.

- **Fix:** Scan the **mdast** (skipping `code`/`inlineCode`) for the
  footer/panel, reusing the plugin's node-walk path rather than regexing the raw
  string. Add a helper that parses the markdown to mdast with the same
  `remark`/`remarkGfm` setup the renderer uses and collects `[n]` indexes from
  `text` nodes only:
  ```ts
  import { unified } from 'unified';
  import remarkParse from 'remark-parse';
  import remarkGfm from 'remark-gfm';
  import { visit } from 'unist-util-visit';
  import type { Text } from 'mdast';

  /**
   * The `[n]` indexes cited in a markdown block, scanning the parsed mdast and
   * skipping code/inlineCode (the renderer's plugin already excludes those, so
   * the footer/panel must too — a `[7]` in a code fence is NOT a citation).
   * Replaces the raw-string regex (FE-DUP-CITED-SCAN).
   */
  const parser = unified().use(remarkParse).use(remarkGfm);
  export function citedIndexesIn(text: string): Set<number> {
    const indexes = new Set<number>();
    const tree = parser.parse(text);
    visit(tree, 'text', (node: Text) => {
      for (const m of node.value.matchAll(CITATION_PATTERN)) {
        indexes.add(Number(m[1]));
      }
    });
    return indexes;
  }
  ```
  (`CITATION_PATTERN` is a `/g` regex shared with `splitTextNode`; reset
  `lastIndex` or use `matchAll`, which is stateless on a fresh string —
  `matchAll` is safe here.)

  **MANDATORY deps step (do NOT rely on transitive availability).** `remark-parse`
  and `unist-util-visit` are present today only *transitively* (pulled by
  `react-markdown`); importing them as direct deps without declaring them is a
  phantom-dependency hazard (a `react-markdown` bump can drop or float them). You
  **MUST** run:
  ```bash
  cd frontend && npm install unified remark-parse unist-util-visit
  ```
  and confirm both land in `frontend/package.json` `dependencies` (not just the
  lockfile). `remark-gfm` is already a direct dep; `unified`, `remark-parse`, and
  `unist-util-visit` are added by the install step above — verify with
  `grep -E '"(unified|remark-gfm|remark-parse|unist-util-visit)"' frontend/package.json`
  (all four must appear). A deps change is a structural deviation — note the two
  newly-declared packages in the PR per §2. Do not skip this because the build
  "happens to pass" on the transitive copy.

  If pulling `remark-parse` directly is genuinely undesirable, the only acceptable
  alternative is to have `remarkCitations` (already running in the render
  pipeline) **emit** the cited-index set as a side output the message carries —
  but the parse-helper above plus the explicit `npm install` is the smaller,
  contained change and is the prescribed path.

  > **Implementer judgement:** prefer reusing the exact parser config the
  > renderer uses (`markdownConfig.ts`) so the scan and the render agree on what
  > a `text` node is. If that config isn't cleanly importable, the standalone
  > `remarkParse + remarkGfm` parser above is acceptable — the supersub plugin
  > doesn't affect `[n]` detection.

- **Tests to add** (`__tests__/citations.test.tsx`):
  - `test_citedIndexesIn_ignores_a_marker_inside_a_code_fence`:
    input ``"See `[7]` in the example. Real cite [3]."`` → set is `{3}` only
    (the `[7]` in inline code is excluded).
  - `test_citedIndexesIn_ignores_a_marker_in_a_fenced_block`:
    a ```` ```\n[12]\n``` ```` block + a real `[4]` → set is `{4}`.
  - Regression: a normal `"…[1] … [2]"` still yields `{1, 2}`.

- **Acceptance criteria:**
  - [ ] `[n]` markers inside `code`/`inlineCode` are excluded from the cited set.
  - [ ] Normal prose markers are still counted.
  - [ ] The footer/panel/strip (all single-sourced off `citedIndexesIn` /
        `citedIndexesForMessage`) inherit the code-aware scan.
  - [ ] `remark-parse` and `unist-util-visit` are added to
        `frontend/package.json` `dependencies` via `npm install` (not relied on
        transitively); noted in the PR.
  - [ ] `npm test && npm run typecheck && npm run build` green.

---

## Cross-phase notes

- **FE-H4 ↔ FE-DUP-CITED-SCAN:** both touch `remarkCitations.ts`. The new
  `usedDbData`/`dbSourcesForMessage` (FE-H4) and the mdast-based `citedIndexesIn`
  (FE-DUP-CITED-SCAN) must coexist — `citedSourcesForMessage` (used for
  *external* inclusion and the inline-pill path) still calls the **new**
  code-aware `citedIndexesForMessage`. Implement both in one pass on this file.
- **FE-H4 ↔ Phase 5 (FE-SOURCECFG / FE-CITATIONS-CONTEXT-SPRAWL):** Phase 5 may
  later collapse the citation contexts and source-config; do **not** pre-empt
  that here. Keep this phase's change to the **derivation** (which sources count
  as DB), not the context topology. Leave the `openSourcesPanelAtom` shape
  minimally extended (add `dbUsed`/`showDbCard`); Phase 5 can refactor further.
- **FE-C1 ↔ Phase 4 (FE-M5 MessagePreview):** `MessagePreview.tsx` re-implements
  a *different, less honest* highlight rule (unconditional reveal). Do NOT fix
  MessagePreview here (that's Phase 4/5 dead-code/preview work) — but the FE-C1
  fix is in the **production** plugin, so the live path is correct regardless of
  the preview. Note in the PR that the preview still demonstrates the old rule.
- **DS-08 ↔ Phase 6 (DS-04/05/06/09):** the other DS-* items are auth/secret/
  rate-limit knobs assigned to Phase 6; only DS-01/02/03/08/10 (honesty) are
  here. Do not pull Phase 6 items forward.
- **BC-13 ↔ Phase 1 (lifecycle):** Phase 1 already landed the step-emission
  lifecycle fixes; BC-13 is a pure content-fidelity tweak to `detail_for` and
  does not interact with the ring-buffer/cancel work. Safe to do independently.
- **DS-03 eval ↔ Phase 7 (re-baseline):** add and *run* the new honesty eval
  case here to prove it scores, but the report file re-baseline + commit is
  Phase 7. Do not commit `evals/report-*.json` in this phase.

---

## Phase completion checklist

- [ ] **FE-C1:** `[999]` leak closed via `EMBEDDED_MARKER` bound (the one real
      fix); adjacent-bracketed-different-class regression guard passes (already
      correct, no code change); bare-prose test asserts the `DbClaim` source-gate
      floor + carries the ADR-0006 limitation comment (does NOT assert bare prose
      is bounded); false header comment corrected to the real two-part rule +
      residual note; no dead `!x === false` branch; existing `remarkDbSpans`
      tests green.
- [ ] **FE-H4:** DB inclusion derived from viz/DB-source (not prose `[n]`);
      `usedDbData` single-sources strip count + panel header + card + dbSchools;
      `dbSourcesForMessage` uses a single `return []` (no dead ternary); ALL four
      `displaySourceCount` callers (`MessageSources`, `SourcesPanel`, two in
      `MessagePreview`) updated to the new two-arg signature; all five FE-H4 tests
      pass; inline-pill panel agrees with the strip.
- [ ] **DS-01:** coded int with unmapped code → `available=False`; decode-success
      and uncoded-count paths unchanged; tests green.
- [ ] **DS-02:** off-domain school-site results re-tiered via
      `_citation_for_web_result`; on-domain stay official; three tier tests green.
- [ ] **DS-10:** `_percent` degrades beyond `[0, 1.5]`; in-range unchanged;
      `_currency` intentionally untouched (documented); tests + property test green.
- [ ] **BC-13:** success-no-results search shows `result_count == 0`; errored
      search still omits it; tests green.
- [ ] **DS-08:** BBRR token rows excluded from the benchmark (`jsonb_typeof =
      'number'`); token-field benchmark no longer crashes; clean-numeric benchmark
      unaffected; live test green.
- [ ] **DS-03:** `QueryResult.decode_hints` flags value-bearing columns and
      flows through the MCP tool; new honesty eval case added and scores when the
      honesty slice runs; service test green.
- [ ] **FE-DUP-CITED-SCAN:** `citedIndexesIn` scans mdast and skips code nodes;
      code-fence markers excluded; normal markers counted; tests green;
      `remark-parse` + `unist-util-visit` added to `package.json` deps via
      `npm install` (not transitive) and noted in the PR.
- [ ] **Gate:** `uv run ruff check . && uv run mypy .` clean;
      `uv run pytest -m "not live_llm and not live_search"` green;
      `uv run pytest -m live_db -k benchmark` green (DS-08);
      `cd frontend && npm run typecheck && npm test && npm run build` green.
- [ ] **Eval:** `uv run python -m evals.runner --type honesty` runs and the new
      DS-03 case scores (report NOT committed here — Phase 7).
- [ ] **Docs:** corrected `remarkDbSpans.ts` header; no other doc change required
      (these are bug fixes to documented behavior, not new architecture). If any
      finding changed a documented contract, note it for the Phase 9 docs sweep.
- [ ] **Review:** ≥3 Sonnet reviewers unanimous SHIP on correctness AND
      completeness (every finding above implemented, tested, and accepted).
- [ ] **Commit:** single `fix(phase2): honesty integrity — citation boundaries,
      value-decode guards, receipt fidelity` on `refactor/codebase-hardening`.
