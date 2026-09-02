# cds_library LIVE schema snapshot (ground truth)

Generated from the running Postgres via COUNSELLE_DB_PIPELINE_DSN (role cds_library_app).
These tables are NOT created by this repo's migrations/ (0015/0016 create counselle.* only),
so this snapshot is the only authoritative schema reference for cds_library.

TABLES (9): _yoyo_migration, cds_documents, cds_domain_packets, cds_extractions, cds_manifests, cds_school_years, ct_index_entries, ct_index_state, schools

VIEWS (5): active_cds_documents, active_cds_domain_packets, cds_document_sources, cds_manifest_snapshots, school_profiles


## _yoyo_migration  (rows=<no SELECT grant: InsufficientPrivilegeError>)

| column | type | null | default |
|---|---|---|---|

Indexes:
- `CREATE UNIQUE INDEX _yoyo_migration_pkey ON cds_library._yoyo_migration USING btree (migration_id)`

Constraints:
- `_yoyo_migration_pkey`: PRIMARY KEY (migration_id)

## cds_documents  (rows=28)

| column | type | null | default |
|---|---|---|---|
| id | bigint | NO |  |
| school_year_id | bigint | NO |  |
| pdf_content | bytea | NO |  |
| pdf_sha256 | bytea | NO |  |
| pdf_size_bytes | bigint | NO |  |
| mime_type | text | NO |  |
| original_filename | text | YES |  |
| source_kind | text | NO |  |
| source_page_url | text | YES |  |
| original_download_url | text | YES |  |
| resolved_download_url | text | YES |  |
| repository_school_name | text | YES |  |
| retrieved_at | timestamp with time zone | NO |  |
| created_at | timestamp with time zone | NO | now() |
| invalidated_at | timestamp with time zone | YES |  |
| superseded_at | timestamp with time zone | YES |  |

Indexes:
- `CREATE UNIQUE INDEX cds_documents_id_school_year_id_key ON cds_library.cds_documents USING btree (id, school_year_id)`
- `CREATE UNIQUE INDEX cds_documents_pkey ON cds_library.cds_documents USING btree (id)`

Constraints:
- `cds_documents_check`: CHECK (((invalidated_at IS NULL) OR (superseded_at IS NULL)))
- `cds_documents_id_school_year_id_key`: UNIQUE (id, school_year_id)
- `cds_documents_mime_type_check`: CHECK ((mime_type = 'application/pdf'::text))
- `cds_documents_pdf_sha256_check`: CHECK ((octet_length(pdf_sha256) = 32))
- `cds_documents_pdf_size_bytes_check`: CHECK ((pdf_size_bytes > 0))
- `cds_documents_pkey`: PRIMARY KEY (id)
- `cds_documents_school_year_id_fkey`: FOREIGN KEY (school_year_id) REFERENCES cds_library.cds_school_years(id)
- `cds_documents_source_kind_check`: CHECK ((source_kind = ANY (ARRAY['upload'::text, 'college_transitions'::text])))

## cds_domain_packets  (rows=513)

| column | type | null | default |
|---|---|---|---|
| document_id | bigint | NO |  |
| extraction_id | uuid | NO |  |
| manifest_version | text | NO |  |
| domain_id | text | NO |  |
| domain_schema_hash | bytea | NO |  |
| status | text | NO |  |
| packet | jsonb | NO |  |
| validation | jsonb | NO | '{}'::jsonb |
| is_active | boolean | NO | false |
| created_at | timestamp with time zone | NO | now() |
| activated_at | timestamp with time zone | YES |  |

Indexes:
- `CREATE UNIQUE INDEX cds_domain_packets_one_active_idx ON cds_library.cds_domain_packets USING btree (document_id, domain_id) WHERE is_active`
- `CREATE UNIQUE INDEX cds_domain_packets_pkey ON cds_library.cds_domain_packets USING btree (extraction_id, domain_id)`

