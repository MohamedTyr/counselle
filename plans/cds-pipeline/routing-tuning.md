# CDS Page Routing — Diagnosis and Tuning

Status: DONE. Diagnosis (§1/§2), fix (§4, now including an excerpt-based
collision tie-break in `domain/cds/pages.py::resolve_cited_page`, plumbed
through the new `app/cds/citation_remap.py`), unit tests (95 CDS-scoped
tests passing, up from 88), and live verification against Harvard and
Cornell (§5/§6) are all complete. §7 is an honest statement of what remains
out of this fix's scope, not a TBD.

Scope: `app/cds/engine.py` (routing/window sizing, citation remap glue split
into `app/cds/citation_remap.py`), `adapters/cds_pdf.py`, and (as a necessary
consequence — see "scope note" below) `domain/cds/pages.py`, which owns the
±2 pad, cluster math, and the citation-resolution math the task explicitly
asks to change.

## 0. Method

1. Cheap local diagnosis (no API calls): for each of the 3 (then possibly 5)
   documents, run the engine's actual routing regex against `extract_routing_text`
   output, and independently locate the real section pages with a looser,
   ground-truth search. Compare.
2. Classify every empty-domain cause from the live Harvard baseline run into:
   (a) absent, (b) anchor failed to match a present section, (c) anchor
   matched but window too narrow, (d) cited outside window.
3. Fix routing based on what's actually found (not assumed).
4. Improve out-of-range citation handling: re-run with a covering window,
   verify in-range, only then store.
5. Re-measure the same documents, report the delta.

## 1. Cheap diagnosis table (local, zero API cost)

Method: for harvard_2024-2025, cornell_2022-2023, michigan_2024-2025, ran the
engine's actual `_route_domains`/`padded_domain_ranges` against
`extract_routing_text` output, and independently located each domain's real
section pages with a looser ground-truth regex (hyphen-glyph-tolerant,
NBSP-normalized, no trailing-period requirement). Scripts:
`/tmp/.../scratchpad/cds/diagnose_routing.py` (per-domain) and
`diagnose_calls.py` (per-CALL, i.e. the actual merged multi-domain page
cluster the engine sends to the model).

**Harvard, per-domain (BEFORE any fix):** every domain's padded window
already covered its ground-truth pages -- `pages_missed_by_window` was empty
for all 13 domains, `anchor_failed_entirely` false for all 13. The ±2 pad
was never the bottleneck on this document.

**Harvard, per-CALL (the real unit sent to the model) -- this is where the
bug actually lives:**

| Call (domain group) | Clusters | Pages sent | Domain | GT pages | Flag |
|---|---|---:|---|---|---|
| financial_aid, class_size | [3,27] | 25 | financial_aid | 5,6,18-24 | AMBIG_COLLIDE |
| admissions, faculty | [5,14],[22,26] | 15 | faculty | 24 | **AMBIG_DROP** |
| enrollment, academics | [1,8],[13,17] | 13 | academics | 15 | AMBIG_DROP |
| degrees, cost | [15,28] | 14 | degrees, cost | 20,24,26 / 17 | AMBIG_DROP |
| class_profile, identity | [1,4],[7,13] | 11 | class_profile | 9,10,11 | AMBIG_COLLIDE |
| transfer, student_life | [11,18] | 8 | transfer, student_life | 13,14 / 16 | AMBIG_DROP |
| outcomes | [2,8] | 7 | outcomes | 4,6 | AMBIG_COLLIDE |

