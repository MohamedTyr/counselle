# CDS PDF Corpus Recon

Evidence base for the new CDS extraction engine. 15 real Common Data Set PDFs from 14
distinct institutions (Amherst and Reed contributed a section-only PDF each, illustrating a
distinct *publishing shape* rather than a full document), downloaded 2026-08-18. All files
live in `artifacts/cds-corpus/` (gitignored); machine-readable version of this table is in
`artifacts/cds-corpus/inventory.json`. Raw per-file characterization dump is in
`artifacts/cds-corpus/characterization_raw.json`.

Tooling: `pymupdf` (`fitz`) via `uv run --with pymupdf python ...` — not added to
`pyproject.toml`, ad-hoc only for this recon.

## 1. Acquisition results

15/15 attempted-and-kept downloads succeeded (a few additional candidates were tried and
discarded — see "Acquisition failures" below). No school in this batch turned out to
require XLSX-only publishing, but **Purdue does publish an XLSX alongside/instead of a
stable PDF path** (`CDS_2023_2024.xlsx` found via search; the PDF URLs for Purdue we tried
all 404'd — their PDF links appear to rot/move faster than their XLSX). Worth remembering:
the engine's ingestion layer will eventually need an XLSX path for at least this case.

| # | Filename | School | Year | Pages | Size | Producer / Creator |
|---|----------|--------|------|-------|------|---------------------|
| 1 | `amherst_2024-2025_secA.pdf` | Amherst College | 2024-2025 | 2 | 68 KB | Acrobat Distiller 24 / PScript5.dll |
| 2 | `caltech_2024-2025.pdf` | Caltech | 2024-2025 | 50 | 2.0 MB | Acrobat Distiller 25 / Acrobat PDFMaker 22 for Word |
| 3 | `cmu_2024-2025.pdf` | Carnegie Mellon | 2024-2025 | 33 | 1.7 MB | Microsoft® Publisher 2016 |
| 4 | `cornell_2022-2023.pdf` | Cornell University | 2022-2023 | 32 | 704 KB | Microsoft® Excel® for Microsoft 365 |
| 5 | `dartmouth_2024-2025.pdf` | Dartmouth College | 2024-2025 | 34 | 753 KB | Adobe Acrobat (64-bit) 25.1 |
| 6 | `florida_2023-2024.pdf` | University of Florida | 2023-2024 | 37 | 930 KB | Microsoft: Print To PDF |
| 7 | `harvard_2024-2025.pdf` | Harvard University | 2024-2025 | 32 | 488 KB | macOS Quartz PDFContext / creator=Excel |
| 8 | `michigan_2023-2024.pdf` | University of Michigan | 2023-2024 | 20 | 460 KB | Microsoft: Print To PDF |
| 9 | `michigan_2024-2025.pdf` | University of Michigan | 2024-2025 | 26 | 4.8 MB | Microsoft: Print To PDF |
| 10 | `ohio-state_2023-2024.pdf` | Ohio State (Columbus) | 2023-2024 | **187** | 4.9 MB | Microsoft® Excel® for Microsoft 365 |
| 11 | `ohio-state_2024-2025.pdf` | Ohio State (Columbus) | 2024-2025 | 50 | 5.1 MB | Microsoft: Print To PDF |
| 12 | `pennstate_2022-2023.pdf` | Penn State (Univ. Park) | 2022-2023 | 46 | 629 KB | Adobe PDF Library 23.1 / Acrobat PDFMaker 23 for Excel |
| 13 | `reed_2023-2024_secC.pdf` | Reed College | 2023-2024 | 15 | 185 KB | macOS Quartz PDFContext / creator=Excel |
| 14 | `spelman_2023-2024.pdf` | Spelman College | 2023-2024 | 57 | 880 KB | Adobe PDF Library 23.8 / Acrobat PDFMaker 23 for Excel |
| 15 | `ucf_2023-2024.pdf` | Univ. of Central Florida | 2023-2024 | 48 | 705 KB | Acrobat Distiller 24 / PScript5.dll |

Coverage achieved:
- **Large publics**: Michigan (x2 years), Ohio State (x2 years), Florida, UCF, Penn State
- **Small LACs**: Amherst, Reed, Spelman, Caltech (small/STEM)
- **Ivies**: Harvard, Cornell, Dartmouth
- **Cross-year pairs for year-detection testing**: Michigan 2023-24 vs 2024-25; Ohio State
  2023-24 vs 2024-25 (also a producer-pipeline change between the two years — see §4)
- **Alternate publishing shape**: Amherst and Reed publish CDS as one PDF *per lettered
  section* rather than one consolidated document — a real, distinct ingestion shape the
  engine must support (section detection can't assume "one file = whole CDS").

### Acquisition failures (documented, not silently dropped)

- **Williams College** (both 2023-24 and 2024-25): blocked by a Cloudflare JS challenge
  (`hub.williams.edu` returns HTTP 403 with a "Just a moment..." interstitial to
  non-browser clients, `curl` cannot pass it). Not a corpus-quality issue, just an
  acquisition blocker outside this recon's scope — flagging in case the real pipeline needs
  a headless-browser fallback for Cloudflare-protected `.edu` IR sites.
- **Purdue University**: every PDF URL found via search (multiple different paths across
  multiple searches) 404'd against the live site; only a `.xlsx` URL resolved. Purdue's IR
  site appears to move/expire PDF links aggressively. Dropped from the corpus rather than
  substituting a stale mirror copy.

## 2. AcroForm / fillable-field check

**Zero of 15 PDFs have live AcroForm widgets.** `page.widgets()` returned an empty list for
every file, and `doc.is_form_pdf` was `False` for every file, including the two
(`caltech_2024-2025.pdf`, `ucf_2023-2024.pdf`) whose raw PDF object dictionary contains an
`/AcroForm` catalog entry — in both cases that entry points at an empty/orphaned form
dictionary left over from the Word→PDF conversion, not actual fillable fields. The
underlying CDS institutional-research offices flatten their submission tool's output to
static text/vector content before publishing; nobody in this sample ships a fillable PDF
form with live field values. **Do not build a form-field-reading code path as the primary
extraction strategy** — it will find nothing on real-world files.

## 3. Section header anchors — verbatim, across schools

Two structurally different heading families showed up. Note both must be handled:

**Family A — code + descriptive title on one line** (Caltech, CMU, Michigan 2024-25,
Ohio State 2024-25, Spelman, UCF, Florida):
```
A1. Address Information
B1. Institutional Enrollment - Men and Women
C1. First-time, first-year students: Provide the number of degree-seeking, first-time, first-
year students who applied...
C1. Applications: First-time, First-year Students          <- Michigan/OSU/Spelman phrasing
C7. Relative importance of each of the following academic and nonacademic factors in your first-time, first-
year, degree-seeking general (not including programs with specific criteria) admission decisions.
C7. Basis for Selection: Relative Importance of Factors in Admission Decisions   <- Michigan/OSU/Spelman/UCF phrasing
C9. Percent and number of first-time, first-year students enrolled in Fall 202  who submitted national
C9. First-time, first-year profile: National standardized test scores (SAT/ACT)  <- Michigan/OSU/Spelman/UCF phrasing
H1. Enter total dollar amounts awarded to enrolled full-time and less than full-time degree-seeking
H1. Aid Awarded to Enrolled Undergraduates                  <- Michigan/OSU/Spelman phrasing
```
Note there are **at least two independently-worded phrasings per code** circulating in the
wild (the "official CDS Initiative boilerplate question text" phrasing vs. a shorter
institution-authored "title-style" phrasing some IR offices substitute). A regex anchored
to boilerplate question wording will miss the title-style institutions and vice versa —
anchor on the **leading `CODE.` token plus loose whitespace**, not on trailing wording.

UCF additionally renders headings with **U+00A0 (NBSP) instead of literal spaces** between
every word:
```
C7.\xa0Basis\xa0for\xa0Selection:\xa0Relative\xa0Importance\xa0of\xa0Factors\xa0in\xa0Admission\xa0Decisions
```
A regex using `\s` will actually still match NBSP in most regex engines' Unicode mode, but
naive `str.split(" ")` or exact-substring matching will silently fail. **Normalize NBSP →
space before any exact-string matching, always.**

**Family B — bare code only, title text elsewhere / absent** (Cornell, Dartmouth, Harvard,
Penn State, Reed's own section headers vary — Reed uses Family A):
```
A1
B1
C1
C7
C9
H1
```
These are the four Excel/Excel-plugin-derived documents (Cornell, Harvard, Penn State — see
§4) plus Dartmouth. On these files the code appears as its own text run with the
question/title text detached elsewhere in reading order (sometimes much later, sometimes
never — Penn State's C9 title never appeared as a discrete match at all in this test).
**A regex anchored on `^C7\b` at start-of-line with no trailing text requirement is
mandatory to catch this family**; anchoring on `C7\.` (with a literal period) misses every
file in this family, since the period is frequently absent when the code stands alone.

Multiplicity gotchas actually observed:
- Harvard: `B1` occurs **9 times** in-document (sub-tables under the B section each reuse
  the bare `B1` token in the extracted stream) — a "first match wins" anchor will grab the
  wrong instance.
- Michigan 2024-25 / Ohio State 2023-24: `H1` occurs up to 3 times (main heading + a
  `H1 Response: 2023-24 Final` / `H1 Response: 2023-2024 Estimated` sub-label). The
  "Final" vs. "Estimated" suffix is itself a data quality signal worth capturing.
- Spelman/Ohio State/UCF: `C9` sometimes appears as `C9 (continued)` on a following page —
  section content can span a page break with a differently-worded continuation header.

## 4. C7 checkbox grid — does checkbox state survive text extraction?

**It depends entirely on which document-generation pipeline produced the file, and that
pipeline is not reliably predictable from PDF producer metadata alone.** Three distinct
behaviors observed, verbatim:

**(a) Michigan 2024-2025 — best case: answer inlined as descriptive text.** No checkbox
grid at all; the selected level is printed directly after each factor as literal text:
```
C7. Basis for Selection: Relative Importance of Factors in Admission Decisions
ACADEMIC
Rigor of secondary school record
Very Important
Class rank
Not Considered
Academic Grade Point Average (GPA) 
Very Important
Recommendations
Important
Standardized test scores
Important
Application essay
Important
NONACADEMIC
Interview
Not Considered
Extracurriculuar activities
Considered
Talent/ability
```
Directly zip-able: `(label[i], value[i])` pairs in strict alternating order. UCF and
Ohio State 2024-2025 (partially, see below) use variants of this same "answer as text"
approach. This is the one shape where plain `get_text()` alone is sufficient.

**(b) Cornell 2022-2023 — literal `X` marker present but column position lost.**
```
C7
Very Important
Important
Considered
Not Considered
Academic
Rigor of secondary school record
X
Class rank
X
   Academic GPA
X
Standardized test scores
X
Application Essay
X
Recommendation(s)
X
Nonacademic
Interview
```
An `X` genuinely exists per selected row, but **there is exactly one `X` per row in this
extract and the four column-header labels only appear once, at the top, decoupled from
every row** — plain reading-order text gives no way to tell *which* of the four columns
each row's `X` was drawn in. Reconstructing the actual answer requires the `X` glyph's
(x, y) bounding box compared against the x-ranges of the four header-cell bounding boxes
(`page.get_text("words")` / `"dict"`, not the plain string mode). Harvard's C7 (also an
Excel/Quartz-pipeline doc — see below) shows the identical `X`-with-lost-column pattern.

**(c) Caltech / CMU / Ohio State 2024-25 — worst case: no textual mark at all.**
```
C7. Relative importance of each of the following academic and nonacademic factors in your first-time, first-
year, degree-seeking general (not including programs with specific criteria) admission decisions. 
Not 
Very Important 
Important 
Considered 
Considered 
Academic 
Rigor of secondary school record 
Class rank 
Academic GPA 
Standardized test scores 
Application Essay 
Recommendation 
Nonacademic 
Interview 
Extracurricular activities 
```
Column headers and row labels both extract cleanly, but there is **no glyph anywhere in the
text layer indicating which cell is selected** — the checkmark is drawn as a vector
path/shape or small raster glyph with no Unicode mapping, not as an `X` character. This is
not a corruption bug, it is simply how these particular checkbox widgets were drawn.
**Text extraction cannot answer C7 for this family under any regex or bbox trick — this is
a hard requirement for vision-model (or targeted rasterize-and-OCR-the-checkbox-cell) input
for roughly a third of real-world files.**

Net: any C7 extraction strategy needs a three-tier fallback — (1) try direct
label-adjacent-to-value text (shape a), (2) if only bare `X` markers are found, do
bbox-vs-column-header spatial reconstruction (shape b), (3) if neither yields a signal,
rasterize the C7 region and hand it to a vision model (shape c). There is no text-only
heuristic that covers all three.

## 5. C1 table (applicants/admits/enrolled by gender) — how tables extract

Also three distinct behaviors, and they correlate loosely (not perfectly) with the
source-tool split from §4/§6:

**Michigan 2024-2025 — clean row-major table, safe to reconstruct by position:**
```
C1. Applications: First-time, First-year Students
Fall 2024
Men
Women
Another 
Gender
Total
Total first-time, first-year students who applied
48,101
50,209
98,310
Total first-time, first-year students admitted
6,684
8,689
15,373
Total first-time, first-year students enrolled
3,199
4,079
7,278
```
(Note "Total" here is only 3 numbers per row, not 4 — the "Another Gender" column is 0 for
this school and appears to have been *omitted* rather than printed as `0`; column-count
assumptions must not be hardcoded.)

**Reed 2023-2024 — clean, label immediately followed by its 3 values (also Excel/Quartz
sourced, proving pipeline alone doesn't determine outcome — see §6):**
```
C1. Applications: First-time, First-year Students
Men
Women
Another 
Gender
Total first-time, first-year students who applied in Fall 2023
4,094
5,102
849
Total first-time, first-year students admitted in Fall 2023
879
1,505
344
Total first-time, first-year students enrolled in Fall 2023
130
154
67
```

**Cornell 2022-2023 — worst case: numbers and labels are in completely different parts of
the extracted stream, in an order that doesn't even match visual top-to-bottom row order.**
This is the single most important finding in this recon. Raw extracted text for the C1/C2
page, in the order it actually comes out of `get_text()`:
```
Common Data Set 2021-2022
C1-C2: Applications
               35,492 
35,672
               
-
                    
2,317
                 
2,851
...
[block of ~20 bare numbers with no adjacent labels]
...
C2
Yes
No
X
TOTAL
...
Total first-time, first-year women who applied
Total first-time, first-year men who applied
Total part-time, first-time, first-year men who enrolled
Total full-time, first-time, first-year women who enrolled
...
[block of ~20 bare labels, in an order that does not match the numbers above, and does not
match a sensible top-to-bottom reading order either]
```
The numbers block and the labels block are not adjacent, not co-ordered, and the label
order itself is scrambled relative to any plausible visual reading order (this is
consistent with an Excel print export where each cell became its own independently
z-ordered PDF text object, and the objects were serialized in *cell-creation* order rather
than *visual position* order). **Linear/regex text extraction is completely unusable for
this document's C1 table.** The only paths that could work: (1) bbox-based spatial
reconstruction using each text run's actual (x, y) position on the page — expensive but
possibly tractable since the values are real text, not images — or (2) rasterize-and-vision.
Harvard's C1 (also Excel/Quartz-derived) shows the identical decoupled-block pattern.

## 6. The "Excel-sourced" correlation, and why it's a correlation, not a rule

Files whose PDF producer/creator metadata mentions Excel or an Office-suite export
(`cornell_2022-2023.pdf`, `harvard_2024-2025.pdf` [creator=Excel via macOS Quartz],
`ohio-state_2023-2024.pdf`, `reed_2023-2024_secC.pdf` [creator=Excel via macOS Quartz]) are
4 of 15 files (27%) in this corpus. Of those four, **three show badly scrambled
label/value ordering in tables (Cornell, Harvard) or extreme pagination bloat with
sparse/broken pages (Ohio State 2023-24: 187 pages, 56 of them <20 characters, some pages
with visibly reversed/fragmented word order from wide-table column splitting) — but the
fourth (Reed) extracts perfectly cleanly.** Metadata alone (`producer`/`creator` strings)
is a *useful prior* for "inspect this file more carefully, maybe route to a slower/spatial
extraction path" but **must not be used as a hard gate** — Reed disproves "Excel producer ⇒
broken extraction" as a universal rule, and Penn State/Spelman (Adobe PDFMaker-for-Excel,
a proper plugin rather than raw File→Save As) both extract cleanly despite also
originating in Excel. The safest signal is empirical, not metadata-based: run a cheap
per-page heuristic (e.g., "does every numeric token in this section have a label-shaped
text run within N points of it spatially?") and fall back to bbox/vision extraction only
for pages that fail the check, rather than pre-classifying by producer string.

Ohio State also demonstrates that **the same institution can switch pipelines between
years** — 2023-24 was Excel-exported (187 pages, broken), 2024-25 was "Microsoft: Print To
PDF" (50 pages, clean dense text, but lost all C7 checkbox marks — see §4c). An engine
cannot assume a school's document shape is stable year over year even for the identical
institution.

## 7. Silent text corruption (Caltech) — the most dangerous failure mode found

Caltech's 2024-2025 PDF (`Acrobat Distiller 25` / `Acrobat PDFMaker 22 for Word` — i.e. a
perfectly normal-looking, Word-authored, Distiller-produced PDF, not an Excel export) has
**1,772 non-printable control characters (0x00–0x1F range) embedded in its extracted text
across 50 pages**, out of ~103K total characters. These are not extraction errors that
raise exceptions or produce empty strings — they produce **plausible-looking but wrong
text**, because a subset of the document's embedded fonts lack a correct `ToUnicode` CMap,
so PyMuPDF falls back to the font's raw (and non-standard) character codes. The offset is
consistent within a given font-subset run but **differs by which embedded font subset drew
that particular text** — e.g.:
- The title/header text "**Common Data Set 2024-2025**" extracts as
  `'Common Data Set 202\x17-202\x18'` — a **-29 code-point shift** applied to the digits `4`
  and `5` only (`4`→`\x17`, `5`→`\x18`), while every other character in the same string
  ("Common Data Set 202", the hyphen, and the leading "202") is untouched.
- The word "First" (in "A0. Respondent Information") extracts as `')LUVW'` — the *identical*
  -29 shift applied uniformly to every letter (`F`→`)`, `i`→`L`, `r`→`U`, `s`→`V`, `t`→`W`).
- Elsewhere on the same page, "the URL of" extracts as `'WKH\x0385/\x03RI\x03'` — a
  **different** shift (space→`\x03`, consistent with a *different* embedded font subset
  hitting the same broken-CMap bug with its own offset).
- "students" extracts as `'VWXGHQWV'` (a **+3** shift, ROT3, in yet another region) —
  proving the corruption isn't even one global offset for the whole document, it's
  per-font-subset and varies subset to subset.

This means: **a naive extraction pass over the Caltech PDF would silently return believable
but factually wrong values for exactly the kind of thing an extraction engine most needs to
get right — the reporting year and any digit-bearing field drawn in an affected font run** —
with no exception thrown and no empty-string signal to detect the failure. Across our
15-file corpus this appeared in exactly 1 file (Caltech), so it's not common, but it is the
single scariest failure mode because it fails *quietly*. **Mandatory mitigation for the
engine: validate extracted year/digit tokens against an independent source (filename, URL,
or a second extraction pass rendering the page as an image + OCR/vision) whenever a
control-character or otherwise-out-of-Unicode-printable-range character appears in the
extracted text; do not trust `get_text()` output unconditionally even when it "looks like"
normal text.**

## 8. Year detection — the Cornell stale-header trap

`cornell_2022-2023.pdf` (correct year per filename, per source URL, and per the document's
own cover page A1 field, "Name of College/University: Cornell University" section) contains
a running page header reading **"Common Data Set 2021-2022" on 25 of its 32 pages (78%)**,
versus the correct "Common Data Set 2022-2023" on only 2 pages. This is a leftover
prior-year template artifact from whatever authoring tool Cornell's IR office used — most
of the document body was evidently copy-forwarded from the 2021-2022 file without updating
the header on every page.

**A naive "extract the year string that appears most often in the document" heuristic would
misclassify this entire document as the wrong CDS year (2021-2022 instead of 2022-2023) with
high confidence, since it's a 25-vs-2 majority.** The only reliable year signals, in order
of trust: (1) source URL / filename if known at ingestion time, (2) the A0/A1
"respondent information" section specifically (which was correct here), (3) explicit
"Fall <year> cohort" phrasing tied to the specific data question being read (each C1/C7/etc.
question usually names its own cohort year inline, e.g. "in Fall 2022 admissions" — more
reliable than any document-wide header vote), and only last, with heavy skepticism, (4) a
majority vote over repeated header strings.

## 9. Multi-year side-by-side content

This is a normal, *intentional* CDS feature, not a document-shape hazard: the retention/
graduation-rate section (B12–B22) legitimately shows two cohort years side by side by
design (e.g. Cornell page 5: `"2019 Cohort"` / `"2018 Cohort"` as adjacent column headers
before the B12–B22 row data). An engine parsing this section must expect two year columns
and should not treat a second year string found here as evidence about the *document's*
reporting year (distinct from §8's stale-header problem, which is an authoring bug, not a
designed feature).

## 10. What this means for the extraction engine — summary

1. **Do not build a form-field/AcroForm reading path as a primary strategy.** 0/15 real
   files had usable form fields, even the 2 with a leftover `/AcroForm` catalog entry.
2. **Section-code regex anchors must tolerate two heading families**: `CODE. Title text`
   and bare `CODE` alone on its own line, with **no trailing period required**, and must
   **normalize NBSP (U+00A0) to space** before matching (UCF). Expect the same code to
   recur 2–9 times in one document (continuation pages, sub-tables, "Response: Final/
   Estimated" labels) — never assume first-match is the right match; disambiguate using
   surrounding context (e.g., nearest preceding higher-level section header).
3. **C7 (and any checkbox-grid question) needs a 3-tier extraction strategy**: (a) direct
   text answer adjacent to label (works ~1/3 of corpus), (b) bbox-based spatial
   reconstruction of bare `X` markers against column-header x-positions (works for the
   Excel/Quartz-pipeline "X" family), (c) vision/OCR fallback when neither text signal
   exists (Caltech/CMU/Ohio-State-2024-25 family — no textual mark survives at all). There
   is no purely-regex path that covers all three.
4. **C1-style data tables cannot be assumed row-major-adjacent.** Roughly a quarter of the
   corpus (Excel-exported files, notably Cornell and Harvard) puts all numeric values in one
   disconnected block and all labels in a separately-ordered block — genuinely unusable via
   linear/regex text extraction; requires spatial (bbox) reconstruction or vision fallback
   for those documents specifically. This cannot be predicted purely from producer metadata
   (Reed is Excel/Quartz-sourced and extracts perfectly).
5. **Treat producer/creator PDF metadata as a soft routing hint, not a hard classifier.**
   Use it to decide whether to *also* run a spatial/vision-assisted pass, never to skip the
   plain-text pass or vice versa.
6. **Validate, don't trust, extracted digit/year tokens.** At least one otherwise-normal
   file (Caltech) silently corrupts digits and words via broken font ToUnicode maps with no
   thrown error. Cross-check the reporting year against filename/URL and, ideally, flag any
   extracted text containing control characters (0x00–0x1F outside `\n\t\r`) for a
   vision/OCR re-check of that page.
7. **Never trust a document-wide majority vote for the reporting year.** Cornell's running
   header is wrong on 78% of pages. Prefer filename/URL at ingestion time, then the
   dedicated respondent-information (A0/A1) section, then per-question inline cohort years
   ("Fall 2022 admissions"); use whole-document header majority vote only as a last resort.
8. **Page count and file size are not reliable proxies for document complexity or
   completeness.** Ohio State's 2023-24 file is 187 pages (vs. 50 for the very same
   institution one year later) purely due to Excel pagination artifacts, with a third of
   those pages nearly blank.
9. **Support "split CDS" as a first-class ingestion shape, not an edge case.** Amherst and
   Reed publish one PDF per lettered section rather than one consolidated document; a
   pipeline that assumes "1 PDF = 1 complete CDS" will silently under-extract for these
   schools unless it also crawls/aggregates the institution's CDS index page.
10. **Plan for non-PDF ingestion.** Purdue's current live links resolve to `.xlsx`, not
    `.pdf` — the engine's file-type detection and ingestion routing needs an Excel path,
    not just a PDF one, even though this recon corpus itself is 100% PDF.

## Appendix — raw data files

- `artifacts/cds-corpus/*.pdf` — the 15 source files
- `artifacts/cds-corpus/characterization_raw.json` — full per-file pymupdf dump (page
  count, metadata, widget scan, all six section-header search results with context
  windows, control-character counts implicitly derivable from `char_count` vs. visible
  text)
- `artifacts/cds-corpus/inventory.json` — flattened, report-ready inventory (school, year,
  pages, producer, has_text, has_widgets, notes) consumed by this report's table in §1
