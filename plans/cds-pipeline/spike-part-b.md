# Spike Part B — E4 (C7 checkbox strategy matrix) and E3 (whole-vs-narrowed)

Real Vertex `gemini-3.1-flash-lite` calls (`temperature=0`, `response_schema`, native
inline PDF / PNG via `Part.from_bytes`), against `artifacts/cds-corpus/`. All scripts,
raw call results, and ground truth live under `artifacts/spike/partb/` (a private copy
of the shared scripts in `artifacts/spike/scripts/`, adapted but not editing the
originals — those belong to spike part A, running concurrently). Scoring code:
`artifacts/spike/partb/scripts/score_e4.py`, `score_e3.py`. Raw scored output:
`artifacts/spike/partb/results/e4_scored.json`, `e3_scored.json`.

**Budget discipline**: 7 page images viewed total (one C7 page per file, at 200 DPI,
to build ground truth by hand) — well under the 12-image cap. Every API call's result
was written to disk immediately after it returned; no batching of results in memory.

---

## E4 — C7 checkbox-grid strategy matrix

### Setup

7 files spanning recon-cds-corpus.md §4's three classes, 2+ per class:

| Class | Files |
|---|---|
| (a) text answer | `michigan_2024-2025`, `ucf_2023-2024` |
| (b) X-marker, column lost in linear text | `cornell_2022-2023`, `harvard_2024-2025` |
| (c) no textual mark at all | `caltech_2024-2025`, `cmu_2024-2025`, `ohio-state_2024-2025` |

For each file, the C7 page was located by regex (`^C7\b`) and I personally viewed the
rendered page (200 DPI PNG, `artifacts/spike/partb/images/*_gt.png`) to build an 8-factor
ground-truth answer key (`artifacts/spike/partb/ground_truth/c7_ground_truth.json`) —
the same 8-row subset already defined in the shared `schema_c7.py`
(rigor/class-rank/GPA/tests/essay/recommendations/interview/extracurriculars).

4 strategies × 7 files = 28 calls, via `run_e4_matrix.py`:
1. **`native_whole`** — entire original PDF inlined as `application/pdf`
2. **`native_narrowed`** — a 1-page sub-PDF containing *only* the C7 page, inlined
3. **`image_150dpi`** — the C7 page rendered to PNG at 150 DPI
4. **`image_300dpi`** — the C7 page rendered to PNG at 300 DPI

### Accuracy × strategy × class matrix

8 factors per file scored exact-match against the hand-built ground truth.

| File | Class | native_whole | native_narrowed | image_150dpi | image_300dpi |
|---|---|---|---|---|---|
| michigan_2024-2025 | a | *(failed — see reliability)* | 100% | 100% | 100% |
| ucf_2023-2024 | a | 100% | 100% | 100% | 100% |
| cornell_2022-2023 | b | 100% | 100% | 100% | 100% |
| harvard_2024-2025 | b | **87.5%** (1 wrong) | **87.5%** (1 wrong) | 100% | 100% |
| caltech_2024-2025 | c | 100% | 100% | 100% | 100% |
| cmu_2024-2025 | c | 100% | 100% | 100% | 100% |
| ohio-state_2024-2025 | c | *(failed — see reliability)* | 100% | 100% | 100% |
| **Class-average accuracy** | | | | | |
| class a | | 100%* | 100% | 100% | 100% |
| class b | | 93.75% | 93.75% | 100% | 100% |
| class c | | 100%* | 100% | 100% | 100% |

\* Class a/c native_whole averages exclude the files where the call never returned a
result (see Reliability below) — not a 0%, an unmeasured cell.