Constraints:
- `cds_domain_packets_check`: CHECK (((is_active = false) OR (activated_at IS NOT NULL)))
- `cds_domain_packets_check1`: CHECK (((is_active = false) OR (status = ANY (ARRAY['validated'::text, 'partial'::text]))))
- `cds_domain_packets_domain_schema_hash_check`: CHECK ((octet_length(domain_schema_hash) = 32))
- `cds_domain_packets_extraction_id_document_id_manifest_vers_fkey`: FOREIGN KEY (extraction_id, document_id, manifest_version) REFERENCES cds_library.cds_extractions(id, document_id, manifest_version)
- `cds_domain_packets_packet_check`: CHECK ((jsonb_typeof(packet) = 'object'::text))
- `cds_domain_packets_pkey`: PRIMARY KEY (extraction_id, domain_id)
- `cds_domain_packets_status_check`: CHECK ((status = ANY (ARRAY['validated'::text, 'partial'::text, 'parse_failed'::text])))
- `cds_domain_packets_validation_check`: CHECK ((jsonb_typeof(validation) = 'object'::text))

## cds_extractions  (rows=77)

| column | type | null | default |
|---|---|---|---|
| id | uuid | NO |  |
| school_year_id | bigint | NO |  |
| document_id | bigint | NO |  |
| manifest_version | text | NO |  |
| target_kind | text | NO |  |
| requested_domains | ARRAY | NO |  |
| status | text | NO |  |
| queued_at | timestamp with time zone | NO | now() |
| started_at | timestamp with time zone | YES |  |
| finished_at | timestamp with time zone | YES |  |
| lease_expires_at | timestamp with time zone | YES |  |
| extractor_version | text | NO |  |
| model_id | text | NO |  |
| validation_summary | jsonb | NO | '{}'::jsonb |
| error_code | text | YES |  |
| error_message | text | YES |  |
| created_at | timestamp with time zone | NO | now() |
| reactivated_at | timestamp with time zone | YES |  |

Indexes:
- `CREATE INDEX cds_extractions_claim_idx ON cds_library.cds_extractions USING btree (status, queued_at)`
- `CREATE UNIQUE INDEX cds_extractions_id_document_id_manifest_version_key ON cds_library.cds_extractions USING btree (id, document_id, manifest_version)`
- `CREATE UNIQUE INDEX cds_extractions_one_live_per_slot_idx ON cds_library.cds_extractions USING btree (school_year_id) WHERE (status = ANY (ARRAY['queued'::text, 'running'::text]))`
- `CREATE UNIQUE INDEX cds_extractions_pkey ON cds_library.cds_extractions USING btree (id)`

Constraints:
- `cds_extractions_check`: CHECK ((((status = 'queued'::text) AND (started_at IS NULL) AND (finished_at IS NULL)) OR ((status = 'running'::text) AND (started_at IS NOT NULL) AND (finished_at IS NULL) AND (lease_expires_at IS NOT NULL)) OR ((status = ANY (ARRAY['succeeded'::text, 'partial'::text, 'failed'::text])) AND (started_at IS NOT NULL) AND (finished_at IS NOT NULL))))
- `cds_extractions_document_id_school_year_id_fkey`: FOREIGN KEY (document_id, school_year_id) REFERENCES cds_library.cds_documents(id, school_year_id)
- `cds_extractions_id_document_id_manifest_version_key`: UNIQUE (id, document_id, manifest_version)
- `cds_extractions_manifest_version_fkey`: FOREIGN KEY (manifest_version) REFERENCES cds_library.cds_manifests(version)
- `cds_extractions_pkey`: PRIMARY KEY (id)
- `cds_extractions_reactivated_status_ck`: CHECK (((reactivated_at IS NULL) OR (status = ANY (ARRAY['succeeded'::text, 'partial'::text]))))
- `cds_extractions_requested_domains_check`: CHECK ((cardinality(requested_domains) > 0))
- `cds_extractions_requested_domains_check1`: CHECK (cds_library.is_sorted_distinct_text_array(requested_domains))
- `cds_extractions_school_year_id_fkey`: FOREIGN KEY (school_year_id) REFERENCES cds_library.cds_school_years(id)
- `cds_extractions_status_check`: CHECK ((status = ANY (ARRAY['queued'::text, 'running'::text, 'succeeded'::text, 'partial'::text, 'failed'::text])))
- `cds_extractions_target_kind_check`: CHECK ((target_kind = ANY (ARRAY['candidate'::text, 'active_update'::text, 'full_reextract'::text])))

