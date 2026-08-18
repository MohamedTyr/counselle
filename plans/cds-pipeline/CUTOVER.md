# CDS pipeline — cutover runbook

Operational steps to finish replacing the separate `counselle-data-pipeline` repo with
the in-app CDS pipeline. Read `docs/adr/0036-cds-pipeline-in-app.md` first for what
changed and why.

Nothing here is destructive to student-facing data. The one genuinely risky item is
password rotation (§2), which is also the one real security fix in this list.

---

## 0. State at the time of writing (verified 2026-08-18)

| Thing | State |
|---|---|
| `counselle-data-pipeline-app-1` | Exited ~4 weeks |
| `counselle-data-pipeline-worker-1` | Exited ~4 weeks |
| `counselle-data-pipeline-db-1` | **Up, healthy, and still required** — this is the shared Postgres both systems use |
| `cds_library` schema | 8 base tables + 5 reader views, migrations 0001–0004 applied |
| Real data | 2,746 school profiles, 5,946 CT-index rows, 5 school-year slots, 5 documents, 217 packets, manifest 5.0.2 current |
| Writer role | `cds_library_app` — INSERT/SELECT/UPDATE on all base tables, **no DELETE grant anywhere** |
| Reader role | `counselle_ro` ∈ `cds_library_reader` — SELECT on exactly the 5 views |

Because the old worker has been stopped for weeks, there is no two-writer race to
resolve. The cutover is mostly bookkeeping plus the password rotation.

---

## 1. Stop and decommission the old pipeline

The compute is already stopped; this makes it permanent and removes the ability for it
to start writing again.

```bash
cd /home/saifuddin/Projects/counselle-data-pipeline
docker compose ps                      # confirm app + worker are Exited, db is Up
docker compose rm -f app worker        # remove the stopped compute containers
```

**Do not** `docker compose down` and **do not** stop or remove `counselle-data-pipeline-db-1`.
That container is the live Postgres holding `cds_library` *and* `counselle.*`; stopping it
takes down Counselle itself.

If you want the database container to outlive the old repo's compose file, move it to its
own compose project or a plain `docker run` unit before deleting anything else. Until then,
keep `docker-compose.yml` in place even though the app/worker services are dead.

---

## 2. Rotate the placeholder database passwords ⚠️ security

The live database is still using the credentials committed to the old repo's
`.env.example`. They are genuinely enforced (scram-sha-256 — a wrong password is rejected),
they were simply never rotated.

| Role | Current password | Action |
|---|---|---|
| `cds_library_app` | the unrotated `.env.example` placeholder | Rotate |
| `postgres` | the unrotated `.env.example` placeholder | Rotate |

```sql
-- as a superuser on 127.0.0.1:5433/counselle_data
ALTER ROLE cds_library_app WITH PASSWORD '<new-strong-secret>';
ALTER ROLE postgres        WITH PASSWORD '<new-strong-secret>';
```

Then update every consumer:

1. `.env` in this repo — `COUNSELLE_DB_PIPELINE_DSN` (the only consumer of `cds_library_app`).
2. Any deploy/secret store that carries these values.
3. Restart the Counselle API so the pipeline pool reconnects.

Verify afterwards:

```bash
# writer still works
uv run python -c "import asyncio,asyncpg,os; asyncio.run(asyncpg.connect(os.environ['COUNSELLE_DB_PIPELINE_DSN']))"
# reader path untouched
uv run pytest -m live_db -q
```

Rotation was deliberately deferred out of P0 to avoid breaking a running system
mid-build. There is no longer a reason to defer it.

---

## 3. The old repository

**Archive it — do not delete it.** `counselle-data-pipeline/config/cds/` is the provenance
of the 1,149 metric definitions now living in this repo's `config/cds/`, and the old
`src/` is the only record of how manifest 5.0.2 and packet v8 were originally produced.

Suggested: mark the GitHub repo archived (read-only), and leave the local clone in place.
Add a note at the top of its README pointing at `docs/adr/0036-cds-pipeline-in-app.md`
in this repo so anyone who lands there knows where the live system went.

---

## 4. Flag for whoever owns deploy tooling

Two schemas exist on the live database that appear in **no** migration in either repo:

- `cds_deploy_export`
- `cds_deploy_seed`

They contain static snapshot tables and are correctly inaccessible to `counselle_ro`.
Nobody on this project knows what writes them. Identify the owner and either document
them or remove them; an undocumented schema on a production database is a liability.

---

## 5. Verification checklist

Run after §1 and §2. The point is to prove the **student-facing path is unchanged** —
that was the central design constraint of this whole change.

- [ ] `uv run python scripts/cds_manifest_check.py` prints
      `c821b2e61cf71f99c1f8503f8940bbce48354b978e091bb81223718784ad6f0a` and exits 0
      (the ported catalog is still byte-identical to the live manifest; a mismatch would
      make every existing packet report `current_definition_match = false`)
- [ ] The 5 reader views still return data for `counselle_ro`, and base tables still
      return `permission denied`
- [ ] A student-facing school query returns the same values as before cutover
- [ ] `uv run pytest -m "not live_llm and not live_search and not live_db"` — no new failures
- [ ] `cd frontend && npm run typecheck && npm run lint && npm run test && npm run build`
- [ ] Admin surface: `/app/admin/cds` loads for a superuser and 403s for a normal user
- [ ] Upload → process → review → approve round-trips, and the approved document appears
      in `cds_library.active_cds_documents`
- [ ] The CDS worker starts with the API and stops cleanly on shutdown

---

## 6. Known limitations carried into production

State these plainly to anyone relying on the data. None are blockers; all are honest gaps.

- **Per-metric recall is 65.6%**, measured on Harvard (up from 17.9% pre-batching),
  partially corroborated on Cornell. It is **not** a whole-corpus number and it is not 100%.
- Only `admissions` has an independently estimated answerable ceiling (80–98 of 152 on
  Harvard), against which its 85 verified metrics is near-saturation. `degrees` (20.9%)
  and `transfer` (41.6%) most likely retain real headroom.
- Cost is ~$0.30/document; latency roughly 6–20 minutes depending on document size.
- **Hash-scoped incremental re-extraction is deferred.** `rerun` re-extracts full domain
  sets, so a manifest change means paying for everything, not just what changed.
- The ported metric `instructions` were hand-authored against Harvard and Yale only, so
  they generalise unevenly across institutions.
- Deliberately not built (see `PLAN.md` §I2): College Transitions scraping/auto-download,
  XLSX ingestion, split-CDS aggregation, the Gemini Batch API, SSE job progress, and RBAC
  beyond `is_superuser`.
- Review-screen flag precision has **not** been measured. One live document showed 83
  unresolved flags; spike evidence suggests many excerpt-mismatch flags are false alarms
  on documents with imperfect text layers. Until measured, expect review to be noisier
  than the two-minute design target.
