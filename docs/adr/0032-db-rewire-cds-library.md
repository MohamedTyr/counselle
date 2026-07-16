# ADR 0032 — Rewire database access to the CDS Library

**Status:** Accepted

## Context

Counselle formerly consumed a wide IPEDS/Scorecard/CDS field store. The replacement
pipeline is the CDS Library: stable school profiles plus immutable, versioned CDS
domain packets with physical-PDF evidence. Preserving the old field catalog,
normalization rules, coverage tiers, or embedding index would misdescribe the new
truth boundary and invite unsupported student claims.

## Decision

Counselle consumes the independently deployed CDS Library through the read-only
`cds_library_reader` role and exactly five schema-qualified views. It imports no
pipeline code and never reads pipeline base tables. The current catalog is the single
manifest row whose `is_current` flag is true; the coordinated current publication is
the immutable patch successor `5.0.1`, extraction contract 8. Domain and metric
inventories are derived dynamically, and metric identity outside packet parsing is
always `<domain_id>.<metric_id>`.

The LLM-facing database surface is exactly four tools: `resolve_school`,
`get_school_profile`, `get_domain`, and guarded, parameterized `query_database`.
Profiles are identity context, not current metrics. School reads select one document
edition and never fill holes from an older edition. Packet v8 is parsed through a
typed anti-corruption boundary; only verified/reported values become student values,
while availability states, compiled context binders, evidence, vintage, and canonical
caveats remain code-owned.

The runtime injects a live data picture built from the current manifest and selected
document coverage. Named DB values travel through compact visible and internal
evidence markers; the runtime strips internal tokens after registering the exact
source. Live SQL aggregates instead state their as-of date and covered/total
denominator, and named finalists are re-fetched through typed reads.

`render_viz` uses an open version-2 cell grammar. A cell is either a verified metric
ref, a profile ref, a registered external value, or explicit unavailable. Known card
types render natively; unknown opaque types remain safely forward-compatible. Rejected
refs are errors to correct, never holes to relabel unavailable.

## Relationship to earlier decisions

- Fully supersedes ADRs 0007 and 0008: there is no field-search or embedding index.
- Replaces the old-data details in ADRs 0002, 0005, 0006, and 0012; their broader
  scope, service-layer, code-owned honesty, and read-only decisions remain.
- Amends ADR 0014 with verified two-channel rendering: DB/profile refs are fetched by
  code; registered external values retain their own provenance.
- Amends ADR 0017: the typed packet parser is the anti-corruption truth boundary, and
  the field reconciler and its architectural deviation are removed.
- Retains ADR 0019's same-Postgres decision: Counselle application state remains in
  `counselle.*`, owned through the separate application DSN.
- Amends ADR 0024's closed `RenderSpec` set to the open known/opaque v2 seam.

## Alternatives considered

- **Adapt the old field tools to packet JSON.** Rejected: it hides domain, edition,
  evidence, and availability semantics behind a false flat-field abstraction.
- **Import pipeline models or config.** Rejected: it couples independent deployments;
  the five views and immutable manifest are the contract.
- **Expose packet JSON or PDF bytes to the model/query tool.** Rejected: excessive
  context and a direct path around typed honesty rules.
- **Keep a fixed domain menu or dossier shortlist.** Rejected: immutable manifest
  publication already provides the single dynamic catalog.

## Consequences

Database breadth is narrower but evidence is much stronger. Missing/current-cycle
facts fall back to official web search with explicit disclosure. Cross-school rankings
describe their covered population rather than implying database-wide completeness.
The field index, embeddings, reconciler, old assets, old tools, and old normalization
rules disappear. Changes to a manifest domain require no Counselle code edit.

## Migration and rollback

The cutover is coordinated: publish immutable manifest `5.0.1`, extract compatible v8
packets, deploy the five reader views/grants, then deploy Counselle's new typed models,
tools, prompt, skills, renderer, and evals. Health and live contract checks validate
the current pointer and reader permissions before traffic moves.

Rollback is an application rollback plus credential/traffic cutback to the prior
service. Immutable manifests and packets are never rewritten or relabeled. Do not run
old and new semantic tool contracts behind the same deployment, and do not point the
new parser at the retired wide database.
