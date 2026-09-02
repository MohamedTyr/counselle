# CDS Admin — full audit findings

**Status:** findings document, pre-implementation. Nothing here is fixed yet.
**Branch:** `feat/cds-admin-polish-2` · **Baseline commit:** `2217fbd` · **Tree:** clean
**Audited:** 2026-09-01

---

## 1. Scope and method

Every file in the CDS admin feature was read in full — no sampling. Coverage:

| Layer | Files | LOC |
|---|---|---|
| Honesty core | `domain/cds/` (7 files) | ~1,530 |
| Engine + services | `app/cds/` (17 files) | ~4,720 |
| Data access + HTTP | `adapters/cds_{store,admin_queries,admin_types,gemini,pdf}.py`, `api/routes/cds_admin.py` | ~2,610 |
| Frontend | `frontend/src/{api,features}/cds-admin/`, 3 pages | ~8,380 |
| Schema | `migrations/0015`, `0016` (+ rollbacks), `scripts/setup_db.sql` | — |
| Config/wiring | `config/settings.py`, `.env.example`, `app/deps.py`, `api/main.py`, router/nav guards | — |
| Scripts | 8 `scripts/cds_*` / `*_cds_*` | — |
| Tests | `tests/{app,domain}/cds/`, `tests/adapters/test_cds_*`, `tests/api/test_cds_admin_auth.py` | ~4,165 |

Eleven Sonnet subagents ran the sweep. Three slices (`service_review.py`, and the
verification of several `UNVERIFIED` items) were completed by the orchestrator directly after
subagents repeatedly hit the harness stream watchdog on large files.

**Every finding below is verified at `file:line` against the code as it exists at `2217fbd`.**
Where a claim could not be confirmed it is labelled `UNVERIFIED` with the exact step that
would confirm it. Items that agents raised but which turned out to be non-issues are recorded
in §7 so nobody re-opens them or "fixes" working code.

### Ground truth used