**The one real mismatch**: Harvard's `class_rank` row has its X in the "Not Considered"
column, but both native-PDF strategies (whole and narrowed) mapped it to "Considered"
instead — i.e. exactly the column-position-confusion failure recon predicted for class
(b) files, reproduced live. The two rasterized-image strategies got it right. This is
the single clean data point in the whole matrix where format choice changed the answer.
Everything else in class (b) (Cornell, and Harvard's other 7 rows) came back correct on
every strategy, so "column lost" is a real but *partial* failure mode for native PDF on
this class, not a total one.

**The surprising negative result — class (c) does NOT need images.** Recon's hypothesis
was that class (c) ("no textual mark at all," e.g. Caltech's vector-checkbox glyphs)
would be "a hard requirement for vision-model... input." That did not hold: `native_whole`
and `native_narrowed` both scored 100% on all 3 class-(c) files. The likely reason (per
recon-vertex.md §4e): Gemini tokenizes every PDF page as an image tile internally
(~258 tokens/page) regardless of whether PyMuPDF's text layer can extract a checkbox
glyph — sending the native PDF *already* gives the model a visual read of the page. A
separate rasterize-to-PNG code path is not required for correctness on this class; the
old pipeline's own note in recon-vertex.md ("native PDF vision already reads
checkbox/table content... worth validating on your own checkbox-grid pages before adding
an image path") is now validated, not just asserted.

### Cost / latency per strategy (n=5 or 7, averaged; `gemini-3.1-flash-lite` pricing)

| Strategy | avg input tokens | avg output tokens | avg wall-clock (s) | avg cost/call |
|---|---:|---:|---:|---:|
| `native_whole` (n=5, 2 files unmeasurable) | 20,884 | 431 | 106.1 | $0.00587 |
| `native_narrowed` (n=7) | 1,149 | 433 | 35.7 | $0.00094 |
| `image_150dpi` (n=7) | 1,717 | 433 | 20.7 | $0.00108 |
| `image_300dpi` (n=7) | 1,717 | 433 | 60.5 | $0.00108 |

Input-byte payload sizes (avg): `native_whole` 1.18 MB, `image_300dpi` 384 KB,
`native_narrowed` 329 KB, `image_150dpi` 186 KB.

Notable: 150 DPI and 300 DPI *token cost is identical* (1,717 in / 433 out — Gemini's
image tiling appears to bucket both resolutions into the same tile budget for a
single-page image), but 300 DPI takes ~3x longer wall-clock (60.5s vs 20.7s) for zero
accuracy benefit on this corpus. **150 DPI dominates 300 DPI on every axis measured here** —
same cost, same accuracy, less latency.

### Reliability — the more important finding than accuracy

`native_whole` failed outright (`httpx.WriteTimeout: The write operation timed out`,
after the SDK's own 3 internal retry attempts) for every file above ~2.1 MB, and
succeeded for every file at or below that size (after at most one retry, when several
large uploads ran concurrently):

| File | Size | `native_whole` attempts | Result |
|---|---:|---|---|
| harvard_2024-2025 | 0.50 MB | 1 | ok |
| cornell_2022-2023 | 0.72 MB | 1 | ok |
| ucf_2023-2024 | 0.72 MB | 1 | ok |
| cmu_2024-2025 | 1.83 MB | 2 (1st failed under concurrency) | ok |
| caltech_2024-2025 | 2.14 MB | 2 (1st failed under concurrency) | ok |
| michigan_2024-2025 | **4.81 MB** | **4, isolated** | **0/4 — never succeeded** |
| ohio-state_2024-2025 | **5.37 MB** | 2, isolated | **0/2 — never succeeded** |
| ohio-state_2023-2024 (E3, 187pp) | **4.90 MB** | 3, isolated | **0/3 — never succeeded** |

3 of the corpus's largest files (all ≥4.8 MB — coincidentally the entire ">4MB" tier of
this 15-file corpus) failed 100% of whole-document native-PDF upload attempts, including
fully-isolated retries with no other concurrent calls, across 9 total attempts. Every
other file succeeded, needing at most one retry when several large calls ran in
parallel. This reads as a real payload-size ceiling in this call path (`httpx`'s default
write-timeout on the multipart body), not sandbox flakiness — smaller files were
reliable even under the same concurrent load. **`native_narrowed` and both image
strategies never failed once, on any file, including the 3 that broke `native_whole`.**
This is the strongest single argument in this report for narrowing/rasterizing large
CDS PDFs before calling the model: for the largest ~20% of real CDS PDFs, whole-document
inlining is not just slower and pricier, it may not complete at all.

### C7 verdict

**Use `native_narrowed`** (the C7 page(s) cut into a 1-page sub-PDF and inlined) as the
default production strategy for C7, uniformly across all three classes — do not
special-case class (c) into a separate vision/rasterize path. It tied for best accuracy
(100% on 6/7 files, matching the image strategies), was the cheapest strategy measured
($0.00094/call, 6x cheaper than whole-document), and never failed. Reserve
`image_150dpi` as a **targeted fallback**, not a universal default: when a narrowed
native-PDF call's column-vs-mark mapping looks suspect for a class-(b)-shaped file (X
markers with header ambiguity — the one real failure mode observed, on Harvard), a
second call sending the same page as a 150 DPI PNG resolved it. 150 DPI, not 300 —
300 DPI cost the same tokens for 3x the latency with no accuracy gain on this corpus.
Never use `native_whole` for C7 specifically once the page is already known via routing
— it was both the most expensive strategy and the only one that failed outright on large
files, for no accuracy benefit over the narrowed 1-page call.

---

## E3 — whole-PDF vs page-narrowed, general case (~15–25 admissions metrics)

### Setup

4 files via `run_e3.py`, each getting the shared 25-metric admissions payload
(`metrics.py`, C1/C2/C7/C21) sent twice — once as the whole original PDF, once as a
page-narrowed sub-PDF built by regex-locating `C1/C2/C7/C21` section headers, padding
±2 pages, and merging into disjoint ranges (identical routing logic to spike part A's
E3 script, just re-implemented locally per the "don't edit part A's files" constraint):

- `dartmouth_2024-2025` (34pp, bare-code heading family)
- `florida_2023-2024` (37pp, Excel/Print-to-PDF sourced)
- `spelman_2023-2024` (57pp, Adobe-PDFMaker-for-Excel sourced)
- `ohio-state_2023-2024` (**187pp**, the corpus's largest/most pathological file)

### Cost / latency / narrowing ratio

| File | whole in/out tok | whole cost | whole sec | narrowed in/out tok | narrowed cost | narrowed sec | pages kept |
|---|---|---:|---:|---|---:|---:|---|
| dartmouth_2024-2025 | 20,996 / 1,838 | $0.00801 | 94.7 | 8,111 / 1,868 | $0.00483 | 73.4 | 9/34 (26%) |
| florida_2023-2024 | 22,556 / 1,436 | $0.00779 | 95.2 | 9,175 / 1,457 | $0.00448 | 95.3 | 11/37 (30%) |
| spelman_2023-2024 | 32,956 / 1,447 | $0.01041 | 90.5 | 9,708 / 1,394 | $0.00452 | 79.4 | 12/57 (21%) |
| ohio-state_2023-2024 | **FAILED — 3/3 attempts** | — | — | 10,242 / 1,645 | $0.00503 | 95.3 | 13/187 (7%) |

Narrowing cut input tokens 40–70% and cost 40–57% on the 3 files where whole-document
succeeded at all. On the 187-page file, narrowing wasn't just cheaper — **it was the
only strategy that produced a result.**

### Does narrowing pay for itself? Does it ever lose information?

**Findings count and metric coverage were identical between whole and narrowed on every
file** (25/25, 19/19, 19/19, and 21/21 respectively) — narrowing with a ±2-page pad
around every `C1/C2/C7/C21` hit did not cause any metric to silently disappear on these
4 files. The recon's worry about a value's supporting context living on an earlier,
un-narrowed page did not materialize here, at least at this pad width.

**Whole vs narrowed value agreement** (excluding pure formatting differences —
`"6,889"` vs `"6889"`, `"Very Important"` vs `"very_important"` — which account for most
of the raw disagreement rate below and are a prompt/schema-normalization issue, not an
extraction-accuracy one):

| File | Raw agreement | Real value disagreement (post-normalization) |
|---|---|---|
| dartmouth_2024-2025 | 100% (25/25) | none |
| florida_2023-2024 | 63.2% (12/19) | **2 real mismatches** (see below) — rest are formatting |
| spelman_2023-2024 | 42.1% (8/19) | 0 real mismatches — all 11 "disagreements" are formatting only |
| ohio-state_2023-2024 | n/a (whole failed) | n/a |

**A concrete, verified accuracy divergence (florida_2023-2024):** `enrolled_men` and
`enrolled_women`. The C1/C2 page for this file is Excel-sourced and shows recon's
"scrambled block" pathology (numbers in one disconnected block, labels in another,
reading order not matching visual order — the same failure family documented for
Cornell/Harvard). Florida's C1 table prints full-time and part-time enrolled counts as
*separate, unlabeled-by-column* numbers (`2,826` full-time men, `19` part-time men;
`3,900` full-time women, `17` part-time women) with no single printed cell for the
combined "enrolled full- or part-time" total the metric definition asks for. The
**whole-document call reported only the full-time component** (`enrolled_men: "2,826"`,
`enrolled_women: "3,900"`) — silently dropping the part-time students despite the
metric instructions saying "enrolled full- or part-time." **The narrowed call summed
both components** (`enrolled_men: "2845"` = 2,826+19, `enrolled_women: "3917"` =
3,900+17) — arithmetically correct per the metric's own definition, though technically
in tension with the extraction system prompt's separate "do not sum or derive one row
from others" instruction. Verified directly against the source PDF text (page 8 of
`florida_2023-2024.pdf`). **This is the one case in this spike where narrowing produced
a *more* correct answer than whole-document**, not a less correct one — the opposite of
the failure mode the task asked me to check for. I could not determine *why* narrowing
changed this specific behavior (same model, same temperature, same prompt); it may be
noise (Gemini is not bit-reproducible even at `temperature=0`, per recon-vertex.md §4d)
rather than a structural narrowing effect — flagging as observed-but-not-explained.

### Citation remapping — broken on every file tested, systematically

**This is the headline finding of E3.** The narrowed-call prompt explicitly supplies a
position→original-page remap table (`"position 3 = original page 7"`, etc.) and
instructs the model to cite the *original* physical page number. On every one of the 4
files, the model overwhelmingly ignored this and returned the sub-PDF *position* instead:

| File | Citations matching a valid *original* page | Citations that are actually the sub-PDF *position* |
|---|---|---|
| dartmouth_2024-2025 | 4/25 (16%) | 21/25 (84%) |
| florida_2023-2024 | 1/19 (5%) | 18/19 (95%) |
| spelman_2023-2024 | 4/19 (21%) | 15/19 (79%) |
| ohio-state_2023-2024 | 0/21 (0%) | 21/21 (100%) |

Verified concretely on Dartmouth: the page map was `{1:5, 2:6, 3:7, 4:8, ..., 7:11,
..., 9:13}`. Every C1/C2 finding cited `page_number: 3` (the sub-PDF position) when the
correct original page was 7; every C7 finding cited `4` instead of 8; every C21 (early
decision) finding cited `7` instead of the correct **11**. That last one is the
dangerous case: `page_number: 7` for a C21 finding is *not* out-of-range garbage — it's
a syntactically valid, plausible-looking page number that happens to be **wrong by 4**
and lands on unrelated page content, exactly the "looks plausible but is fabricated"
failure mode recon-cds-corpus.md warned about for silent corruption, now reproduced in
the citation layer instead of the value layer. A page-bounds check alone would not catch
this; it would need to specifically verify the excerpt text against the *cited* page's
actual content (which `verify_evidence.py`, part A's honesty gate, already does, and
would have flagged 4/4 of these files as failures).

**Root cause, and the fix:** the model is not unreliable at citing pages per se — it
appears to consistently report the position *within whatever PDF bytes it was actually
given*, ignoring an in-prompt instruction to translate that position through an external
table. That is a prompt-following failure, not a comprehension failure, and it is
consistent enough (>79% "looks like position" rate on every file, including 100% on
Ohio State) that **the fix is mechanical, not a better prompt**: since the
narrowing/routing code already possesses the exact `page_map` used to build the sub-PDF,
citation page numbers from narrowed calls must always be remapped locally
(`page_map[returned_page_number - 1]`) rather than trusted as already-correct — never
ship a narrowed-call code path that treats the model's `page_number` field as an
original physical page number without this deterministic remap step.

### E3 verdict

**Yes, narrowing pays for itself** — 40–57% lower cost, comparable-or-better accuracy on
this sample (one case of narrowing being *more* accurate on real Excel-scrambled data
tested; zero cases of narrowing losing metric coverage), and for the corpus's largest
file (187 pages / 4.9 MB) it is the difference between a working pipeline and a pipeline
that fails 100% of the time on that file's whole-document call. **But narrowing must
never trust the model's own `page_number` output as an original-document page number** —
across all 4 files and 85 total findings, only 9 (10.6%) cited the actual original page;
the rest cited the sub-PDF position instead, despite explicit in-prompt remap
instructions. Production narrowing must do the position→original remap deterministically
downstream using the `page_map` the narrowing code itself already built, exactly as
recon-old-pipeline.md's old pipeline apparently already assumed (`narrow_document()`/
`page_map` contract) — this spike is empirical confirmation that assumption is not just
good practice but load-bearing, since the model cannot be relied on to do it itself even
when told to.

