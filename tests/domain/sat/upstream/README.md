# The SAT-practice differential harness

"Port, not fork" (plan.md §2, §8.2) only holds if it's checked, not asserted.
This directory is that check: it runs liprep's own, unmodified logic against
sample College Board data and records what it produces, so
`domain/sat/normalize.py`, `domain/sat/spr_answers.py`, `domain/sat/grading.py`
and `domain/sat/stats.py` can be tested against upstream's actual behaviour
instead of a paraphrase of it.

## What's here

| Path | What it is |
|---|---|
| `upstream.patch` | The two-hunk patch applied to a pinned liprep clone before the harness imports from it (see "What the patch is, honestly" below) |
| `harness/` | A small, self-contained vitest project (its own `package.json`) that imports the patched upstream code and writes `vectors/*.json` |
| `harness/.upstream/` | **Gitignored.** The patched copy of liprep's `src/` that `prepare-upstream.sh` materialises. Nothing here is committed — it's regenerated from the pin below |
| `harness/.upstream-stamp.json` | Records the exact liprep commit and patch sha256 the currently-materialised `.upstream/` was built from |
| `vectors/*.json` (`.json.gz` past 2 MB) | The generated differential vectors. Committed — this is the actual evidence the Python tests assert against |
| `DIFFERENCES.md` | Everything the vectors deliberately do **not** compare, and why |

## The upstream pin

**liprep commit:** `c84d3dc099653cc82fa2d380a7bbd299ae52201e`
**Patch sha256:** `98a2bc4914fd1bb18db9445366d374813cc489be27539e7daac9657ffa73dfb3`

Both are read from `harness/.upstream-stamp.json` after a successful
`prepare-upstream.sh` run, and are stamped onto every generated vector file
(`suite`, `upstream_commit`, `patch_sha256`, `generated_at`, `count`, `cases`)
so a vector can always be traced back to exactly what produced it.

## What the patch is, honestly (plan §8.2)

Two hunks, ~35 lines, reviewable at a glance — it adds `export` to four
functions and lifts one `useMemo` body into a standalone export, and changes
no logic:

1. `export` added to `parseNumericValue` and `checkIsCorrect`
   (`src/pages/Practice.tsx:34, 48`) and `parseWrittenFraction`
   (`src/db.ts:108`) — keywords only, nothing else on those lines changes.
2. In `src/components/RichContent.tsx`, the **five**
   `preprocessed = preprocessed.replace(…)` statements and the
   `transformMfenced(preprocessed)` call inside `RichContent`'s `useMemo`
   (originally lines ~140–163) are lifted, **unchanged and in the same
   order**, into a new exported function `preprocessSatHtml(html)`, which the
   `useMemo` then calls instead of repeating the five statements inline.
   `transformMfenced` (module scope, originally line 70) also gains
   `export`. This is a small refactor of upstream, and the patch's own
   diff — five statements moved verbatim, nothing reworded — is what vouches
   that they did not change in the move.

Import side effects worth knowing before touching the harness: `src/db.ts`
constructs two Dexie databases and parses `bluebook_ids.json` at module
scope, which is why `fake-indexeddb/auto` is a Vitest `setupFile`
(`harness/vitest.config.ts`) rather than an import inside the specs.

## Regenerating the vectors

Prerequisites: a local clone of liprep (`github.com/liprep/liprep`) checked
out at the pinned commit above, at `artifacts/sat-practice/liprep` (repo
root) — `prepare-upstream.sh` refuses to run against any other commit, and
never touches that clone itself.

```bash
cd tests/domain/sat/upstream/harness
npm ci                    # installs liprep's runtime deps + vitest/jsdom/fake-indexeddb
npm run prepare:upstream  # rsyncs liprep's src/ into .upstream/, applies upstream.patch,
                           # writes .upstream-stamp.json
npx vitest run            # runs every generate.*.spec.ts, writing tests/domain/sat/upstream/vectors/*.json
```

(`npm run generate` runs both steps in sequence.) Each `generate.*.spec.ts`
reads its research sample from `artifacts/sat-practice/research/` by
default (`harness/lib/research.ts`); pass `SAT_RESEARCH_DIR=<dir>` to point
at the full downloaded bank later (plan §3.2's `fetch` output) once the real
crawl exists, without touching any spec file.

After running, `cd` back to the repo root and re-run the Python suites that
assert against the refreshed vectors:

```bash
uv run pytest tests/domain/sat/test_normalize.py tests/domain/sat/test_spr_answers.py \
              tests/domain/sat/test_grading.py tests/domain/sat/test_stats.py \
              tests/domain/sat/test_progress_file.py -q
```

A vector's `upstream_commit`/`patch_sha256` changing is a signal, not
noise: it means the pin moved. Re-review `upstream.patch` against the new
commit and update the pin above (and in `prepare-upstream.sh`) deliberately
— never silently.

## The jsdom-serialiser caveat (plan §8.2)

The `mfenced` transform (`transformMfenced`) round-trips HTML through
`DOMParser`/`innerHTML`, so the `html_transforms` vector's byte-for-byte
comparison is between our Python port and upstream **both running under
jsdom**. That proves the two implementations agree with each other; it does
not prove either one matches a real browser's serialiser. The three-engine
browser parity pass (plan §8.4) is what covers actual rendering — this
harness is not a substitute for it.

## Suite → vector map (plan §8.2)

| Suite | Generator | Vector file | Python assertion |
|---|---|---|---|
| normalisation (G9) | `generate.normalize.spec.ts` | `vectors/normalize.json` | `tests/domain/sat/test_normalize.py` |
| spr extraction | `generate.spr.spec.ts` | `vectors/spr_extraction.json` | `tests/domain/sat/test_spr_answers.py` |
| grading | `generate.grading.spec.ts` | `vectors/grading.json` | `tests/domain/sat/test_grading.py` (owned elsewhere) |
| stats | `generate.stats.spec.ts` | `vectors/stats.json.gz` | `tests/domain/sat/test_stats.py` (owned elsewhere) |
| progress file | `generate.progress.spec.ts` | `vectors/progress_file.json` | `tests/domain/sat/test_progress_file.py` (owned elsewhere) |
| html transforms | `generate.html.spec.ts` | `vectors/html_transforms.json.gz` | (consumed by the html-transform port, owned elsewhere) |

`domain/sat/normalize.py`'s and `domain/sat/spr_answers.py`'s own module
docstrings say precisely what each is checked against and what is
deliberately out of scope — see `DIFFERENCES.md` for the full list.