`cds_library.*` is **not created by this repo's migrations** — 0015/0016 create `counselle.*`
only, by design (0015's own header says so). Every `cds_library` schema claim in this document
was therefore verified against the **live database** (`localhost:5433`, `counselle_data`, role
`cds_library_app`). That snapshot — full DDL, indexes, constraints, triggers, grants — is at
`/tmp/claude-1000/-home-saifuddin-Projects-counselle/87a7ade5-93e6-4382-a53b-7b7f8667eef4/scratchpad/audit/LIVE-SCHEMA.md`.
It should be copied somewhere durable before that scratchpad is cleaned; see **W-06**.

### Baseline (the regression floor — no fix may worsen these)

| Check | Result |
|---|---|
| `pytest` CDS-scoped (`tests/{app,domain}/cds`, `test_cds_disposal`, `test_cds_pdf`, `test_cds_admin_auth`) | **170 passed, 0 failed** |
| `pytest` full routine suite | 1743 passed, **8 failed — all pre-existing, none CDS** |
| `npm test -- --run` | **1002 passed, 0 failed** (91 files) |
| `ruff check .` | clean |
| `mypy .` | 3 errors, all in `scripts/finish_render_staging.py` (not CDS) |
| `scripts/cds_manifest_check.py` | exit 0 — manifest `5.1.0`, hash `6367c0fe…`, 394 metrics / 13 domains, all confirmed live |

The 8 inherited failures are in `test_deps_workspace.py`, `test_protocol_fixtures.py` (×2),
`test_run_turn.py`, `test_toolset.py` (×3), `test_foundation_regressions.py`. **Out of scope** —
do not fix here, but do not let the count grow either.

---

## 2. Severity summary

| ID | Sev | Area | Title |
|---|---|---|---|
| **W-01** | **CRITICAL** | Startup | Unreachable pipeline DSN takes down the entire app, not just CDS admin |
| **U-01** | **CRITICAL** | Review UI | Approve shortcut stays live behind the Reject dialog — silent wrong approval |
| **N-01** | **HIGH** | Worker | Poll loop dies silently on any transient error — extraction stops forever |
| **Z-01** | **HIGH** | Extraction | A partial success is recorded as a total failure, losing the domain breakdown |
| **E-01** | **HIGH** | Extraction | Images-only call describes a page mapping for a PDF it never sends |
| **R-01** | **HIGH** | Review read model | Header attributes mixed-generation data to one extraction |
| **A-01** | **HIGH** | Approve | Stale snapshot silently reverts a concurrently re-extracted domain |
| **F-04** | **HIGH** | Upload UI | After first process, newly added files can never be queued |
| **F-03** | **HIGH** | Upload UI | Per-file skip reasons fetched but never shown — silent drop |
| **F-01** | **HIGH** | Upload UI | Row-scoped failures double-surface (toast + inline), against spec |
| **U-02** | **HIGH** | Review UI | Narrow-viewport layout can push the review panel out of reach |
| **C-01** | **MEDIUM→HIGH** | Coverage UI | Grid silently truncates at 50 rows; counters then disagree with what's shown |
| **V-01** | **MEDIUM** | DB | No unique constraint backing sha256 dedupe (+ I-01 race) |
| **N-02** | **MEDIUM** | Worker | Lease-renewal error stops renewal silently *and* masks the real crash |
| **A-02** | **MEDIUM** | Approve | Concurrently resubmitted edit deleted unapplied |
| **T-202** | **MEDIUM** | Store | `promote_candidate_document` never checks its rowcount |
| **T-201** | **MEDIUM** | Store | `reject_candidate_document`'s second UPDATE discards its result |
| **R-02** | **MEDIUM** | Review | Rerun mid-save silently discards an edit behind a 200 |
| **I-02** | **MEDIUM** | Ingest | PATCH on a `duplicate` row echoes success but changes nothing |
| **F-02** | **MEDIUM** | Upload | Client 50 MiB cap ≠ server 50 MB cap — false-accept then 413 |
| **U-03** | **MEDIUM** | Review UI | "Approve with 1 blocking flags" — never pluralizes |
| **M-01** | **MEDIUM** | Ops | `cds_library_app` role/grants exist nowhere in repo SQL |
| **W-02** | **MEDIUM** | Config | `COUNSELLE_CDS_DATA_ENABLED` undocumented in `.env.example` |
| **E-02** | **MEDIUM** | Dead code | Second, incomplete, dead PDF-narrowing implementation |
| **E-03** | **MEDIUM** | Honesty | Stale-year detector's hardcoded ref has no manifest tripwire |
| **I-03** | **MEDIUM** | Structure | `create_upload` ~134 lines, `_commit_row` ~87 lines |
| **W-06** | **MEDIUM** | Ops | `cds_library` schema is unreproducible from source control |
| **H-02** | **LOW** | HTTP | `jobs_route`'s `ids` list has no size cap |
| **A-03** | **LOW** | Audit | Audit row can be lost on a crash after the substantive commit |
| **Q-03** | **LOW** | DB perf | Two hot queries have no usable index (measured fine today) |
| **F-05/W-04** | **LOW** | Dead code | `committedFileIds`, `UseBatchUploadResult` unused |
| **U-04** | **LOW** | Dead code | `FlagSeverity.info` unreachable — backend emits only error/warning |
| **R-03** | **LOW** | Latent | Domain-level flags unaddressable — currently unreachable |
| **R-04** | **LOW** | Latent | Read model assembled from 4 non-atomic reads |
| **T-101** | **LOW** | Latent | Dedupe ignores `superseded_at` — currently never written |
| **W-03** | **LOW** | Docs | CLAUDE.md says "32 ADRs"; there are 36 |
| **W-05** | **LOW** | Script | `verify_cds_adapters.py` pins superseded manifest `5.0.2` |

**2 CRITICAL · 9 HIGH · 16 MEDIUM · 10 LOW.**

*(N-01, N-02, C-01 and Z-01 were added during review rounds 1-3, each after a reviewer returned
NOT READY. All four were independently verified before inclusion. See the review history in §6.)*

---

## 3. CRITICAL

### [W-01] A set-but-unreachable pipeline DSN takes down the whole app

- **Category:** startup · **Location:** `app/deps.py:123-130`, `api/main.py:90`
- **Confidence:** **CONFIRMED — reproduced live.**

```python
try:
    pipeline_pool: asyncpg.Pool | None = None
    if settings.db_pipeline_dsn:
        pipeline_pool = await create_pool(dsn=settings.db_pipeline_dsn, settings=settings)
except BaseException:
    await ro_pool.close()
    await app_pool.close()
    raise            # <-- propagates out of the FastAPI lifespan
```

`create_pool` → `asyncpg.create_pool` eagerly opens `min_size` connections. Pointing
`COUNSELLE_DB_PIPELINE_DSN` at `127.0.0.1:59999` with valid RO/app DSNs and calling
`build_runtime(settings)` produced:

```
BOOT FAILED: ConnectionRefusedError: [Errno 111] Connect call failed ('127.0.0.1', 59999)
```

`api/main.py:90` awaits `build_runtime` inside `_lifespan` with no `try`/`except`, so the API
process never starts.

This **contradicts two written contracts**:

- `config/settings.py:256-258` — *"Optional — the app boots without it and the CDS admin
  surface returns a clean 503 until it is configured"*
- `docs/DATABASE_GUIDE.md:86-88` — *"the app boots fine without it, and the CDS admin router
  returns a clean 503"*

Both hold only for DSN-**unset**. DSN-**set-but-unreachable** is a different and far worse
mode: a superuser-only feature's DB outage becomes a total outage for every student.

**Failure scenario.** The DSN is configured in staging/prod. At any restart the pipeline
Postgres is briefly unreachable — network blip, credential rotation, maintenance window,
typo'd DSN, changed port. The entire Counselle API fails to boot: no chat, no auth, no
workspace. For a DSN only 14 superuser endpoints ever touch.

**Fix.** Catch pipeline-pool creation failure specifically, log at error, degrade to
`pipeline_pool = None` — the exact posture already used for DSN-unset, and already the shape
of `app/cds/jobs.py:137-139` and `api/routes/cds_admin.py:63-64`. CDS admin then returns its
documented clean 503 and everything else serves.

> **Decision needed.** Fail-fast on a broken DSN is a *defensible* alternative (a
> misconfigured deploy surfaces immediately rather than degrading silently). But it is not
> what the code says today and not what two docs promise. Pick one and make code and docs
> agree. Recommendation: **degrade**, because the blast radius of the current behavior is the
> whole product and the feature is admin-only.

**Regression risk.** Low. No caller assumes pool creation is fatal. Add a test asserting
`build_runtime` returns a runtime with `pipeline_pool is None` when the DSN is unreachable —
this is exactly the "a bug you want to stay fixed" case that earns a test under `CLAUDE.md`.

---

### [U-01] The Approve shortcut fires while the Reject dialog is open

- **Category:** bug / honesty · **Location:** `frontend/src/features/cds-admin/review/use-review-controller.ts:143-204`; triggered from `frontend/src/pages/cds-review-page.tsx:297-308`; affected UI `RejectDialog.tsx`, `ApproveAnywayDialog.tsx`
- **Confidence:** CONFIRMED for the missing guard. Radix's non-Escape key bubbling is standard but was not browser-verified — see §6.

A single `window` keydown listener lives for the whole page lifetime. Its **only** exclusion is
"focus is in an input/textarea/contenteditable":

```ts
function isEditableTarget(target: EventTarget | null): boolean { … }

useEffect(() => {
  function handleKeyDown(event: KeyboardEvent) {
    if (isEditableTarget(event.target)) return;
    const isSubmit = (event.metaKey || event.ctrlKey) && event.key === "Enter";
    if (isSubmit) { event.preventDefault(); onApprove(); return; }
    switch (event.key) { case "n": … case "p": … case "j": … case "k":
                         case "e": case "Enter": … case "[": … case "]": … case "?": … }
  }
  window.addEventListener("keydown", handleKeyDown);
  return () => window.removeEventListener("keydown", handleKeyDown);
});
```

There is **no check for an open dialog anywhere.** Both dialogs are plain Radix
`Dialog.Root`/`Dialog.Content` wrappers with no key interception beyond Escape/Tab.

And `onApprove` is effectively unguarded in the common case:

```ts
onApprove: () => {
  if (review.flags_summary.unresolved > 0) return;
  handleApprove();
},
```

Most documents being *rejected* are rejected for a content reason, not because of stored
flags — so `unresolved === 0` and the guard is a no-op.

**Failure scenario.** Admin clicks Reject, types a reason into the textarea, then tabs to the
Reject/Cancel button to re-read it before committing. Those are plain `<button>`s — not
editable targets. They press **⌘Enter**, which the app's own `ShortcutsPopover` documents as
*"Save (in editor) · Approve (elsewhere)"*. It does not submit the reject dialog. It calls
`handleApprove()` and **approves the document**, with the reject dialog still open and the
typed rejection reason discarded.

The same hole lets `n`/`p`/`j`/`k`/`e`/`[`/`]` mutate the PDF page, the focused metric and the
inline editor invisibly behind an open modal.

`ReviewHeader`'s own comment says the UI was shaped to prevent exactly this
("destructive and constructive actions sharing a corner is how people mis-click"). The
keyboard layer puts it back.

**Fix.** Compute `modalOpen = rejectOpen || approveAnywayOpen` in `cds-review-page.tsx`, pass
it into `useReviewController`, and early-return at the top of `handleKeyDown` — mirroring the
existing `isEditableTarget` guard. Minimal diff; dialogs untouched.

**Regression risk.** Low. No test exercises keyboard shortcuts on this page (grep for
`metaKey`/`ctrlKey`/`rejectOpen` in `cds-review-page.test.tsx` → nothing), so nothing pins the
broken behavior. `useReviewController` has exactly one caller. **Add a regression test** — an
irreversible write triggered by the wrong key is precisely a test that earns its place.

---

## 4. HIGH

### [N-01] The worker poll loop dies silently on any transient error

- **Category:** bug / silent failure · **Location:** `app/cds/jobs.py:61`, `:76-89`
- **Confidence:** CONFIRMED.

```python
self._loop_task = asyncio.create_task(self._loop(), name="cds-worker-poller")   # :61
                                                       # ^ no add_done_callback

async def _loop(self) -> None:                                                  # :76
    while True:                                                                 # no try/except
        await cds_store.sweep_expired_leases(self._pool)
        await self._semaphore.acquire()
        claimed = await cds_store.claim_next_extraction(
            self._pool, lease_seconds=self._settings.cds_extraction_lease_seconds
        )
        if claimed is None:
            self._semaphore.release()
            await asyncio.sleep(self._settings.cds_worker_poll_seconds)
            continue
        task = asyncio.create_task(self._run_claimed(claimed), name=f"cds-run-{claimed.id}")
        self._running_tasks.add(task)
        task.add_done_callback(self._on_task_done)      # :89 — run tasks DO get a callback
```

The loop body has **no exception handling**, and `_loop_task` gets **no `add_done_callback`** —
note the deliberate contrast with line 89, where each *run* task does get one. Any exception
from `sweep_expired_leases` or `claim_next_extraction` (a DB blip, a pool-acquire timeout, a
connection reset during a Postgres restart) propagates out of `_loop` and kills the task.

**Failure scenario.** Postgres hiccups for a second. The poller task dies. The process stays
up, the API keeps serving, health checks pass, `start_cds_worker` already returned — and **no
extraction is ever claimed again until someone restarts the process.** Uploaded documents sit
in `processing` indefinitely. The only trace is asyncio's default *"Task exception was never
retrieved"* on stderr at GC time, which never reaches structlog and nobody is watching.

This flatly contradicts the module's own docstring: *"a crashed or restarted process is always
survivable, because nothing about 'what to run next' is held in process memory."* That is true
of the **queue state** but not of the **poller**, which is exactly the part that has no
recovery.

**Fix.** Make the loop survive errors, and attach a `add_done_callback` to `_loop_task` that
logs loudly if the loop ever exits un-cancelled, so a future escape is visible rather than
silent.

> **Fix constraint — the naive version is wrong. Use the shape below.**
>
> The semaphore is acquired at `:79` *before* `claim_next_extraction` at `:80`. Today that
> leak is moot because the whole loop dies. Once the loop survives errors, an exception between
> `acquire()` and `_on_task_done`'s release **permanently leaks one concurrency slot per
> failure** — after `cds_worker_concurrency` failures (default 3) the poller blocks forever on
> `acquire()`: just as dead, and harder to diagnose.
>
> Two tempting remedies are both wrong:
> - **Do NOT move `acquire()` below the claim.** That claims a DB row and takes its lease while
>   holding no free slot, then blocks waiting for one. The row is leased but not running, the
>   keeper task does not exist yet, and the lease can expire before the run starts — starving
>   other workers and corrupting the back-pressure the semaphore exists to provide.
> - **Do NOT wrap the whole body in one `try/except` with a release in the handler.**
>   `asyncio.Semaphore` is unbounded, so a release on a path that never acquired silently
>   *inflates* the concurrency cap with no error.
>
> Release must be **exactly once per acquire**, guaranteed structurally by mutually exclusive
> paths rather than by reasoning:
>
> ```python
> async def _loop(self) -> None:
>     while True:
>         try:
>             await cds_store.sweep_expired_leases(self._pool)
>         except Exception:
>             logger.exception("cds_worker_sweep_failed")
>             await asyncio.sleep(self._settings.cds_worker_poll_seconds)
>             continue                      # nothing acquired yet — nothing to release
>         await self._semaphore.acquire()
>         try:
>             claimed = await cds_store.claim_next_extraction(
>                 self._pool, lease_seconds=self._settings.cds_extraction_lease_seconds
>             )
>         except Exception:
>             self._semaphore.release()     # the only release on this path
>             logger.exception("cds_worker_claim_failed")
>             await asyncio.sleep(self._settings.cds_worker_poll_seconds)
>             continue
>         if claimed is None:
>             self._semaphore.release()     # unchanged
>             await asyncio.sleep(self._settings.cds_worker_poll_seconds)
>             continue
>         task = asyncio.create_task(self._run_claimed(claimed), name=f"cds-run-{claimed.id}")
>         self._running_tasks.add(task)
>         task.add_done_callback(self._on_task_done)   # releases on the success path
> ```
>
> Each path releases exactly once, the sweep failure is handled before any acquire, and the
> `try` around the claim is narrow enough that no other statement can throw inside it.
>
> Verified in review: `CancelledError` is a `BaseException` on Python 3.12, so `except
> Exception` does **not** catch it and `stop()`'s cancellation still propagates correctly;
> `Semaphore.acquire()` is cancellation-safe. One residual, accepted: the two statements between
> `acquire()` and `add_done_callback` (`create_task`, `set.add`) are unguarded, so a failure
> there would still leak a permit — near-impossible in practice, and now loud rather than silent
> thanks to the `_loop_task` done-callback. Not worth further machinery.

**Regression risk.** Low. No test covers `Poller._loop` (grep `tests/` for `Poller` /
`_loop`). This is a bug worth keeping fixed — a small test that makes
`claim_next_extraction` raise once and asserts the loop keeps polling would earn its place.

---

### [Z-01] A partially-successful extraction is recorded as a total failure

- **Category:** bug / honesty · **Location:** `app/cds/batch_run.py:186-201`
  (`store_domain_packets`), `app/cds/calling.py:364-382` (`_store_packet`),
  `app/cds/engine.py:427-430` and `:219-232` (`_finish_failed`)
- **Confidence:** CONFIRMED — every link in the chain read directly.

The per-domain store loop has **no exception isolation**:

```python
outcomes: dict[str, DomainOutcome] = {}
for domain_id in requested_domains:
    outcomes[domain_id] = await _build_and_store_domain_packet(...)   # no try/except
return outcomes
```

and the only exception `_store_packet` converts into a per-domain failure is a validation error:

```python
try:
    async with pool.acquire() as conn, conn.transaction():   # own transaction per domain
        record = await cds_store.insert_packet(...)
except cds_store.PacketValidationError as exc:               # <-- the ONLY one caught
    return DomainOutcome(domain_id, None, None, len(flags), str(exc))
```

Letting `LeaseLostError` through is deliberate and documented. But `insert_packet` also raises
`CdsStoreError` (unknown manifest version) and its `INSERT … RETURNING` is unwrapped, so any DB
error escapes too. Anything that escapes lands in `run_extraction`'s last-resort handler:

```python
except Exception as exc:  # noqa: BLE001 -- last-resort finalizer, never leave the row `running`
    logger.exception("cds_engine_run_failed", extraction_id=str(extraction.id))
    await _finish_failed(pool, extraction.id, "engine_error", str(exc))
    return
```

and `_finish_failed` writes `status="failed"` with an `error_code`/`error_message` **and no
`validation_summary`** — no domain breakdown at all.

**Failure scenario.** A 13-domain extraction. Domains 1-11 build and commit their packets, each
in its own independent transaction, so they are already durable. Domain 12 hits a transient DB
error inside `insert_packet`. The exception unwinds the loop, domain 13 never runs, and the
extraction row is stamped `failed` / `engine_error`. The permanent record now says the run
failed outright — while 11 domains' worth of correct, committed packets sit in the database, and
the tokens spent producing them are already paid for. A rerun re-extracts all 13 at full cost.

**Resolves the reviewer's open question, and it makes the defect worse, not better.** The review
screen's packet query (`_DOCUMENT_PACKETS_SQL`) selects the latest packet per domain *"regardless
of extraction outcome or active flag"* — so those 11 packets **do** still render. The admin sees
a populated review screen underneath a header that says the extraction failed. The data is not
lost; the *record of what happened* is wrong, and the screen contradicts itself.

**This is the same contradiction R-01 describes, from the other end.** R-01 is the display
symptom (one extraction's status shown over mixed-generation packets); Z-01 is a cause that
manufactures it. Fixing R-01 alone would make the screen honest about the mixture while the
extraction row still lied.

**Fix.** Isolate per domain, mirroring the pattern already used for `PacketValidationError`:
catch `Exception` inside the loop body, re-raise `LeaseLostError` (whose propagation is
intentional — the run is doomed and must stop), and convert anything else into a failed
`DomainOutcome` for that domain only. The loop then completes, `run_extraction` finalizes
normally with a real per-domain `validation_summary`, and the record matches reality.

**Regression risk.** Low. The change is confined to the loop body and preserves the two existing
escape behaviours (`LeaseLostError` propagates; `PacketValidationError` already becomes a
`DomainOutcome`). `tests/app/cds/test_batch_run.py` exists (186 lines) and should be checked for
an assertion that a store failure aborts the whole run — if one exists it encodes the current
behaviour and must move. This is honesty-critical and worth a test pinning "one domain's store
failure leaves the other domains' outcomes intact."

---

### [E-01] The images-only call describes a page mapping for a PDF it never sends

- **Category:** bug / honesty · **Location:** `app/cds/calling.py:109-139`, `:142-206`; `app/cds/routing.py:179-235`, `:238-281`, `:284-338`
- **Confidence:** CONFIRMED structurally (full call chain read). Downstream *model* behavior not live-verified.

`_run_call_once` builds `page_map` from this batch's padded routing window and passes it to
`_build_prompt` **unconditionally** — even though `_call_evidence` may have just set
`call_bytes = None`:

```python
if clusters:
    physical_pages = [p for start, end in clusters for p in range(start, end + 1)]
    narrowed_bytes, page_map = await cds_pdf.narrow_document(pdf_content, physical_pages)
    call_bytes, narrowed = narrowed_bytes, True
else:
    call_bytes, page_map, narrowed = pdf_content, None, False

call_bytes, image_pngs, form_marks_note = await _call_evidence(...)   # may null call_bytes
prompt = _build_prompt(..., page_map=page_map, ...)                    # stale page_map
```

```python
if form_mark_pages:
    call_bytes = None       # no PDF is sent at all — only PNGs
```

`_page_note` then emits, from that stale map:

> *"This document is a NARROWED SUBSET … position 1 = original page 38, position 2 = original
> page 39 … Cite the ORIGINAL physical page number from this mapping."*

But the images actually sent come from `hit_pages = sorted(set(grid_pages) | set(form_mark_pages))`
(`routing.py:274`) — computed **independently** of `clusters`, ranked by density and truncated
at `_FORM_MARK_MAX_PAGES = 4`. Nothing aligns the two.

**Failure scenario.** An AcroForm CDS PDF (the repo's worked example is UGA) with a boolean
batch whose padded window spans 7 pages while the grid occupies pages 40-43. `page_map`
positions 1-7 map to pages 38-44; the 4 images sent are pages 40-43. The model — following the
position-citing behavior the module's own docstrings call the majority real-world case — cites
"position 1" meaning the first image it saw (page 40). `resolve_cited_page` maps
`page_map[1]` → page 38. That is a *real page in the document*, so the citation is **not
dropped** — it is **silently mis-resolved**, and `metric.evidence.page_number` ends up pointing
at a page the model was never shown for that claim.

`excerpt_on_cited_page` would be the safety net, but it only raises a `warning`, not a block,
and an AcroForm checkbox region often has little confirming text either way.

**Fix.** Return the real rendered page list out of `_call_evidence` (`_c7_supplementary_images`
already computes `hit_pages`). When `call_bytes is None`, build the page-numbering prompt from
`{i+1: page for i, page in enumerate(image_pages)}` instead of the narrowed `page_map`, and
have `remap_findings` resolve against that same image-page map.

**Regression risk.** Low — path is scoped to `form_marks_note=True`. `_form_mark_pages` and
`_c7_supplementary_images` are unit-tested in isolation and unaffected. **No test currently
covers the combined page_map/prompt wiring for this path** (`grep -rn "form_marks_note" tests/`
→ only the two isolated tests), so add one asserting the prompt's mapping text matches
`hit_pages` when `call_bytes is None`. This is honesty-critical — it earns its test.

---

### [R-01] The review header attributes mixed-generation data to a single extraction

- **Category:** honesty · **Location:** `app/cds/service_review.py:317-329`; root cause `adapters/cds_admin_queries.py:168-185`
- **Confidence:** CONFIRMED.

The two queries feeding the read model have different granularity:

```sql
-- extractions: whole document, newest first
SELECT id, …, extractor_version, model_id, queued_at, finished_at, …
FROM cds_library.cds_extractions WHERE document_id = $1 ORDER BY queued_at DESC
```
```sql
-- packets: latest PER DOMAIN, regardless of which extraction produced it
SELECT DISTINCT ON (domain_id) domain_id, extraction_id, status, is_active, created_at, …
FROM cds_library.cds_domain_packets WHERE document_id = $1
ORDER BY domain_id, created_at DESC
```

The packets query's own comment states the premise: *"a document mid-review may have several
extraction attempts per domain."* And `_current_edits:117` independently relies on it, keying
extraction id **by domain**. Yet the service does:

```python
extraction = ReviewExtraction(
    id=raw.extractions[0].id, status=raw.extractions[0].status,
    extractor_version=raw.extractions[0].extractor_version,
    model_id=raw.extractions[0].model_id,
    finished_at=raw.extractions[0].finished_at,
    error_code=raw.extractions[0].error_code,
    counts=_aggregate_counts(raw.domains),      # across ALL domains
) if raw.extractions else None
```

`raw.extractions[0]` is merely the most recently **queued** run.

**Failure scenario.** Document extracted by `E1` (13/13 domains, model A). Admin reruns only
the `admission` domain → `E2` finishes with a different model or version. `ORDER BY queued_at
DESC` makes `extractions[0] = E2`. The header now renders **E2's** id, status, model,
extractor version, finish time and error code beside **counts summed over 12 domains from E1
plus 1 from E2**. The admin approves believing one named model produced all 394 values.

Worse, all reachable: `E2` still `running`/`failed` → header reads failed while 12 domains show
good E1 data; or `E2.error_code` surfaces as a document-level error that applies to one domain.

This is the review screen's most load-bearing provenance claim, and it can be wrong.

**Fix — preferred (per-section provenance).** `ReviewSection` already carries `domain_id`;
`DomainPacketSummary` already carries `extraction_id`. Surface extraction identity per section,
and reduce the document-level object to what is genuinely document-wide. Where all domains
share one extraction — the common case — the UI collapses to today's single line, so the normal
screen is unchanged.

**Fix — minimum honest change.** Select the header extraction from
`{d.extraction_id for d in raw.domains}` rather than `[0]`; if that set has >1 member, mark the
header mixed (`is_mixed_generation: bool`, `model_id=None`) instead of naming one.

Either way, `_aggregate_counts` must stop being presented as one named run's output.

**Regression risk.** `ReviewExtraction` is a wire model consumed by `types.ts` and rendered in
`ReviewHeader.tsx`. The minimum fix is additive (one optional field) and safe. Per-section
provenance changes the section shape and needs a coordinated frontend change. **No DB change.**

> **Hard constraint on the preferred fix — verified.** `extraction.status` cannot simply move
> to the sections. `frontend/src/features/cds-admin/review/document-status.ts:21-32`
> (`documentStatus`) takes `extraction: ReviewExtraction | null` and branches on
> `isNonTerminalExtractionStatus(extraction.status)` *first*, before any document flag, to
> return `"processing"`; it also uses `extraction?.status === "failed"`.
> `ReviewHeader.tsx:36-37` calls it and separately computes
> `running = Boolean(extraction && isNonTerminalExtractionStatus(extraction.status))`.
> So a per-section refactor **must keep a document-level `status`** (the natural definition
> being "non-terminal if any contributing extraction is non-terminal") or must update
> `document-status.ts` and `ReviewHeader.tsx` in the same change. Splitting provenance without
> this would silently break the header's processing/failed chip.
>
> **Test exposure — verified:** `grep` for `ReviewExtraction` / `extraction.` in
> `tests/app/cds/test_service_review.py` and `test_service_review_packet.py` returns **nothing**.
> The backend shape is entirely unpinned, so the backend change breaks no test — which cuts
> both ways: there is also nothing to catch a mistake. Given this is an honesty fix, add an
> assertion covering the mixed-generation case.

---

### [A-01] `_activate_untouched` silently reverts a concurrently re-extracted domain

- **Category:** bug (race) · **Location:** `app/cds/service_review_approve.py:390-403`, called `:444-446`; snapshot built `:537`
- **Confidence:** mechanism CONFIRMED by code read; the concurrent trigger was not exercised live.

`_activate_untouched` walks the `by_domain` snapshot captured **before** the write phase and,
for every domain with no pending edit, calls
`cds_store.activate_packet(conn, extraction_id=UUID(domain_summary.extraction_id), domain_id=…)`
with that stale id. `activate_packet` (`adapters/cds_store.py:485-522`) unconditionally
deactivates whatever is currently active and activates the given extraction — **no
compare-and-swap.**

**Failure scenario.** Document D is active with a pending `active_update` (satisfies
`_require_reviewable`, which only checks that a correction *exists*, not that it *finished*).
Admin A opens review — snapshot has `admissions` → `E1` — and edits a metric in `enrollment`.
Concurrently the poller finishes the `active_update` extraction `E2` for `admissions` and
activates its packet. A's approve, already in flight with the stale snapshot, reactivates `E1`
over `E2` — discarding the fresh re-extraction with no error, no distinguishing log, and an
audit row that mentions only the `enrollment` edit. The reverted domain is invisible.

**Fix.** Either (a) re-read each untouched domain's current `extraction_id` inside the write
transaction and no-op when it already matches (idempotent activation), or (b) give
`activate_packet` an expected-current guard and raise `CdsStoreError`/`CdsAdminConflictError`
on mismatch, forcing a retry against fresh state.

**Regression risk.** Low-medium. The fix only needs to make the common case a true no-op — which
it already effectively is. Only the racing path changes, from silent clobber to skip/error.

---

### [F-04] After a batch is processed, newly added files can never be queued

- **Category:** bug / ux · **Location:** `frontend/src/features/cds-admin/upload/useBatchUpload.ts:67,260`, `BatchActionBar.tsx:50-60`, `cds-upload-page.tsx:97-102`
- **Confidence:** CONFIRMED.

```ts
const isProcessed = hasTriggeredProcess || committedRows.length > 0;
```

`hasTriggeredProcess` is set once and never reset. `committedRows.length > 0` is true forever
after any file is queued — a row's status only ever moves *to* `committed`, never away.

```tsx
{isProcessed ? (isBatchComplete ? <Button>Open coverage</Button> : null)
             : (<Button disabled={readyCount === 0}>Process all (…)</Button>)}
```

Meanwhile `cds-upload-page.tsx:97-102` renders `FileDropZone` unconditionally — it is never
hidden or disabled once processed — and dropping a file stages an ordinary new row.

**Failure scenario.** Admin uploads 3 files, clicks Process all, then drops a 4th (the strip
drop zone is right there) because they forgot one. It uploads fine and can reach `matched`.
But `isProcessed` is permanently true, so **"Process all" never reappears** — including after a
full reload of the same `?batch=` URL, since `committedRows.length > 0` is re-derived from
server state. The 4th file has no path to extraction from this screen at all.

**Fix.** Drive the button off *current readiness*, not batch history: show "Process all (N)"
whenever `readyCount > 0`; switch to "Open coverage" only when
`readyCount === 0 && committedRows.length > 0 && isBatchComplete`.

**Regression risk.** Medium — this is the screen's core state machine. There is **no
`useBatchUpload.test.ts`** (only the pure helpers are tested), so the single-pass happy path is
unpinned. Add coverage for both the single-pass terminal state and the add-after-process case
before changing it.

---

### [F-03] Per-file skip reasons are fetched and thrown away

- **Category:** error-handling · **Location:** `useBatchUpload.ts:250-254`, `hooks.ts:140-158`; backend `app/cds/service_ingest.py:486,510`
- **Confidence:** CONFIRMED.

The backend distinguishes two skips:

```python
skipped.append(ProcessSkippedItem(file_id=…, reason=f"status is {row['status']!r}"))   # :486
skipped.append(ProcessSkippedItem(file_id=…, reason=str(exc)[:200]))                   # :510
```

The client discards both:

```ts
function triggerProcess() {
  if (!batchId) return;
  setHasTriggeredProcess(true);
  processBatchMutation.mutate(batchId);   // response never read
}
```

`useProcessBatch` only invalidates caches on settle; it never reads `data.queued`/`data.skipped`.
A row whose queuing *raised* keeps its pre-process status (`matched`/`replaces_existing`), which
falls through `stagingReason`'s `default: return { text: "", linkedDocumentId: null }` — **no
reason text at all**.

**Failure scenario.** Process all is clicked. One file's queuing throws server-side (transient
DB error, a race with another admin editing the same school-year). It returns still showing a
ready-looking `matched` chip with an empty reason line — indistinguishable from "about to be
queued" — while every other row has moved on to the document-status vocabulary. The admin has
no signal it was dropped, **and per F-04 there is no way to retry it from this screen.**

**Fix.** Read the resolved `ProcessResult.skipped` and render `reason` inline for any row whose
`file_id` appears with a non-`"status is…"` reason (the status case is already implied by the
row's own chip). At minimum, a page-scoped toast: "N file(s) could not be queued."

**Regression risk.** Low-medium — touches `useBatchUpload`'s return shape plus
`stagingReason`/`StagingStatusCell`. Nothing exists to break; this is a data-completeness path
and warrants a test.

---

### [F-01] Row-scoped failures surface twice, against the written rule

- **Category:** error-handling / ux · **Location:** `hooks.ts:94-138`, `hook-utils.ts:9-12,33-49`, `useBatchUpload.ts:169-217`
- **Confidence:** CONFIRMED.

`hook-utils.ts:9-12` states the contract:

> *"Row-scoped failures (a single upload row, a single metric) are never routed through this —
> those render inline in the row per DESIGN.md law 3; this is for page- and action-scoped
> failures only."*

`specs/cds-pipeline/DESIGN.md:255-256`:

> *"Row-scoped failure → inline, in the row's status cell … **Never a toast (law 3)**."*

But `useCreateUpload` wires it unconditionally:

```ts
onError: (error, _input, _snapshot, context) => { handleCdsError(error, context); },
```

and `useBatchUpload` independently renders the row inline via `markEntryFailed`. Both fire from
the same rejected promise.

**Failure scenario.** An upload fails (network blip, 5xx, a 413 per F-02, a 422 on an empty
file). The row correctly shows the specific reason inline — and simultaneously a generic
top-of-page toast says "That action failed. Please try again.", telling the admin less than the
message already next to it.

Note the asymmetry: failed `PATCH`/`DELETE` have **no** inline surface at all, so for those the
toast is the only signal — a separate, smaller gap.

**Fix.** Suppress the *toast* on `useCreateUpload` — but **do not delete its `onError`
wholesale.** `handleCdsError` (`hook-utils.ts:31-48`) does two things, and only one of them is
the defect:

```ts
if (error.kind === "unauthorized") {
  void context.client.invalidateQueries({ queryKey: authQueryKey });   // KEEP THIS
}
toast.error(cdsAdminErrorMessage(error));                              // drop for row-scoped
```

The 401 branch is what makes `RequireAuth` redirect to login instead of the app quietly failing
every request. Remove the handler entirely and an admin whose session expires mid-upload gets
"Could not upload this file." inline on every row and **is never redirected** — strictly worse
than the double-toast this finding is about. Narrow the handler (or pass a "row-scoped" flag
that suppresses only the toast) rather than dropping it.

For `usePatchUploadRow`/`useDeleteUploadRow`, either keep the toast and correct the
`hook-utils.ts` comment that claims they're excluded, or add an inline affordance and drop the
toast. **Do not leave the comment contradicting the code.**

**Regression risk.** Low. `useCreateUpload`'s only other consumer is `addFiles`, which has full
failure handling. No test pins this.

> **Adjudicated in review round 3 — a reviewer challenged this fix and was wrong.** The
> objection was that the create path *depends* on the toast, so removing it alone would silently
> swallow upload failures. Verified against the code: it does not. `useBatchUpload.ts`'s
> `.catch()` on the create promise calls
> `markEntryFailed(current, clientId, requestErrorMessage(error))`, which sets
> `phase: "request-failed"` and `requestError` (`staging-model.ts:89-99`), and
> `stagingReason` renders it inline: `entry.requestError ?? "Could not upload this file."`
> (`staging-model.ts:191`). The inline affordance is complete and independent of the toast.
> The reviewer had read the comment near `useBatchUpload.ts:187` — *"`useDeleteUploadRow`'s
> built-in `onError` still surfaces the failure toast"* — which documents the **delete-cleanup**
> mutation on the lost-abort-race path, not `useCreateUpload`.
>
> **The valid half of the objection:** that comment records a real dependency for the *delete*
> path. So the optional second half of this fix — dropping the patch/delete toasts — must not be
> done without first adding an inline affordance there, or the lost-abort-race cleanup failure
> becomes genuinely silent. **The create-path change is safe on its own; the patch/delete
> change is not.**

---

### [U-02] Narrow-viewport layout can push the review panel out of reach

- **Category:** responsive · **Location:** `frontend/src/pages/cds-review-page.tsx:312-346`
- **Confidence:** **UNVERIFIED** — reasoned from CSS Grid semantics, not browser-confirmed. See §6.

```tsx
<section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
  <ReviewHeader …/>
  <div className="grid min-h-0 flex-1 grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
    <PdfPageViewer className="min-h-0 border-r" …/>
    <ReviewPanel className="min-h-0" …/>
  </div>
</section>
```

The `lg:`/`xl:` variants set **column** templates only. Below `lg:` (<1024px) it falls back to
`grid-cols-1`, stacking the panes as two **rows**. No `grid-rows-*` is set at any breakpoint, so
rows use `grid-auto-rows: auto` — sized to content, not bounded by the container's `flex-1
min-h-0` box. The grid div has no `overflow-y-auto`; only the ancestor `<section>` has
`overflow-hidden`. Overflow is therefore **clipped with no scroll path to it.**

**Failure scenario.** Open the review page under 1024px (tablet portrait, or a narrow window).
`PdfPageViewer`'s page image can consume the visible height and push `ReviewPanel` — the actual
reviewing surface — below the fold with no way to scroll to it. The admin cannot review or
approve at all.

**Fix.** Give the grid a bounded row template at the base breakpoint:
`grid-rows-[minmax(0,1fr)_minmax(0,1fr)] lg:grid-rows-none`, letting each pane's existing
internal scroll container do the rest — the same pattern already used on the column axis.

**Regression risk.** Low — additive CSS. jsdom computes no layout, so no test exercises this.

**Verify before fixing (§6).**

---

## 5. MEDIUM and LOW

### [C-01] The coverage grid silently truncates at 50 rows, and the counters then lie

- **Sev:** MEDIUM today, **HIGH the moment CDS activity exceeds 50 schools** — see the scale note.
- **Category:** honesty / ux · **Location:** `adapters/cds_admin_queries.py:341-391`
  (`coverage_grid`), `frontend/src/pages/cds-coverage-page.tsx`,
  `frontend/src/features/cds-admin/coverage/CoverageGrid.tsx`
- **Confidence:** CONFIRMED — backend slicing, frontend absence, and current scale all verified.

The backend computes the counters over the **full** filtered set and only then truncates:

```python
counters = _counters_from_groups(filtered, years)          # full set
ordered  = sorted(filtered.values(), key=lambda r: r.name)
...
page = ordered[offset : offset + limit]                     # <-- sliced to `limit`
return CoverageResult(years=years, rows=page, counters=counters, total=len(ordered))
```

`limit` defaults to **50** (`coverage_grid(..., limit: int = 50)`), and find mode caps
`_UNLISTED_SCHOOLS_SQL` at the same value.

The API *does* support paging — `frontend/src/api/cds-admin/coverage.ts` forwards
`filters.limit` / `filters.offset` when present. **But nothing ever sets them.** In
`cds-coverage-page.tsx` the only use of the response's `total` is the idle search prompt
(`Search ${coverage.data.total.toLocaleString()} schools by name…`), and `CoverageGrid.tsx`
has no pagination, "load more", or "showing N of M" control at all (its only `offset` matches
are Tailwind `ring-offset-*` classes).

**Failure scenario.** Once a scope or filter matches more than 50 schools, the grid renders the
first 50 alphabetically and silently drops the rest — while `CoverageCounters`, computed over
the whole set, displays something like *"80 schools · 3 needs review."* If those 3 needs-review
rows sort after the 50th school by name, the admin sees a counter telling them work exists,
cannot find it anywhere on screen, and has no control that would reveal it. The most likely
reading is "the counter is stale" — so unreviewed CDS data stays unreviewed indefinitely.

That is the honesty rule failing toward the admin, and through them toward students: the screen
asserts a total it is not showing.

> **Scale note — measured, be honest about this.** Only **11** schools currently have ≥1
> `cds_school_years` row, so the grid renders ~11 rows against a 50 cap: **the truncation is
> unreachable on today's data.** It is not hypothetical either — the catalog holds 2,746
> schools and onboarding more coverage is this tool's entire purpose, so the cap is crossed by
> normal success. Rated MEDIUM because it cannot fire now; treat as HIGH before any bulk
> onboarding.

**Fix — smallest thing that works.** Do **not** build a pagination system. The honesty defect is
the *silence*, not the cap. Minimum: when `rows.length < total`, render a truncation notice
stating how many are shown of how many match, so the counters and the grid stop contradicting
each other. If a way to reach the rest is wanted, the API already accepts `limit`/`offset` — a
"load more" that raises `limit` is a few lines and needs no new backend work.

**Regression risk.** Low and additive — a conditional notice plus, optionally, one piece of
state. `CoverageResult.total` is already on the wire and already consumed, so no contract
change.

- **Sev:** MEDIUM · **Location:** `adapters/cds_store.py:145-204` (`insert_document`), `app/cds/service_ingest.py:460-511` (`process_batch`)
- **Confidence:** constraint absence **CONFIRMED live**; race window CONFIRMED by code read.

Live constraints on `cds_library.cds_documents`: PK `(id)`, UNIQUE `(id, school_year_id)`, five
CHECKs, one FK. **No unique constraint on `pdf_sha256`.** `id` is `GENERATED ALWAYS AS
IDENTITY`, so every racing INSERT gets a fresh id.

`insert_document` dedupes with a plain `SELECT … WHERE school_year_id = $1 AND pdf_sha256 = $2`
before inserting — check-then-insert with no `FOR UPDATE` and no upsert. `process_batch` reads
all rows once and loops with no row lock or advisory lock; `process_batch_route` adds no
idempotency wrapper.

**Live corroboration.** Six sha256 values currently have >1 row across 28 documents. One is a
true violation: `school_year_id=4036` holds sha `22d3aab2…` twice (ids 2029, 2032). The others
span different school-years, which is legitimate (one PDF covering several years).

> **Caveat, stated honestly:** ids in the 2000s fall in the range the cutover cleanup identified
> as test rows, and both rows in the violating group are invalidated. They may have been written
> by test tooling that bypasses `insert_document`. **The missing constraint is the confirmed
> finding; the live rows corroborate rather than prove the race.**

**Fix — needs a decision, do not guess.** The right uniqueness key is not obvious.
`UNIQUE (school_year_id, pdf_sha256)` matches the observed legitimate pattern but must reconcile
with re-upload-after-invalidation, which currently keys off `invalidated_at`. A **partial**
unique index (`… WHERE invalidated_at IS NULL AND superseded_at IS NULL`) is the likely shape.
Independently, add an app-level guard: `pg_advisory_xact_lock` on `batch_id`, or flip rows via
`SELECT … FOR UPDATE SKIP LOCKED`.

**Blocker:** `cds_library` is not managed by this repo's migrations (see **W-06**). Adding an
index requires deciding where that DDL lives. **Resolve W-06 first.**

### [N-02] A lease-renewal error stops renewal silently and masks the real crash
**MEDIUM** · `app/cds/jobs.py:104-107`, `:109-129`. Two distinct defects in one place.

```python
finally:                                     # :104
    keeper.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await keeper                         # :107 — re-raises any NON-CancelledError
```
```python
while True:                                  # :117
    await asyncio.sleep(interval)
    try:
        async with self._pool.acquire() as conn:
            await cds_store.renew_lease(conn, extraction_id=…, lease_seconds=…)
    except cds_store.LeaseLostError:         # :126 — the ONLY exception handled
        logger.warning("cds_worker_lease_lost", …); lease_lost.set(); return
```

1. **Renewal stops silently.** `_renew_lease` catches only `LeaseLostError`. A transient
   failure — pool-acquire timeout, connection reset — escapes, the keeper task dies, and the
   lease is **never renewed again**. `lease_lost` is never set, so `engine.run_extraction`
   keeps making (billable) model calls unaware. The lease expires and the next
   `sweep_expired_leases` fails the row out from under a run that is still executing. This is
   the more serious half.
2. **The real crash gets masked.** Per Python's `finally` semantics, the `await keeper` at
   `:107` re-raises the keeper's stored exception, **replacing** whatever
   `engine.run_extraction` raised. `_on_task_done` then logs `cds_worker_task_crashed` with the
   renewal error instead of the true cause — or reports a crash for a run that actually
   succeeded.

**Fix.** In `_renew_lease`, catch `Exception` around the renewal, log it, and continue the loop
(a single failed renewal is survivable; the interval is a third of the lease window precisely to
tolerate one). Keep `LeaseLostError` as the only path that sets `lease_lost` and returns.

Separately, stop the keeper's exception from replacing the run's own at `:106`. **Suppress, but
never silently** — a bare broadened suppression would swallow a genuine keeper bug with zero
trace, trading one blind spot for another:

```python
finally:
    keeper.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await keeper
    # ^ if the keeper failed for any other reason, log it here rather than
    #   letting it propagate out of `finally` and mask run_extraction's exception:
    if not keeper.cancelled() and keeper.exception() is not None:
        logger.error("cds_worker_lease_keeper_failed",
                     extraction_id=str(extraction.id), error=str(keeper.exception()))
```

With the first change in place a keeper exception should be unreachable, so this is the
belt-and-braces half — but it is the half that makes a future regression visible.

**Regression risk.** Low — both changes only affect paths that currently lose information.

---

### [A-02] A concurrently resubmitted edit is deleted unapplied
**MEDIUM** · `service_review_approve.py:528`, `:544`. `_clear_pending_edits` deletes by
`metric_ref` membership in a snapshot taken before the write phase. `save_metric_edits` uses
`ON CONFLICT (document_id, metric_ref) DO UPDATE`, so a second admin re-editing the *same* ref
mid-approve keeps the same key and is deleted — never read, validated, or applied. The
docstring reasons about a *new* ref surviving but not an **update-in-place**.
**Fix:** scope the DELETE to `metric_ref` **and** the snapshot's `edited_at`/version, extending
"new ref survives" to "changed ref survives". Low risk; the non-racing path still matches.

### [T-202] `promote_candidate_document` never checks its rowcount
**MEDIUM** · `adapters/cds_store.py:709-728`. No `result` is even captured. This is the write
that activates a document for students (`active_document_id = $2`) — the highest-stakes write
in the file. A bad/stale `school_year_id` silently no-ops while
`service_review_approve.py:448` proceeds as if promotion succeeded. The sibling
`retire_school_year` (`:731-750`) captures and checks `"UPDATE 0"`.
**Fix:** match the sibling — capture and raise `CdsStoreError`. Only currently-silent no-ops
start raising.

> **Regression check — done, both callers are safe.**
> `tests/app/cds/test_service_review_edit_flags.py:248-256` monkeypatches
> `cds_store.promote_candidate_document` with a stub that appends to a `writes` list, so it
> never executes the real SQL and is unaffected by a rowcount check.
> `scripts/verify_cds_adapters.py:343-346` calls the real function with `school_year_id=slot.id`
> for a slot created earlier in the *same* transaction, so the row always exists and the new
> raise cannot fire. **No caller depends on the silent no-op.**

### [T-201] `reject_candidate_document`'s second UPDATE discards its result
**MEDIUM** · `adapters/cds_store.py:678-706`. The first UPDATE checks `"UPDATE 0"`; the second
(clearing the school-year's candidate pointer) does not. The sibling `discard_active_document`
(`:753-797`) checks both. A non-existent `school_year_id` returns success with the slot
bookkeeping silently skipped. Also note the `CASE` guards only `candidate_document_id` —
`last_action_kind = 'rejected'` is set unconditionally on whatever row matches.
**Fix:** check the second result too.

### [R-02] A rerun mid-save silently discards an edit behind a 200
**MEDIUM** · `app/cds/service_review.py:353-394`. The extraction id stamped at `:391` comes
from a read taken at `:353`, before the transaction opens at `:365`. If a rerun commits in that
window the row is written already-superseded, and `_current_edits` correctly filters it out —
so the endpoint returns **200 with a review body that does not contain the edit**. The filtering
is right; the silent success is not.
**Fix:** after commit, diff the refs written against the refs in the returned review and raise
`CdsAdminConflictError` (409) naming the superseded ones. The review body is already in hand at
`:404`.

### [I-02] PATCH on a `duplicate` row echoes success but changes nothing
**MEDIUM** · `app/cds/service_ingest.py:284-346`, esp. `:320-328`. `duplicate_of` is read from
the row's original detection JSON and passed unconditionally into `_resolve_status`, which
returns `"duplicate"` regardless of the new school/year. The UPDATE still writes the new values
and returns 200 with them reflected — but the status never changes and `_READY_STATUSES`
(`{"matched","replaces_existing"}`) will never pick the row up.
**Fix:** reject the PATCH on a `duplicate` row with `CdsAdminValidationError`, mirroring the
existing refusals for `committed` and no-content rows at `:302-319`.

### [F-02] Client upload cap ≠ server upload cap
**MEDIUM** · `staging-model.ts:112` = `50 * 1024 * 1024` (52,428,800) vs
`config/settings.py:394` `cds_upload_max_bytes = 50_000_000`, enforced at
`api/routes/cds_admin.py:142-145`. A file between 50,000,001 and 52,428,800 bytes passes client
validation — and `FileDropZone.tsx:93` says "up to 50 MB each" — then 413s with *"file must be
no larger than 47 MiB"*.
**Fix:** set the client constant to `50_000_000` and update the one test
(`staging-model.test.ts:65-67`). Note the server's own message divides by `1024*1024`, printing
"47 MiB" for a 50 MB cap — **fix that message too**, it is actively confusing.

### [U-03] "Approve with 1 blocking flags"
**MEDIUM** · `ApproveAnywayDialog.tsx:84` (title) and `:145` (button). Neither pluralizes.
`ApproveBar.tsx:43,72` does it correctly a file over, and `CoverageCounters.tsx` documents the
house rule. This is the last screen before data reaches a student.
**Fix:** `` `Approve with ${count} blocking flag${count === 1 ? "" : "s"}?` ``.
**Note:** `cds-review-page.test.tsx:247,256` **asserts the buggy text as expected** and must be
updated in the same change.

### [M-01 → W-06] The `cds_library` schema is unreproducible from source control
**MEDIUM** · `grep -n "cds_library_app" scripts/setup_db.sql` → **zero matches**; that file only
creates `cds_library_reader`. The role, its grants, and every `cds_library` table's DDL exist
nowhere in this repo. The "INSERT/SELECT/UPDATE, no DELETE" claim lives only as prose in
`docs/DATABASE_GUIDE.md`.

**I verified it live and it is TRUE** — `cds_library_app` holds exactly INSERT, SELECT, UPDATE
on all 13 tables/views and **no DELETE anywhere**. But:

1. **A fresh environment cannot be provisioned from this repo.** This is a deploy blocker, not
   a style issue — and deploy (B6) is already the outstanding milestone.
2. There is no CI-checkable relationship between the code's schema assumptions and reality.
3. V-01's fix needs a home for `cds_library` DDL and is blocked on this.

**Fix.** Commit the `cds_library` schema and grant model to source control — either a
`deploy/seed/` schema file (one already exists for other objects) or a documented external
source of record referenced from `docs/DATABASE_GUIDE.md`. Preserve `LIVE-SCHEMA.md` (§1) as
the starting point. **Do this before V-01.**

### [W-02] `COUNSELLE_CDS_DATA_ENABLED` undocumented
**MEDIUM** · `config/settings.py:259`; absent from `.env.example` and all of `docs/`. Real and
code-read (`app/deps.py:111`, `app/graph.py:99`). `.env.example`'s own header promises it
documents every variable `config/settings.py` reads.
**Fix:** add the line with a comment. Purely additive.

### [E-02] A second, incomplete, dead PDF-narrowing implementation
**MEDIUM** · `domain/cds/pages.py:41-67`, `:277-293`, `:296-316`. Production imports exactly
five functions from this module; all real PDF I/O goes through `adapters/cds_pdf.py`.
`PdfError`, `PdfDocument`, `read_pdf_document`, `narrow_document`, `page_framing` are exercised
**only** by `tests/domain/cds/test_pages.py`.

Worse than ordinary dead code — the twin is **missing production-critical fixes**:
no AcroForm `doc.bake()` before slicing (the fix worth 326/350 findings on UGA); no
`garbage=4` compression (whose absence blew a write deadline on Caltech); no
slice-larger-than-source fallback. A developer could reasonably "fix" the domain-layer copy —
it sits in the honesty core and is well-tested — and ship nothing.
**Fix:** delete the five names and their four orphaned tests. Zero production call sites.

### [E-03] The stale-year detector's hardcoded ref has no tripwire
**MEDIUM** · `domain/cds/validators.py:181-202`, esp. `:187`. `year_consistency` — the only
defense against a document reporting the wrong academic year (the "Cornell-class" failure) —
looks up the literal `"identity.academic_year"`. If a future manifest edit renames or removes
that metric, `.get()` returns `None`, `_verified(None)` is `False`, the function returns `[]`:
**the detector silently stops firing** and no test catches it, because the existing tests use
hand-built synthetic packets.
**Fix:** one tripwire test asserting the ref exists in the real compiled manifest, in the shape
of `test_manifest.py`'s existing hash pin. This is the honesty carve-out — it earns its test.

### [I-03] Two oversized functions in `service_ingest.py`
**MEDIUM** · `create_upload` (~134 lines), `_commit_row` (~87 lines) vs the 50-line house limit.
`_commit_row` in particular contains **two independently-reasoned transactions** (pipeline pool,
then app pool) that are easy to misread as one atomic unit — the module docstring has to warn
about it explicitly.
**Fix:** extract `create_upload`'s detection block; split `_commit_row` at the existing
transaction seam. **As its own commit** — house rules forbid smuggling a refactor into an
unrelated change.

### [H-02] `jobs_route`'s `ids` list has no size cap
**LOW** · `api/routes/cds_admin.py:214-227`. Every other input is clamped
(`limit = min(max(limit,1), 200)`); `ids` is not. Superuser-gated, so exploitability is low —
this is a consistency gap.
**Fix:** cap and 422 past the limit.

### [A-03] The audit row can be lost after the substantive commit
**LOW (accepted risk)** · `service_review_approve.py:538-549`, `:569-595`. The audit write
happens on `app_pool` strictly *after* the `pipeline_pool` transaction commits. A crash between
them leaves a live, serving change with no `cds_audit_log` row — no record of who approved it
or under what override.
**Disposition:** this is a pre-existing consequence of the two-DSN/two-role split, not a defect
introduced here, and a real fix needs its own design (reconciliation job, or best-effort
write-ahead). **Recorded as accepted risk. No fix in this batch** unless a reviewer argues the
accountability gap is unacceptable.

### [Q-03] Two hot queries have no usable index
**LOW (measured fine today — do not fix yet)** · Verified against the live index list:

- `_DOCUMENT_EXTRACTIONS_SQL` filters `WHERE document_id = $1`. The only candidate index is
  UNIQUE `(id, document_id, manifest_version)` — leading column `id`, so **it cannot serve this
  predicate.** 77 rows today.
- `_DOCUMENT_PACKETS_SQL` filters `WHERE document_id = $1` with no `is_active` filter (by
  design — "regardless of … active flag"). The only `document_id`-leading index is **partial**
  (`WHERE is_active`) and therefore unusable here. PK is `(extraction_id, domain_id)`. 6,217
  packets at benchmark scale.
- `cds_documents.school_year_id` (a FK) has no index; `(id, school_year_id)` leads with `id`.

`_COVERAGE_SQL` was `EXPLAIN ANALYZE`'d at realistic scale (15.66ms). Per `CLAUDE.md`
("optimize only when something is actually slow"), **do not add indexes now.** Recorded so the
first person who sees the review screen get slow knows exactly where to look.

### Dead code — [F-05]/[W-04], [U-04]
**LOW** · `staging-model.ts:287` `committedFileIds` and `useBatchUpload.ts:301`
`UseBatchUploadResult` each have exactly one repo-wide hit: their own definition.
`cds-status.tsx:58-59,136-140` models `FlagSeverity = "info"`, which the backend can never emit
(`domain/cds/validators.py:33` is `Literal["error","warning"]`; all six `ReviewFlag(…)` sites
confirmed).
**Fix:** delete all three. Verify with `npm run build`, not `npm run typecheck` — per the repo's
own recorded gotcha, only the former catches removed-but-still-referenced symbols.
**Related, do NOT delete:** `metricFlagSeverity`'s binary fallback in `flag-queue.ts:22-29`
would mislabel an info-only metric if `"info"` were ever added. If `"info"` is dropped, this is
moot; if it is ever added, fix the fallback in the same change.

### Latent — [R-03], [R-04], [T-101]
**LOW, record only, do not fix.**
- **R-03** (`service_review.py:285-293`): a `metric_ref=None` flag can never be "addressed",
  only overridden. **Verified unreachable** — all six `ReviewFlag(…)` constructions pass an
  explicit ref. Add a one-line comment so whoever adds the first domain-level validator must
  decide. Re-open at MEDIUM if that happens.
- **R-04** (`service_review.py:296-337`): the read model is four independent non-atomic reads
  across two pools, so a concurrent approve can produce a briefly inconsistent screen. Inherent
  to the two-role split; cost of a real fix is high, impact is a stale screen the admin can
  refresh. It is the shared mechanism behind R-01 and R-02.
- **T-101** (`cds_store.py:162-169`): the dedupe query filters `invalidated_at IS NULL` but not
  `superseded_at IS NULL`. **Currently inert** — `superseded_at` is non-NULL on 0 of 28 rows, no
  trigger writes it, and no Python sets it. Fold into V-01's fix if that lands.

### Docs / scripts — [W-03], [W-05]
**LOW.** CLAUDE.md's doc map says "Index of all 32 ADRs"; there are 36 (0001-0036, no gaps),
including ADR 0036 — this feature's own founding record. Prefer dropping the number so it stops
drifting. `scripts/verify_cds_adapters.py:55` pins `_DEMO_MANIFEST_VERSION = "5.0.2"`, superseded
by `5.1.0`; harmless today because the demo runs inside a rolled-back transaction and
`insert_packet` does not validate manifest currency.

---

## 6. Verification still owed

Two findings should be confirmed in a real browser before their fixes land. Both are UI, both
are unverifiable in jsdom (no layout computation).

1. **U-02** (HIGH, `UNVERIFIED`) — load the review page for a real document, resize to ~768px,
   and check whether `ReviewPanel`'s flag bar and accordion are reachable. This decides whether
   U-02 is a real defect or a mis-read of the cascade.
2. **U-01** (CRITICAL, mechanism confirmed) — confirm Radix does not `stopPropagation` on
   non-Escape keys by opening the Reject dialog and pressing ⌘Enter. The missing guard is
   certain; this confirms exploitability end to end.

Everything else in this document is either CONFIRMED or explicitly labelled and scoped.

### Review history

**Round 1.** Three reviewers ran against the original document.
- *Accuracy* — 14/14 spot-checked claims TRUE, 0 false (one line range off by ~2).
  `VERDICT: READY TO IMPLEMENT`.
- *Dismissals/severity* — all 10 §7 "do not re-litigate" dismissals verified CORRECT, including
  the six honesty invariants, the jsonb-codec claim, and the no-`DELETE` claim.
  `VERDICT: READY TO IMPLEMENT`.
- *Coverage* — `VERDICT: NOT READY`. Found two real defects in `app/cds/jobs.py` the sweep had
  missed, plus one that did not survive verification.

**Applied after round 1:** added **N-01** (HIGH) and **N-02** (MEDIUM), both independently
re-verified before inclusion; N-01's semaphore-leak fix constraint was found during that
re-verification and is not in the reviewer's original report. Closed the proposed
`starved_retry` finding as a non-finding (§7). Added the verified `documentStatus`/`ReviewHeader`
constraint on R-01's preferred fix, and the verified regression checks for T-202's two callers.

**Round 2.** A reviewer re-verified `jobs.py` and both new fixes: 7/7 claims TRUE, N-02 SOUND,
**N-01 INSUFFICIENT** — `VERDICT: NOT READY`. It found an error in this document's own proposed
constraint:

- *"Move `acquire()` below the claim"* was **wrong and is now retracted.** It would claim a row
  and take its lease while holding no slot, then block waiting for one — the lease can expire
  before the run starts, starving other workers. The keeper task does not even exist at that
  point.
- *"Release in the except path"* was **under-specified.** `asyncio.Semaphore` is unbounded, so a
  release on a path that never acquired silently inflates the concurrency cap with no error.
- N-02's broadened suppression needed **logging**, or a genuine keeper bug disappears without
  trace.

**Applied after round 2:** N-01 now specifies the exact loop shape, with release guaranteed
exactly-once by mutually exclusive paths rather than by reasoning; N-02 now logs what it
suppresses.

A second round-2 reviewer swept the coverage screen — the last unexamined area — and returned
`VERDICT: NOT READY` with **C-01** (silent 50-row truncation with contradicting counters). Added
after independent verification, which also established the scale nuance the reviewer could not
see: only 11 schools currently have CDS activity, so the defect is latent today. Everything else
on that screen (URL-state round-tripping, the five distinct loading/error/empty states,
accessibility) was checked and found correct.

**Round 3.** A reviewer re-judged the rewritten N-01/N-02 fixes: semaphore balanced on all four
branches, `CancelledError` correctly not caught by `except Exception` on Python 3.12, `stop()`
semantics preserved, `keeper.exception()` safe, no tight-loop risk on repeated renewal failure,
and the masking scenario structurally eliminated. `VERDICT: READY TO IMPLEMENT`, one accepted
residual noted inline above.

Three further reviewers ran against the full document:
- *Accuracy of all round-1/2 additions* — 14/14 TRUE, 0 FALSE. `READY TO IMPLEMENT`.
- *Completeness (engine/batch_run/packet_build)* — `NOT READY`, found **Z-01**. Added after
  independent verification, which also resolved its open question: the review screen's packet
  query selects packets *"regardless of extraction outcome"*, so the orphaned packets **do**
  still render — making the contradiction visible on screen rather than hiding it, and tying
  Z-01 to R-01 as cause and symptom.
- *Solution correctness across all 15 fixes* — 13 SOUND, 0 WRONG, 0 OVER-ENGINEERED, **1
  INSUFFICIENT (F-01)** → `NOT READY`. It also confirmed independently that V-01 is genuinely
  blocked on W-06 (no base-table DDL or `cds_library_app` grant exists in any tracked SQL), and
  contributed the R-01-before-R-02 sequencing now recorded in §8.

**F-01 adjudication:** the reviewer's objection was **checked and rejected** — the create path's
inline error affordance is complete and independent of the toast (evidence recorded inline at
F-01). Its underlying concern was valid for the *delete* path only, and that constraint is now
recorded. The fix is unchanged for the create path.

**Applied after round 3:** added **Z-01** (HIGH); recorded the F-01 adjudication; sequenced Z-01
ahead of R-01 and R-01 ahead of R-02 in §8.

**Round 4 — confirmation.** Both dimensions that had blocked were re-reviewed:
- *Z-01's fix and residual completeness* — fix judged sound on all five checks: the
  `DomainOutcome(domain_id, None, None, 0, str(exc))` shape matches what the existing
  `PacketValidationError` handler already produces; `_overall_status` (`engine.py:208-216`) folds
  a `status=None` outcome into `"partial"`/`"failed"` regardless of cause; re-raising
  `LeaseLostError` preserves current behaviour exactly; the all-domains-fail case still runs
  through `_finalize_run` with a populated `validation_summary` rather than the blanket
  `engine_error` path; and the fix mirrors an idiom already accepted one layer up
  (`batch_run.py:59-93`). `tests/app/cds/test_batch_run.py` holds only two concurrency tests,
  neither pinning the current abort behaviour. `detect.py` swept, no new defect filed (recorded
  in §7). `VERDICT: READY TO IMPLEMENT`.
- *F-01 adjudication* — found for the rejection: removing the create-path toast alone would
  **not** make any failure invisible (the early `return` fires only on the delete-race branch),
  and the disputed comment does govern the delete-cleanup mutation. It contributed one genuine
  refinement: `handleCdsError` also invalidates the auth query on 401, so the handler must be
  *narrowed*, not deleted. `VERDICT: READY TO IMPLEMENT`.

**Applied after round 4:** F-01's fix rewritten to preserve the 401 auth-invalidate side effect;
`detect.py`'s year-confidence question recorded in §7 as checked-and-not-filed, cross-linked to
E-03.

---

## Status: all three review dimensions returned READY TO IMPLEMENT

| Dimension | Final verdict | Basis |
|---|---|---|
| **Factual accuracy** | `READY` | 28 claims verified across two passes, 0 false |
| **Completeness & severity** | `READY` | 10/10 dismissals stand; `jobs.py`, coverage screen, `engine.py`, `batch_run.py`, `packet_build.py`, `detect.py` swept; no unfiled defect |
| **Solution correctness** | `READY` | 15/15 fixes sound; sequencing corrected; every behaviour-changing fix checked against the test suites |

Four findings (**N-01, N-02, C-01, Z-01**) and three fix corrections (**N-01**'s loop shape,
**R-01**'s `documentStatus` constraint, **F-01**'s 401 side effect) were produced by the review
loop itself, each independently verified before inclusion. One reviewer objection was
adjudicated and **rejected** on evidence (F-01), with both sides recorded.

**This document is ready to implement. No code has been changed yet** — the working tree
contains only this plan and its schema snapshot.

---

## 7. Checked and found correct — do not re-litigate or "fix"

Recorded so reviewers don't re-derive them and so no fixer breaks working code.

**Honesty invariants from the post-ship hardening batch — all six CONFIRMED with line refs:**
1. Human-reviewed packets run the same `run_validators` gate as model extractions
   (`service_review_approve.py:335` vs `calling.py:416`); the old permanent `{}` is closed
   (`:379-381`).
2. Admin edits validate read-only *before* the transaction opens (`:262-346`, `:432-438`) and
   refuse on an error-severity flag without `override_flags` (`:344-345`).
3. Ungrounded identity routes to `needs_input`, never auto-fills (`service_ingest.py:211-231`,
   `detect.py:260-268`), pinned by `test_service_ingest_content_free_pdf.py`.
4. Pending edits are bound via `base_extraction_id uuid NOT NULL` (0016) and filtered on it
   (`service_review.py:91-122`).
5. Encrypted/unreadable uploads become per-file `error` rows, not 500s
   (`service_ingest.py:144-167`, `:489-510`), pinned by `test_service_ingest_unreadable_pdf.py`.
6. `active_update` correctly gates candidate promotion on `is_candidate`
   (`:447-456`, `:569-584`).

**Security / authz — clean.**
- All **14** routes gated by `current_superuser` at the router level (`cds_admin.py:48`) *and*
  redundantly per-route. Router included exactly once (`api/main.py:274`). No unguarded mount.
- All SQL in `cds_admin_queries.py` and `cds_store.py` is parameterized. The two f-string SQL
  constructions interpolate only a module-level constant
  (`HUMAN_REVIEW_EXTRACTOR_VERSION`), never request data.
- No `DELETE` against `cds_library` anywhere — consistent with the role's grants.
- Frontend routes and sidebar nav are `is_superuser`-gated (`AdminGate`, `AppSidebar.tsx:45-47`);
  a non-admin never sees a dead link. All three pages render `CdsUnavailable` on a 503.

**Wire contract — clean.** `types.ts` is a faithful field-for-field mirror of
`cds_admin_types.py` + `models.py`. No field-name, optionality, union-member, or status-value
drift. Query-param construction matches FastAPI's repeated-key parsing; the `JobsQuery` union
matches the route's "batch_id or ids, never both" 422 contract. `cdsAdminKeys`' documented
invalidation table matches every mutation's actual `onSettled` wiring.

**Do not "fix" these — they are correct:**
- **jsonb binding.** `counselle_db/db.py:33-39` registers jsonb/json codecs; `create_pool` wires
  them via `init=_init_connection`; `app/deps.py:126` builds the pipeline pool through it.
  Passing dicts to `jsonb` is right — adding `json.dumps` at call sites would **double-encode
  and corrupt data.**
- **`ExtractionRow.extractor_version` / `model_id` typed non-Optional.** Live schema confirms
  both are `NOT NULL`. Widening them to `str | None` would be wrong.
- **`H-03` (`require_json` on the bodyless process route).** Non-finding: `require_json` returns
  early when there is no body (`api/deps.py:60-65`) and the client sends a bodyless POST.
- **`H-01` (`page_image_route` → 404).** Non-finding: `fetch_document_for_extraction` raises
  `CdsStoreError` only on `row is None` (`cds_store.py:559-560`). Connection faults are asyncpg
  errors and still 500.
- **`H-04` (`str(exc)` in error responses).** LOW/non-actionable: messages are curated prefixes
  plus a PyMuPDF string; PyMuPDF reads an in-memory stream so no server path is involved; no SQL
  or DSN; audience is superuser-only.
- **`not_reported` claims dropping to `not_extracted`** — intentional, pinned by
  `test_packet_build.py::test_not_reported_claim_is_dropped_to_not_extracted`.
- **`_display_value`** correctly refuses to render unless `verified` *and* `reported`.
- **`save_metric_edits` resolves the domain server-side**, never trusting a client `domain_id`.
- **Edit audit rows are inside the same transaction as the edits** (unlike approve — see A-03).
- **`_commit_row`'s two-phase commit** is genuinely idempotent on retry — dedupe returns
  `is_duplicate=True` and the existing extraction is reused, so no double-billing.
- **`scripts/_cds_crash_test_worker.py`** is not a leaked test file — it is the helper
  `verify_cds_engine.py:220` subprocess-invokes.
- **Lifespan ordering** (`cds_poller.stop()` → `registry.aclose()` → `supervisor.aclose()` →
  `runtime.aclose()`) is correct, as is the `Poller`'s start gating and lease sweep.
- **Python dead-code sweep** across `domain/cds/`, `app/cds/`, `adapters/cds_*` found zero
  symbols without a non-test consumer. Every `--- CDS admin pipeline ---` setting has a real
  consumer (`cds_model_timeout_seconds` is read via `getattr` in `cds_gemini.py:280-281`).
- **`detect.py`'s `academic_year_start` has no independent confidence gate** — unlike
  `school_name`, which is scored against the catalog, the detected year is gated only by the
  *school-name* confidence plus a coarse range check (`service_ingest.py:211-227`).
  **Traced in the final review round and deliberately not filed.** The module's own docstring
  names this failure mode and states the mitigation is prompt instruction; the row still passes
  through admin review before becoming current data; and `year_consistency`
  (`validators.py:181-202`) is the independent backstop — which is exactly what **E-03** exists
  to keep alive. Filing a separate finding would duplicate E-03. Re-open if E-03's tripwire is
  ever dropped.
- **`starved_retry.py`'s asymmetric error record** (`:101-104` omits `usage` and other keys the
  success record at `:106-118` carries). **Non-finding, checked in review round 1.**
  `call_records` is a diagnostic blob — it is only ever appended to and then serialized whole at
  `engine.py:314` (`"calls": state.call_records`). Nothing iterates it reading `record["usage"]`,
  so there is no KeyError risk, and cost is accumulated separately via `state.usage_total`.
  Heterogeneous record shapes are already the norm (`batch_run.py:160` appends a third shape).
- **Doc spot-checks that are accurate:** "Fourteen endpoints" (counted 14); the `app/cds/` layout
  in `ARCHITECTURE.md` §38; the eight `cds_library` base tables; manifest `5.1.0` / hash /
  394 metrics / 13 domains; ADR 0036 carries a correct addendum for the 1,149→394 cut.

---

## 8. Suggested implementation order

Grouped so each block is independently shippable and testable. **No block may regress §1's
baseline.**

1. **Stop-the-bleeding (2 CRITICAL + the silent worker death).** W-01 (decide
   degrade-vs-fail-fast, then align code and docs), U-01 (modal guard), and **N-01** (poll-loop
   survival — mind the semaphore-leak constraint) with **N-02** alongside it, since both live in
   `jobs.py:97-129` and touch the same lifecycle. All small, all high blast radius. Each gets a
   regression test.
2. **Honesty on what the reviewer sees.** **Z-01 first** (stop manufacturing the
   partial-success-as-total-failure state), then E-01 (images-only page map — add the missing
   test), then **R-01 before R-02** — both live in `service_review.py`, and R-02's post-commit
   conflict check should read off whatever notion of "the extraction" R-01 settles on rather
   than inventing its own. E-03 (manifest tripwire) is independent.
3. **Silent-failure sweep.** T-202, T-201 (rowcount checks — near-trivial, high value), A-01,
   A-02, R-02, I-02, F-03.
4. **Admin-screen correctness.** F-04 (needs tests first — no `useBatchUpload.test.ts` exists),
   F-01, F-02 (including the server's "47 MiB" message), and **C-01** (the truncation notice —
   do it before any bulk onboarding, since that is what makes it fire).
5. **Schema ownership, then dedupe.** W-06/M-01 first — V-01 is blocked on it.
6. **Cleanup.** E-02, F-05/W-04, U-04, U-03, W-02, W-03, W-05, H-02, and the R-03 comment.
7. **Own commit, unbundled.** I-03 (function splits) — a refactor, never smuggled into a fix.

**Explicitly not doing:** Q-03 (measured fine), A-03 (accepted risk), R-04 (inherent to the
two-role split), the 8 inherited test failures (out of scope).

### Regression hazards — checked, with results

Every fix that changes observable behavior was checked against the test suites. Results:

| Fix | Pinned by an existing test? | Action required |
|---|---|---|
| **U-03** pluralization | **YES** — `frontend/src/pages/cds-review-page.test.tsx:247,256` assert the buggy strings `"Approve with 1 blocking flags?"` / `"Approve with 1 blocking flags"` | Update both assertions in the same commit |
| **F-02** size cap | **YES** — `staging-model.test.ts:65-67` encodes the 50 MiB threshold (`51 * 1024 * 1024` as "too big") | Update to the decimal cap |
| **E-02** delete dead PDF code | **YES** — `tests/domain/cds/test_pages.py:15-19` imports `narrow_document`, `page_framing`, `read_pdf_document`; four tests exercise them | Delete those imports and the four tests alongside the functions and their `__all__` entries |
| **T-202** rowcount raise | **NO** — `test_service_review_edit_flags.py:248-256` monkeypatches the function; `scripts/verify_cds_adapters.py:343` passes a slot id created in the same transaction | None |
| **T-201** rowcount raise | **NO** | None |
| **R-01** header provenance | **NO** — no assertion on `extraction.*` in either review test | None, but see R-01's `documentStatus` constraint |
| **U-04** delete `FlagSeverity.info` | **NO** — `cds-status.test.ts:59-60` iterates `Object.values(flagSeverityMeta)` generically, so one fewer entry still passes | None |
| **I-02** reject PATCH on duplicate | **NO** — no test asserts a 200 for this case | None |
| **W-01** degrade on bad DSN | **NO** — no test asserts `build_runtime` raises; `tests/api/conftest.py:202` uses the working `.env` | Also update `config/settings.py:255` and `docs/DATABASE_GUIDE.md:87`, whose text this changes |
| **N-01 / N-02** worker | **NO** — `grep -rn "Poller\|start_cds_worker" tests/` finds no coverage | None |

Frontend deletions must be verified with **`npm run build`**, not `npm run typecheck` — per the
repo's recorded gotcha, only the former catches a removed-but-still-referenced symbol.