## cds_manifests  (rows=15)

| column | type | null | default |
|---|---|---|---|
| version | text | NO |  |
| content_sha256 | bytea | NO |  |
| content | jsonb | NO |  |
| domain_hashes | jsonb | NO |  |
| extractor_contract_version | text | NO |  |
| is_current | boolean | NO | false |
| created_at | timestamp with time zone | NO | now() |
| published_at | timestamp with time zone | NO | now() |

Indexes:
- `CREATE UNIQUE INDEX cds_manifests_content_sha256_key ON cds_library.cds_manifests USING btree (content_sha256)`
- `CREATE UNIQUE INDEX cds_manifests_one_current_idx ON cds_library.cds_manifests USING btree (is_current) WHERE is_current`
- `CREATE UNIQUE INDEX cds_manifests_pkey ON cds_library.cds_manifests USING btree (version)`

Constraints:
- `cds_manifests_content_check`: CHECK ((jsonb_typeof(content) = 'object'::text))
- `cds_manifests_content_sha256_check`: CHECK ((octet_length(content_sha256) = 32))
- `cds_manifests_content_sha256_key`: UNIQUE (content_sha256)
- `cds_manifests_domain_hashes_check`: CHECK ((jsonb_typeof(domain_hashes) = 'object'::text))
- `cds_manifests_pkey`: PRIMARY KEY (version)

## cds_school_years  (rows=26)

| column | type | null | default |
|---|---|---|---|
| id | bigint | NO |  |
| school_id | integer | NO |  |
| academic_year | smallint | NO |  |
| active_document_id | bigint | YES |  |
| candidate_document_id | bigint | YES |  |
| last_action_kind | text | NO | 'created'::text |
| last_action_at | timestamp with time zone | NO | now() |
| retired_at | timestamp with time zone | YES |  |
| created_at | timestamp with time zone | NO | now() |

Indexes:
- `CREATE INDEX cds_school_years_manager_idx ON cds_library.cds_school_years USING btree (academic_year, last_action_at DESC, id DESC)`
- `CREATE UNIQUE INDEX cds_school_years_pkey ON cds_library.cds_school_years USING btree (id)`
- `CREATE UNIQUE INDEX cds_school_years_school_id_academic_year_key ON cds_library.cds_school_years USING btree (school_id, academic_year)`

Constraints:
- `cds_school_years_academic_year_check`: CHECK (((academic_year >= 2000) AND (academic_year <= 2200)))
- `cds_school_years_active_document_slot_fk`: FOREIGN KEY (active_document_id, id) REFERENCES cds_library.cds_documents(id, school_year_id)
- `cds_school_years_candidate_document_slot_fk`: FOREIGN KEY (candidate_document_id, id) REFERENCES cds_library.cds_documents(id, school_year_id)
- `cds_school_years_check`: CHECK (((active_document_id IS NULL) OR (candidate_document_id IS NULL) OR (active_document_id <> candidate_document_id)))
- `cds_school_years_pkey`: PRIMARY KEY (id)
- `cds_school_years_school_id_academic_year_key`: UNIQUE (school_id, academic_year)
- `cds_school_years_school_id_fkey`: FOREIGN KEY (school_id) REFERENCES cds_library.schools(id)

## ct_index_entries  (rows=5946)

| column | type | null | default |
|---|---|---|---|
| id | bigint | NO |  |
| school_name | text | NO |  |
| normalized_name | text | NO |  |
| academic_year | smallint | NO |  |
| original_url | text | NO |  |
| resolved_url | text | NO |  |
| link_kind | text | NO |  |
| indexed_at | timestamp with time zone | NO | now() |
| generation | bigint | NO | 0 |

Indexes:
- `CREATE UNIQUE INDEX ct_index_entries_generation_entry_key ON cds_library.ct_index_entries USING btree (generation, normalized_name, academic_year, resolved_url)`
- `CREATE INDEX ct_index_entries_generation_search_idx ON cds_library.ct_index_entries USING btree (generation, academic_year, normalized_name)`
- `CREATE UNIQUE INDEX ct_index_entries_pkey ON cds_library.ct_index_entries USING btree (id)`
- `CREATE INDEX ct_index_entries_search_idx ON cds_library.ct_index_entries USING btree (academic_year, normalized_name)`