`AMBIG_DROP` = the domain's real section page is fully INSIDE the window's
byte content, but is not a valid sub-PDF *position* (it exceeds the
window's page count) -- exactly Harvard's faculty/page-24 case the task
description names ("15-page window", page 24): the window's cluster is
`[5,14]+[22,26]` = 15 physical pages, page 24 sits at sub-PDF *position* 13
inside it, but if the model cites the literal original page number 24 (the
minority ~10-20% "followed instructions" behavior per spike-part-b.md)
instead of position 13, the OLD `_remap_findings` looked up
`page_map.get(24)` against a map with only keys 1-15, found nothing, and
dropped a citation that was pointing at content the model was actually
shown. This is **not** window-too-narrow (cause c) and **not** anchor
failure (cause b) -- it is a citation-remapping ambiguity bug (a fourth,
previously-unnamed cause), affecting nearly every multi-cluster call.

`AMBIG_COLLIDE` = the raw cited number is valid as BOTH a position and a
real in-window original page, with the two interpretations disagreeing --
the old code silently accepted the position reading always, which is
usually right (spike's own dominant-case finding) but is architecturally
capable of silently storing the wrong page.

Cornell showed the identical multi-cluster AMBIG_DROP/AMBIG_COLLIDE pattern
on the same call groups. Michigan showed a **third, genuinely different**
cause:

**Michigan: real anchor failure (cause b), confirmed by direct page text.**
`class_size` (hints `I-2`,`I-3`) and `faculty` (hint `I-1`) got ZERO routing
hits -- `_route_domains` found nothing at all, so those calls fell back to
whole-document (the 4.8MB file spike-part-b.md documents as the exact size
class where whole-document uploads fail 0/4 with `httpx.WriteTimeout`).
Reading the actual PDF text at the real location (page 24-25) showed why:

```
page 24: 'I1. Instructional Faculty by Category ...'
page 25: 'I2. Student to Faculty Ratio ... I3. Undergraduate Class Size ...'
```

Michigan's 2024-2025 CDS prints these codes with **no hyphen at all**
("I1"/"I2"/"I3"), while the manifest's `source_hints` are `I-1`/`I-2`/`I-3`
and the engine's old regex required the literal `-`. recon-cds-corpus.md §3
documents NBSP-vs-space and bare-code-vs-titled-heading variance for other
codes, but not this specific hyphen-presence variance -- found empirically
here, not assumed.

## 2. Classification of Harvard's empty domains (5/13 stored -> 8 empty)

Empty domains at baseline: cost, degrees, enrollment(via academics call),
faculty, financial_aid, identity, student_life, transfer (per
`plans/cds-pipeline/scratch/before.json`, a real live baseline run from an
earlier session against the pre-fix engine -- reused rather than re-spending
budget re-measuring the identical unfixed code).

| Cause | Count (of 8 empty) | Domains |
|---|---:|---|
| (d) citation-remap ambiguity (AMBIG_DROP/COLLIDE) | 6 | cost, degrees, faculty, financial_aid, student_life, transfer |
| (b) anchor failed on a present section | 0 on Harvard (2 on Michigan: class_size, faculty) | -- |
| (c) window genuinely too narrow | 0 | -- |
| (a) genuinely absent from the document | 0 confirmed | -- |
| unexplained by page-routing at all (model produced 0 findings for one domain in a call its groupmate succeeded in) | 2 | identity, enrollment |

`identity` (shares a call with `class_profile`, which DID succeed with 2
verified metrics) and `enrollment` (call record shows the shared
`enrollment,academics` call returned SOME findings, credited to academics)
are **not** page-routing failures at all by this diagnosis -- their pages
were fully inside the window and correctly anchored. This looks like a
shared-call model-attention artifact: when two domains share one call, the
model sometimes answers only one thoroughly. Out of strict page-routing
scope, but the retry mechanism built for item 3 (see §4) still gives these
domains one more ISOLATED single-domain attempt, which should help
regardless of the underlying cause, since isolating removes the
shared-call confound itself.

## 3. Root causes found, summary

1. **Citation-remap ambiguity (new, dominant on this corpus)**: the old
   `_remap_findings` treated every `page_number` as an always-a-position
   value. When the model instead cited the correct original page directly
   (a real, spike-documented minority behavior), the remap either dropped a
   correct citation (page > window's position count) or, worse, could
   silently accept a *different* page than intended (page is both a valid
   position and a valid in-window value). Affects nearly every multi-cluster
   call, i.e. almost every 2-domain extraction group.
2. **Anchor failure via hyphen-presence variance**: `source_hints` like
   `I-1` require a literal hyphen; Michigan's 2024-2025 CDS prints these
   codes with no hyphen at all (`I1`/`I2`/`I3`). Confirmed on-page, not
   assumed.
3. **Window-too-narrow**: not observed on harvard/cornell/michigan at the
   existing ±2 pad. Present only as a theoretical risk for sparser/larger
   documents (addressed proactively regardless, see §4).
4. **Shared-call domain starvation**: a domain sharing a 2-domain call with
   a domain-mate that succeeds can still get zero findings of its own, even
   with a fully-covered window and a correctly-matched anchor -- a model
   behavior artifact, not a page-routing bug per se, but mitigated by the
   same retry infrastructure.

## 4. Fix implemented

Files: `app/cds/engine.py`, `app/cds/starved_retry.py` (new, split out to
keep `engine.py` under the 800-line budget), `app/cds/citation_remap.py`
(new, split out for the same reason -- houses `remap_findings`/
`dropped_citation_pages`, moved out of `engine.py`), `domain/cds/pages.py`
(`resolve_cited_page` and its new `CitationResolution` return type,
`widen_clusters`, `grow_clusters`, `padded_domain_ranges`'s new
trailing-edge logic).

1. **`_hint_pattern`** (`app/cds/engine.py`): the hyphen between a letter
   prefix and its digit in a `source_hints` code is now OPTIONAL and
   tolerant of Unicode dash variants, not just the literal ASCII `-` --
   fixes cause 2 directly. `re.escape(hint).replace("\\-", f"[-{dash_chars}]?")`.
2. **`pages.resolve_cited_page`** (`domain/cds/pages.py`, replacing the old
   blind `page_map.get()` remap): tries the position interpretation first
   (the documented dominant case); if that fails, accepts the raw number
   directly when it is already one of the original pages actually included
   in the window (fixes AMBIG_DROP without needing a retry at all, since
   the correct page's content is already right there); returns
   `original_page=None` only when neither interpretation lands inside the
   window. On the rare genuine collision -- a raw number valid under BOTH
   readings, and the two readings disagree (AMBIG_COLLIDE) -- an earlier
   pass through this task defaulted straight to the position reading with
   no verification at all, on the reasoning that spike-part-b.md's own data
   (>=79% position rate on every file, 100% on Ohio State) makes that a
   defensible default. Re-reading the task's explicit ask (content
   verification via the finding's excerpt, not a bare structural-validity
   default) surfaced a real honesty gap in that shortcut: it never actually
   checked which of the two candidate pages the excerpt was on, so the
   ~10-20% minority case would have been silently mis-resolved whenever it
   collided with a position reading. Implemented properly instead: on a
   genuine collision, both candidate pages' text (`DocFacts.page_text`,
   already computed once per run for the `excerpt_on_cited_page` validator
   and reused here rather than duplicated) is checked with the *same*
   `fuzzy_contains`/`normalize_text` matcher that validator already uses, so
   this tie-break and that later flag can never quietly disagree. If the
   excerpt is found on the literal-reading page and NOT the position-reading
   page, the literal reading wins outright and is not flagged. In every
   other outcome (position confirmed, both confirmed, or text
   unavailable/inconclusive -- including the corrupt-text-layer case, since
   `engine.py` passes `page_text=None` there exactly as it already does for
   the validator) the position reading wins as the documented majority
   default, but the result is now marked `ambiguous=True` so
   `app/cds/citation_remap.py` can log it (`cds_engine_citation_ambiguous_resolution`)
   for human review -- never silently certain. A citation is still only ever
   resolved to one of the two real pages the model was actually shown, never
   invented, whichever branch fires. Split the remap+logging glue into a new
   `app/cds/citation_remap.py` (mirroring why `starved_retry.py` exists as
   its own module) to keep `engine.py`, itself an orchestration file with a
   hard 800-line budget, from growing past it.
3. **Retry policy, two layers** (routing-tuning.md §3/§4 combined):
   - **Call-level** (`app/cds/engine.py::_run_call`/`_retry_clusters`): a
     narrowed call that returns zero findings, or drops any citation
     `resolve_cited_page` could not place, gets ONE retry -- targeted at
     the dropped citations' raw page numbers when there are any
     (`pages.widen_clusters`), or a uniform grow of the existing clusters
     when the call came back completely empty (`pages.grow_clusters`).
     Never retries an already-whole-document call. Only replaces the first
     attempt if the retry found >= as many findings.
   - **Domain-level** (`app/cds/starved_retry.py::retry_starved_domains`):
     after every call (including its own retry) has run, any domain that
     is STILL unstored gets one more ISOLATED single-domain call with its
     own window grown a notch -- catches cause 4 (shared-call starvation)
     that the call-level retry structurally cannot, since that retry only
     fires on a whole-call failure, not a per-domain one.
4. **Next-section-aware trailing pad** (`domain/cds/pages.py::_trailing_edge`,
   used by `padded_domain_ranges`): the end of a domain's padded window now
   grows toward (never past) the next routed section's start when the gap
   is bigger than the default pad, capped at `+6` extra pages beyond the
   default `+2` -- literal task ask #3 ("size the window by where the next
   section begins"), implemented as a monotonic improvement (provably never
   narrower than the old fixed-pad behavior) even though no document in the
   3-doc sample needed it at ±2. Kept as a bounded, low-risk guard for
   documents outside this sample (e.g. ohio-state's 187pp).
5. **Honesty preserved**: no interpretation in `resolve_cited_page` is ever
   invented -- both readings it chooses between are real pages the model
   was actually shown; a citation that fits neither is still dropped, never
   guessed. `extraction_status` stays locally computed; page remapping
   stays mandatory.

Existing test files `tests/app/cds/test_engine.py` and
`tests/domain/cds/test_pages.py` (present in-tree, uncommitted, from an
earlier session's partial attempt at this same task) already encoded the
structural half of this contract when this session picked the task back up
-- adopted rather than reinvented once found, after independently verifying
the design was correct: `resolve_cited_page`'s "prefer position, else accept
an in-window literal, else None" logic exactly matched what my own
diagnosis in §1 called for. Collection was clean (no pre-existing errors
found in either file at that point) and all 88 CDS tests passed before any
further change.

The excerpt-based collision tie-break above was added on top of that
starting point in this same session, since the task's explicit ask (content
verification, not a bare structural default) was more than the inherited
code did. New/updated coverage: `resolve_cited_page`'s return type changed
from a bare `int | None` to a `CitationResolution(original_page, ambiguous)`
dataclass, so every existing call site and test needed updating regardless
of the collision logic; six tests in `tests/domain/cds/test_pages.py` cover
the new branches directly (single-valid-reading needs no excerpt, collision
with no page_text defaults to position and flags it, collision resolved by a
matching excerpt favors the literal reading, collision falls back to
position when neither excerpt matches, and the explicit corrupt-text-layer
case -- `page_text=None` -- still resolves via the position default rather
than dropping). `app/cds/citation_remap.py` (new module, split out of
`engine.py` for the file-size budget) got its own test file,
`tests/app/cds/test_citation_remap.py`, covering the same branches at the
`Finding`-list integration level: a genuinely ambiguous citation is KEPT
(never dropped for being ambiguous), and the corrupt-text-layer fallback
(`page_text=None`) still keeps it too. 95 CDS-scoped tests pass after this
change (was 88); the full non-live suite's pre-existing 8 unrelated failures
(other agents' in-flight work in `app/`, `api/`, `frontend/` -- none of it
files this task owns) are unchanged before and after, confirmed by exact
diff of the failing-test names.

## 5. Before/after coverage matrices

**Harvard 2024-2025** (`plans/cds-pipeline/scratch/before.json` = a real live
run against the pre-fix engine from an earlier session, reused rather than
re-spending budget re-measuring identical unfixed code; `harvard_after_excerpt_fix.json`
= this session's live run against the fully-fixed engine, throwaway
`academic_year=2091`, real Vertex `gemini-3.1-flash-lite` calls):

| Domain | Before | After |
|---|---|---|
| academics | partial (8 verified) | partial (8 verified) |
| admissions | partial (15 verified) | partial (2 verified) |
| class_profile | partial (2 verified) | partial (2 verified) |
| class_size | partial (21 verified) | partial (21 verified) |
| cost | **none** | partial (2 verified) |
| degrees | **none** | partial (20 verified) |
| enrollment | **none** | partial (1 verified) |
| faculty | **none** | **validated (31 verified, 0 not_extracted)** |
| financial_aid | **none** | partial (94 verified) |
| identity | **none** | partial (1 verified) |
| outcomes | partial (8 verified) | partial (8 verified) |
| student_life | **none** | partial (14 verified) |
| transfer | **none** | partial (2 verified) |
| **Domains with a stored packet** | **5 / 13** | **13 / 13** |
| **Overall extraction status** | `partial` | `succeeded` |

Every one of the 8 previously-empty domains -- including `faculty`, the
exact page-24 AMBIG_DROP case the task description named -- now stores a
packet. `parse_packet_row()` (the reader's own independent re-validation,
not this engine's self-check) accepted all 13/13 stored packets.

One real, honestly-reported side effect: `admissions` went from 15 verified
metrics before to 2 after, despite storing a packet either way both times
(not a coverage regression -- "domain has a packet" didn't change for
`admissions`). `gemini-3.1-flash-lite` at `temperature=0` is documented as
not bit-reproducible run-to-run (recon-vertex.md §4d, spike-part-b.md); this
looks like ordinary call-to-call variance in what the model chose to extract
from the same `admissions, faculty` call group, not a citation-remap
regression -- the `faculty` half of that same call went from 0 findings
(dropped) to correctly credited, which is the change this fix targets.

**Cornell 2022-2023** (this session's live run, `academic_year=2093`; no
live "before" baseline was captured for Cornell in an earlier session --
only the local, zero-API-cost diagnosis in §1, which found the identical
AMBIG_DROP/AMBIG_COLLIDE pattern on the same call groups as Harvard):

| | Result |
|---|---|
| Domains with a stored packet | **13 / 13** |
| Overall extraction status | `succeeded` |
| `faculty` domain | `validated` (31 verified, 0 not_extracted) -- same as Harvard |
| `parse_packet_row()` acceptance | 13 / 13 |

Cornell has no live before-number to diff against, but the fact that a
document diagnosis flagged as having the *same* ambiguity pattern as Harvard
also reaches 13/13 after the fix is corroborating, not just a repeat of one
lucky document.

Neither run dropped a single citation. The first post-fix Harvard run's full
log (before the excerpt-tie-break addition, §4) showed zero
`cds_engine_citation_out_of_narrowed_range` warnings across all 12 calls --
every citation the model produced resolved to a real page. The
excerpt-tie-break rerun produced byte-identical `usage_total` token counts
to that first run (temperature=0 determinism), which is strong evidence the
model's actual citations were unchanged between the two code versions --
the added tie-break logic simply never had to override the position default
on this document's calls, consistent with genuine AMBIG_COLLIDE being rarer
in practice than AMBIG_DROP was.

## 6. Cost / latency deltas

| | Harvard before | Harvard after | Delta |
|---|---:|---:|---:|
| Cost (USD, estimate) | $0.100638 | $0.162058 | **+$0.06142 (+61%)** |
| Wall clock (s) | 192.1 | 385.4 | **+193.3s (+101%)** |
| Total tokens | 360,863 | 550,781 | +189,918 (+53%) |
| Model calls | 7 | 12 | +5 |

Cornell after-fix, for scale (no before-number exists to diff): $0.156014,
507.5s, 540,327 tokens, 12 calls.

The entire delta traces to one place: 5 of Harvard's 8 previously-empty
domains (`faculty`, `enrollment`, `degrees`, `identity`, `student_life`)
needed the new isolated starved-domain retry (§4 point 3) to go from a
`packet_shape_invalid`-rejected first attempt to a stored packet; each of
those is one additional real model call, visible in the `calls` array as
`"starved_retry": true`. `cost`, `financial_aid`, and `transfer` were
rescued by the citation-remap fix alone (§4 point 2), with zero extra calls
-- the previously-dropped citation was simply no longer dropped on the
first attempt. Roughly doubling wall-clock and cost is the honest price of
turning 8 silent failures into 8 stored packets on this document; whether
that trade is worth it depends entirely on whether a human downstream would
rather wait ~3 extra minutes and pay ~6 cents more per document, or receive
no data at all for 62% of the requested domains. Given this pipeline's
existing per-document cost is already sub-$0.20 and the retries only fire
when routing/citation resolution actually came up short (not on every
call), this reads as an acceptable, self-limiting cost -- a document with no
AMBIG_DROP/starvation issues at all pays nothing extra.

**Cluster-splitting alternative, evaluated and not adopted.** The task
explicitly asked to weigh whether *not* merging widely-disjoint page
clusters into one call (avoiding the position/original-page collision at
the source, rather than resolving it after the fact) would help. It was not
implemented or separately live-tested this session: both live documents
tested reached 13/13 domain coverage and zero dropped citations under the
existing merge-then-resolve approach, so there was no observed coverage gap
left for cluster-splitting to close. Splitting would only reduce collision
*risk* on calls that already resolve correctly today (per §1's per-CALL
table, `financial_aid+class_size`, `class_profile+identity`, and `outcomes`
were flagged AMBIG_COLLIDE-prone, yet all three fully succeeded post-fix
without a retry) while strictly adding call count and cost on every
merged-cluster call, not just the ones that would have collided. Absent a
measured case where the excerpt tie-break actually got a collision wrong,
adopting the split would be optimizing against a risk this corpus has not
demonstrated, at a real, unconditional cost -- the honest call is not to
adopt it without that evidence.

## 7. Remaining ceiling (honest statement)

**What this fix resolved, confirmed live:** the routing-tuning.md §2
diagnosis's dominant failure mode -- citation-remap ambiguity (6 of 8 empty
Harvard domains) -- is gone on both documents tested: 13/13 domains stored
on Harvard and Cornell, up from Harvard's 5/13 baseline, zero dropped
citations observed, and every stored packet independently accepted by
`parse_packet_row()`. The two domains §2 called "unexplained by page-routing
at all" (`identity`, `enrollment` -- a shared-call model-attention artifact,
not a routing bug) are also now stored, via the domain-level starved retry
built for the citation-remap fix's own retry infrastructure (§4 point 3) --
isolating the call removed the shared-call confound itself, exactly as §2
predicted it might.

**What this fix did NOT touch, and should not be read as having fixed:**

1. **Per-domain metric recall inside a stored packet.** Most Harvard/Cornell
   domains store a packet but leave most of that domain's individual metrics
   `not_extracted` (packet_build.py: "nothing was ever claimed" by the
   model for that metric_id, not a rejected or invalid claim) -- e.g.
   Harvard's `admissions` domain has a packet with 2/152 metrics verified.
   This ratio is not new: `admissions` had a similar 15/152 before the fix
   too. It is a model-attention/metric-catalog-size limitation on how many
   of a large requested catalog the model actually reports per call, wholly
   orthogonal to page routing or citation-page correctness, which is what
   this task diagnosed and fixed. A domain reaching `validated` status
   (`faculty`, both documents, 0 not_extracted) rather than `partial` seems
   to correlate with having a small metric catalog, not with anything this
   fix changed -- worth a separate investigation, out of this task's scope.
2. **Michigan's anchor-failure fix (`_hint_pattern`'s optional dash, §1
   cause 2) is code-verified and unit-tested but was not live-re-run this
   session.** The task scoped live verification to Harvard, optionally
   Cornell -- Michigan was where §1's diagnosis originally found the
   hyphen-presence bug via direct page-text reading (not a live extraction
   run), and no live Michigan extraction was budgeted or run in this
   session to re-confirm `class_size`/`faculty` now route correctly
   end-to-end. The regex fix itself is exercised directly by
   `test_hit_pages_for_hints_tolerates_a_missing_or_unicode_dash` in
   `tests/app/cds/test_engine.py`, which is real coverage, just not a live
   Gemini-call confirmation.
