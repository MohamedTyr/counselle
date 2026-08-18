# Live DB Recon: `cds_library_app` as the New Pipeline's Write Path

**Verdict: the assumption holds — empirically confirmed today.** `cds_library_app`
can INSERT into all four target tables and UPDATE `cds_school_years.active_document_id`
today, using credentials that already exist and already work. The `counselle_ro` /
`cds_library_reader` read path is untouched and correctly sandboxed. Full evidence below.

Tested against: live Postgres 16.14, `127.0.0.1:5433/counselle_data`, 2026-08-18.
All write tests ran inside `BEGIN ... ROLLBACK` — zero rows were left behind (verified
by before/after row counts, see §2 and §4).

---

## 1. Deployed-state inventory vs. migrations 0001–0004

Source of truth for expected shape: `/home/saifuddin/Projects/counselle-data-pipeline/migrations/0001_initial.sql`
through `0004_reader_contract.sql`. Applied-migration ledger confirms all four ran:

```
migration_id                     | applied_at
0001_initial.sql                 | 2026-07-13 22:44:46+00
0002_ct_index_generations.sql    | 2026-07-13 23:37:34+00
0003_candidate_reactivation.sql  | 2026-07-14 23:52:48+00
0004_reader_contract.sql         | 2026-07-15 05:23:56+00
```

**Roles** (`\du`):

| Role | Can login | Notes |
|---|---|---|
| `cds_library_owner` | No | Owns all `cds_library` objects |
| `cds_library_app` | **Yes** | Read/write app role — the one this task tests |
| `cds_library_reader` | **No** | Grantee role, `SELECT`-only on 5 views; nobody logs in as this role directly |
| `counselle_app` | Yes | Owns `counselle.*` schema; **no** `USAGE` on `cds_library` schema at all |
| `counselle_ro` | Yes | **Member of** `cds_library_reader` (confirmed via `pg_auth_members` and `pg_has_role(...) = t`) — this is how Counselle's read path actually authenticates |
| `postgres` | Yes (superuser) | Used for this recon's read-only inventory queries only |

**Base tables in `cds_library`** (9, matches migrations 0001–0003, plus `_yoyo_migration`):
`schools`, `cds_school_years`, `cds_documents`, `cds_manifests`, `cds_extractions`,
`cds_domain_packets`, `ct_index_entries`, `ct_index_state`.