Constraints:
- `ct_index_entries_academic_year_check`: CHECK (((academic_year >= 2000) AND (academic_year <= 2200)))
- `ct_index_entries_generation_entry_key`: UNIQUE (generation, normalized_name, academic_year, resolved_url)
- `ct_index_entries_link_kind_check`: CHECK ((link_kind = ANY (ARRAY['drive'::text, 'sheet'::text, 'document'::text])))
- `ct_index_entries_pkey`: PRIMARY KEY (id)

## ct_index_state  (rows=1)

| column | type | null | default |
|---|---|---|---|
| id | smallint | NO | 1 |
| status | text | NO | 'never_indexed'::text |
| last_attempt_at | timestamp with time zone | YES |  |
| last_success_at | timestamp with time zone | YES |  |
| source_url | text | YES |  |
| school_count | integer | YES |  |
| link_count | integer | YES |  |
| year_columns | jsonb | NO | '[]'::jsonb |
| parser_version | text | YES |  |
| error_message | text | YES |  |
| active_generation | bigint | NO | 0 |

Indexes:
- `CREATE UNIQUE INDEX ct_index_state_pkey ON cds_library.ct_index_state USING btree (id)`

Constraints:
- `ct_index_state_id_check`: CHECK ((id = 1))
- `ct_index_state_pkey`: PRIMARY KEY (id)
- `ct_index_state_year_columns_check`: CHECK ((jsonb_typeof(year_columns) = 'array'::text))

## schools  (rows=2746)

| column | type | null | default |
|---|---|---|---|
| id | integer | NO |  |
| name | text | NO |  |
| aliases | ARRAY | NO | '{}'::text[] |
| city | text | YES |  |
| state | text | YES |  |
| postal_code | text | YES |  |
| latitude | numeric | YES |  |
| longitude | numeric | YES |  |
| official_website | text | YES |  |
| official_domain | text | YES |  |
| general_phone | text | YES |  |
| is_currently_operating | boolean | YES |  |
| is_main_campus | boolean | YES |  |
| search_name | text | NO |  |
| basic_profile | jsonb | NO |  |
| profile_provenance | jsonb | NO |  |
| profile_version | text | NO |  |
| profile_snapshot_date | date | NO |  |
| profile_sha256 | bytea | NO |  |
| imported_at | timestamp with time zone | NO | now() |
| created_at | timestamp with time zone | NO | now() |

Indexes:
- `CREATE UNIQUE INDEX schools_pkey ON cds_library.schools USING btree (id)`
- `CREATE INDEX schools_search_name_idx ON cds_library.schools USING btree (search_name, id)`

Constraints:
- `schools_basic_profile_check`: CHECK ((jsonb_typeof(basic_profile) = 'object'::text))
- `schools_pkey`: PRIMARY KEY (id)
- `schools_profile_provenance_check`: CHECK ((jsonb_typeof(profile_provenance) = 'object'::text))
- `schools_profile_sha256_check`: CHECK ((octet_length(profile_sha256) = 32))


## GRANTS to cds_library_app on cds_library

| table | privileges |
|---|---|
| active_cds_documents | INSERT, SELECT, UPDATE |
| active_cds_domain_packets | INSERT, SELECT, UPDATE |
| cds_document_sources | INSERT, SELECT, UPDATE |
| cds_documents | INSERT, SELECT, UPDATE |
| cds_domain_packets | INSERT, SELECT, UPDATE |
| cds_extractions | INSERT, SELECT, UPDATE |
| cds_manifest_snapshots | INSERT, SELECT, UPDATE |
| cds_manifests | INSERT, SELECT, UPDATE |
| cds_school_years | INSERT, SELECT, UPDATE |
| ct_index_entries | INSERT, SELECT, UPDATE |
| ct_index_state | INSERT, SELECT, UPDATE |
| school_profiles | INSERT, SELECT, UPDATE |
| schools | INSERT, SELECT, UPDATE |