---

## What I could not verify

- **The florida `enrolled_men`/`enrolled_women` divergence's root cause.** I confirmed
  *what* changed (whole reported full-time-only; narrowed reported the full+part-time
  sum) and verified both component numbers exist verbatim on the source page, but not
  *why* narrowing changed the model's summing behavior specifically — could be genuine
  narrowing-induced signal (less surrounding noise) or could be call-to-call stochastic
  variance at `temperature=0` (Gemini is documented as not bit-reproducible even at
  temperature 0, recon-vertex.md §4d). Re-running each call 2-3x to check consistency
  would resolve this but was out of scope for the time/budget available here.
- **Whether `ohio-state_2024-2025`'s `native_whole` C7 call (E4) would have succeeded on
  a later retry.** It failed on 2 isolated attempts (5.37 MB file); I did not attempt a
  3rd given the very strong corroborating evidence already gathered from Michigan (4/4
  failed, 4.81 MB) and Ohio State 2023-24 (3/3 failed, 4.90 MB) on the exact same
  ">4MB fails, ≤2.1MB succeeds" boundary. Treat the >4MB failure rate as "very high,
  observed consistently across 9 attempts on 3 different files" rather than
  mathematically proven at 100% for all time — this is one sandboxed environment's
  network behavior (`httpx.WriteTimeout` on the upload, not a Gemini API error code),
  and could differ in a production deployment with different network characteristics.
  It is still strong enough evidence to warrant designing production narrowing/chunking
  as a reliability requirement for large files, not just a cost optimization.
- **The exact byte/size threshold where `native_whole` starts failing.** I bracketed it
  between 2.14 MB (succeeded, with one retry) and 4.81 MB (0/4, never succeeded) but did
  not test intermediate sizes to find the actual boundary.
- **Whether a wider narrowing pad (more than ±2 pages) would change the citation-position
  bug's prevalence or the florida enrolled-count divergence.** Only the ±2-page pad from
  the existing routing logic was tested.
- I did not attempt Batch API or context-caching variants for either experiment — out of
  scope per the task brief, which asked about strategy/narrowing choice, not the
  scheduling layer.