**Views in `cds_library`** (5, matches 0004's reader contract exactly):
`active_cds_documents`, `active_cds_domain_packets`, `cds_document_sources`,
`cds_manifest_snapshots`, `school_profiles`.

**Grants** (`information_schema.role_table_grants`, cross-checked against `\dp`):
- `cds_library_app`: `INSERT, SELECT, UPDATE` on **all 8 base tables** and all 5 views.
  **No `DELETE`** grant anywhere (confirmed empirically in §4 — `DELETE` is denied).
- `cds_library_owner`: full `DELETE/INSERT/REFERENCES/SELECT/TRIGGER/TRUNCATE/UPDATE`
  on everything (object owner).
- `cds_library_reader`: `SELECT` only, and **only on the 5 views** — no grants on any
  base table (confirmed empirically in §5).
- `counselle_app`: zero grants and zero schema `USAGE` on `cds_library` — fully walled
  off, exactly as `docs/DATABASE_GUIDE.md` describes.

**Drift found — not in migrations 0001–0004:**
Two extra schemas exist, `cds_deploy_export` and `cds_deploy_seed`, each containing 5
plain **tables** (not views) named identically to the 5 reader views
(`active_cds_documents`, `active_cds_domain_packets`, `cds_document_sources`,
`cds_manifest_snapshots`, `school_profiles`), owned by `postgres`. These are static
snapshots — evidently a deploy/export mechanism outside the yoyo migration set. No role
tested (`cds_library_app`, `cds_library_reader`, `counselle_app`, `counselle_ro`) has
`USAGE` on either schema (`has_schema_privilege(...) = f` for all four, confirmed by
query). **This drift is inert for the write-path question** — it doesn't grant or block
anything relevant to `cds_library_app` — but flag it to whoever owns the deploy/export
tooling, since it isn't in version control under `migrations/`.

---

## 2. Real data already in the live DB (as of 2026-08-18)

| Table | Row count |
|---|---|
| `schools` | 2,746 |
| `cds_school_years` | 5 |
| `cds_documents` | 5 |
| `cds_manifests` | 14 |
| `cds_extractions` | 26 |
| `cds_domain_packets` | 217 |
| `ct_index_entries` | 5,946 |
| `ct_index_state` | 1 |

**Current manifest**: `version = 5.0.2`, `extractor_contract_version = 8`,
`is_current = true`, published `2026-07-16 10:09:50+00`. 13 prior manifest versions
exist (`1.0.1` through `5.0.1`), all superseded — this confirms the one-current-version
invariant (`cds_manifests_one_current_idx` unique-partial-index) is live and has been
exercised repeatedly.

**Schools with profile data**: `school_profiles` view returns 2,746 rows — i.e. every
school row currently carries IPEDS basic-profile data (name, city, geocode, etc.). This
is *not* CDS-document coverage — it's the base catalog import.

**Schools with actual CDS document/extraction activity**: only **3 distinct schools**
(`school_id` 130794, 166027, 215062) have any `cds_school_years` rows at all, across 5
school-year slots. Concretely:

| school_id | academic_year | has active document |
|---|---|---|
| 130794 | 2024 | yes |
| 130794 | 2025 | no |
| 166027 | 2024 | yes |
| 166027 | 2025 | yes |
| 215062 | 2024 | yes |

217 domain packets span 13 domains (academics, admissions, class_profile, class_size,
cost, degrees, enrollment, faculty, financial_aid, identity, outcomes, student_life,
transfer), roughly 16–17 packets per domain — consistent with ~4 active documents ×
13 domains plus reactivation/retry history.

**Bottom line for planning**: the new pipeline inherits a *populated catalog* (2,746
schools with basic profiles, 5,946 CT-index entries) but *near-empty CDS coverage*
(3 schools, 5 document slots) — this is a cold start for the actual document/extraction
workload, not a blank database.

---

## 3. Writer credentials — can we authenticate as `cds_library_app` today?

**Yes, it works today**, using credentials that already exist in the pipeline repo's
own `.env` (not the Counselle worktree's `.env`, which has no pipeline-writer entry).

- Counselle's worktree `.env` (`/home/saifuddin/Projects/counselle/.worktrees/cds-pipeline/.env`)
  has **no** `COUNSELLE_DB_PIPELINE_DSN` or any `cds_library_app` credential today — only
  `COUNSELLE_DB_RO_DSN` (`counselle_ro`) and `COUNSELLE_DB_APP_DSN` (`counselle_app`).
  `config/settings.py` has no `db_pipeline_dsn` field yet either (grep confirmed).
- The credential lives in the **pipeline repo's** `.env`
  (`/home/saifuddin/Projects/counselle-data-pipeline/.env`):
  `CDS_LIBRARY_APP_PASSWORD=<unrotated-placeholder>`, wired into
  `DATABASE_URL=postgresql://cds_library_app:<unrotated-placeholder>@localhost:5433/counselle_data`.
- **Notable finding**: that password is the literal placeholder from `.env.example`
  (the unrotated `.env.example` placeholder) — never rotated. Same for the `postgres` superuser
  (`POSTGRES_PASSWORD=<unrotated-placeholder>`, also never rotated). Auth is genuinely
  enforced, not bypassed — confirmed by testing a wrong password, which was rejected
  with `password authentication failed for user "cds_library_app"` — but the "real"
  password in the live DB today is a well-known example value, not a generated secret.
  This is a hygiene issue worth fixing before this ever leaves local dev, but it is
  **not a blocker** for the write-path question.
- **Auth mechanism**: `pg_hba_file_rules()` shows a `trust` rule for literal
  `127.0.0.1` at line 119 and a catch-all `scram-sha-256` at line 128. Because Postgres
  runs inside the `db` container from `docker-compose.yml` and the host's
  `127.0.0.1:5433` mapping is NAT'd through Docker, the server sees the connection
  arriving from the Docker bridge gateway, not literal `127.0.0.1` — so the `trust` rule
  never actually matches, and `scram-sha-256` applies. Confirmed by testing a wrong
  password (rejected) — password auth is real, not accidentally open.

**Exact working DSN shape today** (password redacted):

```
postgresql://cds_library_app:***@127.0.0.1:5433/counselle_data
```

This connects successfully as `cds_library_app` right now. If Counselle's own
`config/settings.py` grows a `COUNSELLE_DB_PIPELINE_DSN` field (per
`plans/cds-pipeline/recon-backend.md`'s option 1), it would need exactly this shape —
same host/port/dbname as the existing `COUNSELLE_DB_RO_DSN` / `COUNSELLE_DB_APP_DSN`
entries, just a different role and (ideally, before shipping) a rotated password.

---

## 4. Write-capability proof (all inside one `BEGIN ... ROLLBACK`, nothing committed)

Connected as `cds_library_app`. Used `schools.id = 100654` (Alabama A&M University, a
real pre-existing row) for FK validity. Used `psql`'s `ON_ERROR_ROLLBACK` so a failed
statement doesn't abort the whole transaction — each step below ran to completion or
failed cleanly, and the *entire* transaction was rolled back at the end regardless.

| # | Operation | Result | Detail |
|---|---|---|---|
| 1 | `INSERT INTO cds_school_years (school_id=100654, academic_year=2099, ...)` | **Succeeded** | Returned new `id=6` |
| 2 | `INSERT INTO cds_documents (school_year_id=6, ...)` | **Succeeded** | Returned new `id=6` |
| 3 | `INSERT INTO cds_extractions (id=<uuid>, school_year_id=6, document_id=6, manifest_version='5.0.2', ...)` | **Succeeded** | FK to current manifest version validated |
| 4 | `INSERT INTO cds_domain_packets (document_id=6, extraction_id=<uuid>, ...)` | **Succeeded** | |
| 5 | `UPDATE cds_school_years SET active_document_id=6 WHERE id=6` | **Succeeded** | Returned `id=6, active_document_id=6` |
| 6 | `DELETE FROM cds_domain_packets WHERE ...` (probe, not requested but useful signal) | **Denied** | `ERROR: permission denied for table cds_domain_packets` — confirms `cds_library_app` has no `DELETE` grant anywhere, matching §1's grant inventory |
| — | Post-rollback row counts | **Unchanged** | `cds_school_years=5, cds_documents=5, cds_extractions=26, cds_domain_packets=217` — identical to pre-test baseline in §2; targeted check for the probe row (`school_id=100654, academic_year=2099`) returned `count=0` |

**Conclusion**: `cds_library_app` has full INSERT/UPDATE capability on exactly the four
tables the new pipeline needs, plus the `active_document_id` UPDATE path. No permission
gaps found for the write operations this task was asked to test.

---

## 5. Reader path unaffected — `counselle_ro` / `cds_library_reader`

Connected as `counselle_ro` (the role Counselle's `COUNSELLE_DB_RO_DSN` actually uses;
confirmed `pg_has_role('counselle_ro', 'cds_library_reader', 'member') = t`).

| Check | Result |
|---|---|
| `SELECT count(*) FROM cds_library.active_cds_documents` | **4** rows — succeeded |
| `SELECT count(*) FROM cds_library.active_cds_domain_packets` | **52** rows — succeeded |
| `SELECT count(*) FROM cds_library.cds_document_sources` | **5** rows — succeeded |
| `SELECT count(*) FROM cds_library.cds_manifest_snapshots` | **14** rows — succeeded |
| `SELECT count(*) FROM cds_library.school_profiles` | **2,746** rows — succeeded |
| `SELECT * FROM cds_library.schools` | **Denied**: `ERROR: permission denied for table schools` |
| `SELECT * FROM cds_library.cds_school_years` | **Denied**: `ERROR: permission denied for table cds_school_years` |
| `SELECT * FROM cds_library.cds_documents` | **Denied**: `ERROR: permission denied for table cds_documents` |
| `SELECT * FROM cds_library.cds_manifests` | **Denied**: `ERROR: permission denied for table cds_manifests` |
| `SELECT * FROM cds_library.cds_extractions` | **Denied**: `ERROR: permission denied for table cds_extractions` |
| `SELECT * FROM cds_library.cds_domain_packets` | **Denied**: `ERROR: permission denied for table cds_domain_packets` |
| `SELECT * FROM cds_library.ct_index_entries` | **Denied**: `ERROR: permission denied for table ct_index_entries` |
| `INSERT INTO cds_library.school_profiles (...)` (write-to-view probe) | **Denied**: `ERROR: permission denied for view school_profiles` |
| `SELECT * FROM cds_deploy_export.school_profiles` (drift schema probe) | **Denied**: `ERROR: permission denied for schema cds_deploy_export` |

All five contract views readable, all base tables and the drift schemas fully blocked,
and the reader cannot write even through a view. The read path's isolation is intact
and was not touched by any of the write tests above (they ran in a different,
rolled-back transaction on a different role entirely).

---

## 6. Immutability triggers — confirmed live and firing

Both triggers exist and are attached (`\d` output):
`cds_documents_immutable BEFORE UPDATE ... EXECUTE FUNCTION cds_library.reject_immutable_document()`
and `cds_domain_packets_immutable BEFORE UPDATE ... EXECUTE FUNCTION cds_library.reject_immutable_packet()`.

Tested inside the same rolled-back transaction as §4, using both the row just inserted
in that transaction and a pre-existing row:

| Target | Result | Exact error |
|---|---|---|
| `UPDATE cds_domain_packets SET packet = '{"probe": "mutated"}' WHERE document_id=6 AND domain_id='write_test_domain'` (row inserted earlier in the same txn) | **Blocked** | `ERROR: domain packet evidence is immutable` (raised from `cds_library.reject_immutable_packet()`, line 3) |
| `UPDATE cds_documents SET pdf_content = decode('ffee','hex') WHERE id=6` (row inserted earlier in the same txn) | **Blocked** | `ERROR: CDS document evidence is immutable` (raised from `cds_library.reject_immutable_document()`, line 9) |
| `UPDATE cds_documents SET pdf_content = decode('ffee','hex') WHERE id=1` (pre-existing production row) | **Blocked** | `ERROR: CDS document evidence is immutable` — identical trigger, confirms it fires against real historical data too, not just fresh rows |

The triggers fire even within the same transaction that created the row (no special-case
for "row I just inserted") and even for genuinely pre-existing data. `active_document_id`
and non-content columns on `cds_school_years` remain updatable (§4, step 5) — only the
evidence-bearing columns (`pdf_content`, `packet`, etc.) are frozen post-insert, which
matches the intended "immutable evidence, mutable pointers" design.

---

## Summary of blockers found

**None that block the write-path assumption.** The one real issue found —
unrotated placeholder passwords (the unrotated `.env.example` placeholder, the unrotated `.env.example` placeholder) still live on
the local dev DB — is a hygiene item, not a technical blocker, and is scoped to local
dev credentials rather than the schema/grant model. Recommend rotating both before this
environment is shared beyond a single developer's machine, and deciding (per
`recon-backend.md`'s three options) whether the new pipeline authenticates as the
existing `cds_library_app` directly or through a new dedicated role — this recon
confirms the former is technically viable today with zero grant or trigger changes
required.