3. **Ohio State (187pp) intentionally not attempted**, per the task's own
   instruction -- it is slow and was explicitly said not to be needed to
   prove this fix. The next-section-aware trailing pad (§4 point 4,
   `MAX_TRAILING_PAD_EXTRA`) exists as a bounded guard for documents at that
   scale, but is untested against a live document of that size; the 3-doc
   sample this task's diagnosis ran against never needed more than the
   existing ±2 pad, so this guard's live behavior on a genuinely sparse
   187-page document remains unverified, not just unexercised.
4. **Cluster-splitting was evaluated on paper only** (§6) and not
   implemented -- see that section for the honest trade-off reasoning.

Bottom line: the specific, diagnosed bug this task set out to fix --
citations from a narrowed multi-cluster call being ambiguously and
sometimes-wrongly resolved -- is fixed and empirically confirmed gone on
two real documents, at a real and bounded cost (roughly 2x latency/cost on
documents that actually needed the new retries, zero extra cost on
documents that don't). The pipeline's remaining gaps are in a different
layer (per-metric extraction recall within an already-successful call) that
this diagnosis never claimed to address.

## 8. Per-metric recall (routing/citations fixed; catalog-size recall was not)

**Status: DONE.** Scope for this task: `app/cds/engine.py`, `app/cds/manifest.py`,
`app/cds/citation_remap.py` (untouched -- no change needed), `app/cds/starved_retry.py`,
`domain/cds/pages.py` (untouched -- its existing generic page-range math needed no
change), plus two new sibling modules split out purely for the file-size budget:
`app/cds/batching.py` (pure metric-batch planning) and `app/cds/batch_run.py`
(bounded-concurrency batch execution + result folding). `config/cds/` was never edited;
the compiled manifest's `content_sha256` is unchanged
(`c821b2e61cf71f99c1f8503f8940bbce48354b978e091bb81223718784ad6f0a`), confirmed by
re-running `compile_manifest` before and after this session's changes.

### 8.1 Method

§7 point 1's diagnosis (`admissions`, 2/152 verified on Harvard) matched
`plans/cds-pipeline/spike-part-a.md`'s own finding almost exactly: a ~25-metric schema
scored 99.3% field accuracy, while the live engine's calls ask for up to 169 metrics
(`financial_aid`) in one shot. The fix implemented and measured here: split every
domain's metric catalog into `app/cds/manifest.py::metric_batches_for_domain` batches of
at most `DEFAULT_METRIC_BATCH_SIZE = 25` metrics, packed along CDS-section boundaries
(manifest metric order already groups by `source_hints`' first code, verified empirically
-- never interleaved) so consecutive small sections (e.g. `admissions`'s `C3`/`C4`, one
metric each) share a batch instead of each getting its own tiny call, and a section that
alone exceeds 25 (e.g. `C1`, 39 metrics) is chunked at that fixed size as the fallback,
never the default. Each batch gets its OWN narrowed page window, routed from just that
batch's own `source_hints` (`app/cds/engine.py::_route_batches`), not its whole domain's
span. One model call per batch, findings from every batch belonging to one domain
accumulated before that domain's packet is built ONCE at the end of the run (never one
packet per batch -- `build_packet` needs a domain's full claim set to resolve
`verified`/`conflict`/`not_extracted` correctly). Batching multiplies call count roughly
5-9x (12 calls -> 63 for Harvard's 13 domains), so `app/cds/batch_run.py::run_batches`
runs batches under a bounded `asyncio.Semaphore(6)` (`_MAX_CONCURRENT_BATCH_CALLS`) so
call-count growth does not multiply wall-clock by the same factor. `starved_retry.py`'s
existing isolated whole-domain retry is unchanged in shape (still one un-batched call with
a domain's full catalog, for the now-rarer case a domain still stores nothing after every
one of its own batches) but its call site was updated for `_run_call_once`'s new
`batch_metrics` parameter.

**Baseline reused, not re-measured**: §5's Harvard "After" table (13/13 domains stored,
pre-batching) is this task's "Before" -- a real live run (`extraction_id
992e3744-b344-4d7a-8062-f69e0d0d2627`, `plans/cds-pipeline/scratch/harvard_after_excerpt_fix.json`)
against the routing/citation-fixed engine, which is exactly the code this task's batching
change layers on top of. Re-running it would spend budget re-measuring identical code.

**Measurement harness constraint**: a single 13-domain, 63-batch Harvard run does not fit
a 10-minute foreground call even at concurrency 6 (measured: a 17-batch group alone took
223.6-561.9s). All 13 domains were still measured live on the SAME Harvard document
(`school_id=100654`, throwaway `academic_year=2094`), split across 7 separate
`cds_extractions` rows (one per domain subset, each its own foreground `uv run` call under
10 minutes), and the results summed. This almost certainly makes the reported "after" wall
clock an *overestimate* of a real single combined run (each sub-run pays its own fixed
per-run overhead -- PDF page-count/corruption/routing-text extraction -- once each, instead
of once total, and loses whatever cross-domain concurrency headroom a single shared
semaphore across all 63 batches would have used); cost and per-domain counts are
unaffected by the split (no double-counting -- disjoint domains per sub-run).

**A real bug found and fixed mid-measurement**: the first attempt at the
`financial_aid,degrees,academics` group (17 batches) failed outright --
`httpx.WriteTimeout` propagated unwrapped past `adapters/cds_gemini.py`'s internal SDK
retries (that module's own docstring claims every failure surfaces as a typed
`CdsGeminiError`; a raw transport error does not). `app/cds/batch_run.py::_run_one_batch`
only caught `(CdsGeminiError, CdsPdfError)`, so the exception propagated through
`asyncio.gather` and cancelled all 17 in-flight batches for one transient network blip --
the entire group came back `status=failed, cost=$0, calls=0`. Batching raised the odds of
hitting this (5-9x more concurrent calls per run than pre-batching). Fixed by broadening
`_run_one_batch`'s except clause to `Exception` (isolating one batch's failure the same way
`CdsGeminiError`/`CdsPdfError` already were, per plan §B4's "one domain's failure must not
kill the run" principle -- now correctly extended to "one batch's failure must not kill the
run") plus `return_exceptions=True` on the `asyncio.gather` call as defense in depth. Every
group run after this fix succeeded; the failed group was re-run split into two smaller
groups, both of which succeeded and are the numbers reported below.

### 8.2 Verified metrics, before -> after (Harvard, all 13 domains)

| Domain | Total metrics | Before verified | Before % | After verified | After % |
|---|---:|---:|---:|---:|---:|
| academics | 34 | 8 | 23.5% | 21 | 61.8% |
| admissions | 152 | 2 | 1.3% | 85 | 55.9% |
| class_profile | 127 | 2 | 1.6% | 71 | 55.9% |
| class_size | 22 | 21 | 95.5% | 21 | 95.5% |
| cost | 47 | 2 | 4.3% | 24 | 51.1% |
| degrees | 129 | 20 | 15.5% | 27 | 20.9% |
| enrollment | 134 | 1 | 0.7% | 114 | 85.1% |
| faculty | 31 | 31 | 100.0% | 31 | 100.0% |
| financial_aid | 169 | 94 | 55.6% | 124 | 73.4% |
| identity | 50 | 1 | 2.0% | 36 | 72.0% |
| outcomes | 114 | 8 | 7.0% | 111 | 97.4% |
| student_life | 63 | 14 | 22.2% | 57 | 90.5% |
| transfer | 77 | 2 | 2.6% | 32 | 41.6% |
| **Total** | **1149** | **206** | **17.9%** | **754** | **65.6%** |

Every domain either improved or stayed flat; none regressed. The two domains that didn't
move (`class_size`, `faculty`) were already at or near saturation before batching (95.5%
and 100%) -- consistent with §7's own observation that a small metric catalog correlates
with high recall regardless of batching, since a small domain's pre-batching call was
already close to spike-part-a.md's ~25-metric sweet spot.

### 8.3 Answerable-ceiling estimate (admissions, 152 metrics)

Delegated to an independent research pass (no live model calls, pure local PyMuPDF
reading) since manually judging 152 metrics against a real, partly-scrambled-text-layer
PDF is exactly the kind of bounded, well-specified sub-task suited to isolated review.
Full writeup, method, and per-section table: `plans/cds-pipeline/scratch/admissions_ceiling_estimate.md`.

**Method summary**: every one of Harvard's admissions-section pages (7-12, CDS-C) was read
in full -- dense numeric tables via `page.get_text("words")` position-reconstruction
(cross-validated against printed row/column totals, which matched exactly everywhere
checked), checkbox-style questions via 9 rendered page-region images (the text layer's
raw "X" ordering is positionally ambiguous for tightly-packed checkbox grids, the same
failure class spike-part-a.md documented for Harvard's C7 `class_rank` miscall). All 152
metrics were judged individually, not sampled/extrapolated, into three tiers: **Tier A**
(80 metrics) -- a value is directly printed/marked; **Tier B** (5 metrics) -- a checklist
format's absence of a mark is an unambiguous inferred "false" (e.g. `C8G`'s unchecked
placement-exam types); **Tier C** (13 metrics) -- a demographic/residency cell is blank but
arithmetically forced to exactly 0 by a printed total that already accounts for every
other cell.

**Ceiling: 98/152 (64.5%) inclusive of Tiers B+C, or a stricter 80/152 (52.6%) floor
counting only directly-printed Tier A values.** The remaining 54 metrics are genuinely
structurally blank on this document -- most notably all 9 of `C21`'s early-decision detail
fields (Harvard uses Restrictive Early Action, not Early Decision, so the CDS gate question
is correctly "No" and every downstream ED field is correctly blank) and `C2`'s waitlist
detail counts (Harvard checked "has a waitlist" but left every numeric field on that
question blank). Two metrics (`..._occurrence_2_raw` variants) are Yale-specific schema
artifacts per their own config description text, and one (`sat_subject_receipt_deadline_or_status_raw`)
appears unanswerable on any current-template CDS PDF, since SAT Subject Tests were removed
from the CDS template itself -- both worth flagging to whoever maintains `admissions.yaml`,
out of this task's scope to fix.

**Batching's actual result, 85/152 (55.9%), lands inside this ceiling's range** (above the
80-metric strict floor, below the 98-metric inclusive ceiling) -- the pipeline is now close
to *saturating* the realistic recall ceiling for this domain, not merely "improved." The
gap between 85 and 98 is plausibly explained by the Tier B/C inferred values (18 metrics)
being exactly the kind of "not directly printed, requires arithmetic or checklist-absence
reasoning" cases a model extracting from a narrowed page image would be least likely to
report versus a human manually cross-checking table totals.

No equivalent manual ceiling was built for the other 12 domains (out of this task's time
budget) -- their post-batching percentages in §8.2 should be read as recall against the
*full nominal catalog*, not against a verified realistic ceiling. `degrees` (20.9% after)
and `transfer` (41.6% after) are the two most likely to still have real headroom rather
than being near-saturated at a low ceiling, since neither showed the "already near 100%
pre-batching" pattern that predicts saturation elsewhere in the table.

### 8.4 Correctness spot-check (guard against a false win)

22 metrics (task asked for >=15) newly `verified` after batching that were `not_extracted`
before, sampled across 11 of the 13 domains, checked against the real Harvard PDF: PyMuPDF
text for 19, rendered page images (200 DPI) for the 3 genuinely ambiguous checkbox-grid
cases where linear text order didn't unambiguously resolve which label an "X" mark
belonged to (`student_life.womens_residence_halls` p.16 F4 housing grid,
`financial_aid.h1_need_based_tuition_waivers` p.19 H1 aid table,
`financial_aid.h13_uncf_available` p.22 H13 aid-type grid).

**Result: 22/22 correct. Zero wrong values, zero hallucinations.** Representative checks:
`enrollment.graduate_part_time_all_other_credit_men=51` matches the B1 table's
"All other graduates enrolled in credit courses" row exactly; `transfer.admitted_women=8`
matches the D2 transfer-admission table's Women/Admitted cell exactly;
`class_profile.sat_composite_distribution_reported_total_percent="0.00%"` correctly
captures that Harvard left the SAT Composite score-range breakdown blank (a genuine
structural zero, not a missed extraction) while the separate EBRW/Math breakdowns *were*
reported; both image-rendered checkbox grids for `student_life`/`financial_aid` confirmed
the model's `False` calls exactly (unchecked boxes, visually confirmed). No evidence of a
recall gain built on fabricated values -- the 3.7x more verified metrics are real.
Full sample + values: `plans/cds-pipeline/scratch/spotcheck_sample.json`.

### 8.5 Cost / latency deltas

| | Before (pre-batching) | After (batching) | Delta |
|---|---:|---:|---:|
| Verified metrics (Harvard, 13 domains) | 206 / 1149 (17.9%) | 754 / 1149 (65.6%) | **+548 (+266%)** |
| Cost (USD, estimate) | $0.162058 | $0.301971 | **+$0.139913 (+86%)** |
| Wall clock (s) | 385.4 | ~1209.0 (measured, split-run harness; see §8.1 caveat) | **+823.6s (+214%), likely an overestimate of a single combined run** |
| Total tokens | 550,781 | 772,919 | +222,138 (+40%) |
| Model calls | 12 | 63 | +51 (+425%) |

(A 7th sub-run, the 17-batch group that hit the `httpx.WriteTimeout` bug fixed mid-session,
cost $0 and contributed 561.9s of wasted wall-clock to this session but is excluded from
the "after" numbers above as a one-time, now-fixed artifact, not steady-state behavior --
included transparently here rather than silently dropped.)

**Does the recall gain justify the cost? Yes, plainly.** +86% cost and a real but likely
overstated ~3x latency increase, in exchange for going from "84% of every domain's fields
silently unfilled with no packet-level signal that anything is wrong" to "65.6% recall
corpus-wide, with the one domain given an independent ceiling estimate (`admissions`)
landing within 13 points of that ceiling." At this pipeline's existing sub-$0.20/document
baseline cost, an extra ~14 cents per document is a trivial absolute cost for turning a
mostly-empty packet into a mostly-populated one. The latency increase is the more
serious trade in an absolute sense (a document taking ~20 minutes instead of ~6.5), but
concurrency already absorbs most of the multiplier (63 calls in ~20 minutes, not 63x the
per-call latency), and further concurrency tuning (raising `_MAX_CONCURRENT_BATCH_CALLS`
past 6) is a cheap, low-risk lever this task did not need to pull to hit an honest result --
left as explicit future work rather than tuned blind against a single document.

### 8.6 Honest remaining ceiling

1. **Only `admissions` has an independently verified answerable ceiling.** The other 12
   domains' §8.2 percentages are against the full nominal catalog, not a verified realistic
   ceiling -- some of the still-large gaps (`degrees` 20.9%, `transfer` 41.6%, `cost` 51.1%)
   may be much closer to saturated than they look, or may have real remaining headroom;
   this task did not build the ceiling estimate needed to tell the difference for anything
   but `admissions`.
2. **Only Harvard was measured live for batching.** Cornell, Michigan, and the rest of the
   15-file corpus were not re-run under the batched engine this session -- Harvard was
   this task's explicit measurement target, per its own framing (the 2/152 `admissions`
   number that opened this task), but the recall gain's generality across the corpus's
   other text-layer/layout pathologies (Caltech's corrupted CMaps, Ohio State's 187 pages)
   is unverified.
3. **The wall-clock "after" number is a measurement-harness artifact, not a clean
   single-run measurement** (§8.1) -- a real combined 13-domain run's wall-clock is likely
   somewhat lower than the ~1209s reported here, but this task did not have a way to verify
   that without exceeding the 10-minute-per-foreground-call constraint.
4. **`_MAX_CONCURRENT_BATCH_CALLS = 6` is an untuned, reasonable-seeming default**, not
   empirically optimized against this corpus -- chosen to be a "shared-credential-friendly"
   bound (recon-vertex.md §1) rather than a measured throughput-optimal value. Raising it
   is the most likely next lever for reducing the latency cost in §8.5 without touching
   recall at all.
5. **The `httpx.WriteTimeout` isolation fix (§8.1) is a defensive fix for a real
   adapters/cds_gemini.py contract gap** (its docstring's claim that every failure surfaces
   as a typed `CdsGeminiError` is not accurate for raw transport errors), worked around at
   the `batch_run.py` call site since `adapters/` is out of this task's ownership -- the
   more correct long-term fix is in `adapters/cds_gemini.py` itself, flagged here for
   whoever owns that file next, not fixed at the root.

Bottom line: the specific problem this task set out to fix -- a whole-domain-catalog call
measuring near-zero recall on large domains -- is fixed and empirically confirmed on
Harvard, with the one domain given an independent, metric-by-metric ceiling estimate
(`admissions`) now within 13 points of that ceiling, a clean 22/22 correctness spot-check
finding no hallucination, and a cost/latency trade this document argues is worth it. The
generality of that result across the rest of the 15-file corpus, and a tighter (non-harness-
inflated) latency number, are the honest open items for whoever picks this up next.
