# Admissions-fit normalized fact fixtures

These are small, sanitized **reader-contract** fixtures for the planned
admissions-fit adapter. The `current_school_facts` array in every JSON file
uses exact `counselle_db.models.FactValueRow` fields; its `value` member
preserves the JSONB wrapper stored by `cds_library.current_school_facts`
(`{"kind": ..., "value": ...}`), not the facts-page presentation shape.

They were frozen on 2026-09-15 from the local read-only `cds_library` store
and from the committed CollegeData mapper corpus. School identity is omitted
where it does not affect the contract. The fixtures contain no Profile data.

| Fixture | Provenance / controlled change |
|---|---|
| `complete_required_school.json` | One read-only store sample with valid GPA, rank, SAT/ACT bands, and stored `required` policy code. `school_explore.admit_rate` is from the same sample. |
| `partial_gpa.json` | One real stored GPA-distribution row with both reported and explicitly `not_reported` buckets; it is incomplete and unsuitable for an adjustment. |
| `not_reported_gpa.json` | One real stored GPA-distribution row whose source buckets were explicitly `not_reported`. |
| `invalid_rank_shares.json` | Complete sample's rank-row shape; only the three public percentages are made non-monotonic. |
| `stale_observations.json` | Complete sample's normalized rows; only `observed_at` is backdated for hermetic stale-data tests. |
| `test_policy_codes.json` | One real stored row for each observed `admissions.test_policy_sat_or_act.value_text` code. |

No fixture introduces a crawler key, value type, JSON payload member, or
Profile field. The intentional invalidity transformations are named above.
