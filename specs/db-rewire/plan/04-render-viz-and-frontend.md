# Phases 4–5 — Render-viz v2, protocol fixtures, and frontend evidence UI

## Mission

Implement the two verified value channels and carry their resolved v2 payloads through
staging, SSE, replay, export, and the real frontend. The model chooses layout and
references; the resolver owns all displayed truth and provenance.

## Read first

- `specs/db-rewire/design.md` §§7–9, 13–14.
- `domain/specs.py`, `app/viz.py`, `agent_node.py`, `viz_signature.py`, `run_turn.py`,
  `steps.py`; all viz/source/placement/state/record tests.
- Frontend `src/api/chat/types.ts`, `sse.ts`, and every file under
  `src/features/ai-chat/` matching `Citation`, `Source`, `Viz`, `Message`, `turn-reducer`,
  `step-receipts`, or `ToolWidgets`.
- Current protocol fixture generator and all `tests/fixtures/protocol/*.json`.

No registry component is needed: this phase extends existing application-specific
cards/source rail. Before implementation, search the shadcn/COSS/AI Elements registries
for a commodity scroll/focus/badge primitive only; use existing design-system tokens
and primitives. Do not replace Counselle's honesty-specific UI with a generic component.

## 4.1 Strict Python input/output models

Rewrite `domain/specs.py` around four mutually exclusive CellInput variants. All input
models use `extra="forbid"` and frozen output models.

```python
class ColumnInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    unitid: int | None = None
    name: str | None = None
    domain: str | None = None

class MetricCellInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    metric_ref: str

class ProfileCellInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    profile_field: str

class SourcedCellInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    display: str = Field(min_length=1)
    raw: JsonValue = None
    marker: str

class UnavailableCellInput(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    unavailable: Literal[True]

CellInput = Annotated[
    MetricCellInput | ProfileCellInput | SourcedCellInput | UnavailableCellInput,
    Field(union_mode="left_to_right"),
]

class VizRowInput(BaseModel):
    label: str = Field(min_length=1)
    cells: tuple[CellInput, ...]

class SchoolRef(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    unitid: int | None
    name: str = Field(min_length=1)
    domain: str | None = None
```

Column validation:

- unitid present: ignore model name/domain after validation and replace both with
  canonical Catalog values;
- unitid absent: nonblank name required; optional domain passes a new strict
  `plausible_domain()` helper and is decoration only;
- unitid absent with no name, duplicate DB unitids, or duplicate normalized web-only
  identities is rejected before cell work.

Resolved cells are a discriminated available/unavailable union. Available cells carry
one v2 `CitationEnvelope` including marker and optional CDS evidence; unavailable cells
carry only `available=false`, `display="not available"`, label/ref context, and no
source/tier.

Known resolved model:

```python
class TabularRenderSpec(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    v: Literal[2] = 2
    type: Literal["stat_block", "comparison_table"]
    title: str
    columns: tuple[SchoolRef, ...]
    rows: tuple[VizRow, ...]

class OpaqueRenderSpec(BaseModel):
    model_config = ConfigDict(extra="allow", frozen=True)
    v: int
    type: str
    title: str | None = None
```

Provide one `parse_render_spec(payload)` function. For known types, validate the full
strict v2 shape and reject malformed data. For every other nonblank type, preserve an
opaque mapping with the base fields. `run_turn`, transcript, signatures, and frontend
mirrors must call the same conceptual guard instead of assuming rows.

## 4.2 Rewrite the actual tool signature

The PydanticAI wrapper in `app/agent_node.py`, not only `app/viz.py`, must expose:

```python
render_viz(
    type: str,
    columns: list[ColumnInput],
    rows: list[VizRowInput],
    title: str | None = None,
) -> dict[str, JsonValue]
```

Its docstring defines the four variants, qualified refs, read-first flow, exact
unavailable behavior, external-marker-only sourced channel, max-cell error, all-or-
nothing result, and compact success ack. No old `unitids`/`field_keys` parameter remains.

## 4.3 Resolver algorithm

Rewrite `app/viz.py` as small pure validation/resolution helpers plus the existing
staging seam. Preserve placement markers and batch-flush behavior.

Execute exactly:

1. Validate nonempty columns/rows, nonblank row labels, and every row width.
2. Require one column for `stat_block`; require at least two for `comparison_table`.
3. Compute `cell_count = len(columns) * len(rows)` and reject above Settings before
   DB/source work.
4. Resolve every DB column through Catalog. Collect unknown unitids as defects.
5. Validate web-only name/domain; never turn its domain into an official source chip.
6. Parse each metric ref with the canonical ref validator. Group DB reads by
   `(unitid,domain_id)`; group profile reads by `(unitid,group)`. Fetch each group once.
7. Resolve metric/profile cells only for DB-backed columns. A web-only column with a DB
   ref is a defect.
8. Resolve sourced cells only through `SourceRegistry.lookup_marker`. Require source
   `web|edu|reddit`, copy its Citation verbatim, use the model display/raw only, and
   never merge model citation metadata.
9. A valid DB ref whose normalized value is unavailable is a defect: instruct the
   caller to replace that cell with `{"unavailable":true}`. Unknown refs suggest up to
   three same-domain/profile-group refs using deterministic fuzzy ranking.
10. Explicit unavailable produces the exact inert hole and no source registration.
11. Collect all defects; do not stop at the first. `valid_cells` counts cells that
    would have resolved.
12. If any defect exists, return failure and leave staged cards/registry byte-for-byte
    unchanged.
13. If all cells are unavailable, return the canonical honesty error and stage nothing.
14. Across DB cells, if academic years or manifest versions differ, append the one
    rendered `edition_mismatch_comparison` caveat to every affected available envelope.
15. Build the resolved spec and source changes on `registry.fork()`; promote exact CDS
    evidence only now.
16. Stage/dedupe the card. Commit the registry fork only after staging succeeds.

Failure contract (zero-based row/col):

```json
{
  "ok": false,
  "status": "rejected",
  "rejected_cells": [
    {"row": 17, "col": 2, "reason": "unknown metric_ref ..."},
    {"row": 31, "col": 5, "reason": "marker [14] is not available in this turn"}
  ],
  "valid_cells": 478
}
```

Success contract:

```json
{
  "ok": true,
  "status": "rendered",
  "placement_marker": "[[viz:1]]",
  "cell_count": 480,
  "available_count": 470,
  "unavailable_count": 10,
  "source_count": 7,
  "sources": ["[1]", "[3]", "[7]"],
  "public_receipt": {
    "viz_type": "comparison_table",
    "value_count": 470,
    "schools": ["Yale University", "Harvard University"],
    "sources": ["[1]", "[3]", "[7]"]
  }
}
```

`source_count` and `sources` are distinct markers used by available cells, in numeric
marker order. Delete the old full result/table echo. `StepMapper.result_is_error`
treats `ok is False` or `status == "error"|"rejected"` as failure.

## 4.4 Signature, replay, and export

Rewrite `app/viz_signature.py`:

- known v2 types hash canonical truth-bearing resolved JSON: column unitid/name,
  row labels, displays/raw/availability, ref, marker, complete citation/evidence and
  caveats;
- continue ignoring title and decorative domain only if current placement behavior
  intentionally treats them as non-semantic;
- unavailable and available states never collide;
- different document SHA, profile SHA, evidence, vintage, or tier never collide;
- opaque types use stable canonical full-payload JSON and never inspect rows.

Update `app/run_turn.py`, `records.py`, `transcript.py`, and tests so outer events remain
v1 and nested known specs are v2. Unknown payloads survive store/replay. Markdown export
serializes known tables only; unknown types emit a safe title/type placeholder and no
arbitrary payload values.

## 4.5 Backend honesty-critical tests

Rewrite `tests/app/test_viz_pure.py` to cover every step above, including grouped fetch,
DB-column canonicalization, external-only sourced refs, official-marker laundering
rejection, all defects at once, max-before-I/O, unavailable correction, registry
transaction rollback, mismatch caveat, compact ack, and no table echo.

Rewrite live `test_viz.py` to derive a covered school/domain/verified ref from the live
manifest. Find two schools with a common verified ref dynamically for comparison; skip
with a precise coverage reason only if the live DB cannot provide two. Keep unknown
unitid and web-only tests.

Update:

- `test_viz_placement.py` fixtures to v2 while preserving placement behavior;
- `test_viz_signature.py` for provenance/null IDs/opaque payloads;
- `test_state.py`, `test_run_turn.py`, `test_records.py`, API transcript/SSE tests;
- `domain/test_specs.py` for exact variants, strict extras, row width, cardinality,
  qualified refs, unavailable and opaque parsing.

## 5.1 TypeScript contract: one current vocabulary

In `frontend/src/api/chat/types.ts`, export `SOURCE_NAMES` and derive its type:

```ts
export const SOURCE_NAMES = ["cds", "profile", "web", "edu", "reddit"] as const;
export type SourceName = (typeof SOURCE_NAMES)[number];

export type Caveat = { kind: string; text: string };
export type EvidenceItem = {
  eid: string;
  value_display: string;
  label: string;
  page: number;
  section?: string | null;
  row_label?: string | null;
  column_label?: string | null;
  excerpt: string;
};
export type SourceEntry = {
  v: 2;
  index: number;
  citation: Citation;
  label: string;
  snippet?: string | null;
  evidence: EvidenceItem[];
  evidence_omitted_count: number;
};
export type SourceFocus = { index: number; evidenceId?: string };
export type MessageSourcesPayload = {
  sources: SourceEntry[];
  active?: SourceFocus;
};
```

Mirror Citation/envelope/SchoolRef/columns exactly. Define a strict known tabular guard
and an opaque unknown type. Unavailable cell citation/evidence/marker are null/absent.
Keep frontend-only legacy types with opaque source strings and v1 schools/string caveat;
do not add old names to `SOURCE_NAMES`.

Import `SOURCE_NAMES` in `sse.ts`; delete its independent Set. Validators must:

- accept outer event v1 + nested v2;
- enforce source-conditional current citations/evidence;
- accept nullable unitid;
- validate known tabular types strictly with columns;
- preserve unknown base payloads without assuming rows;
- accept explicitly detected legacy transcript payloads only in the replay path, not
  live v2 SSE.

Widen marker parsing to positive integers. Update `StepDetail`: remove `field_keys`, add
singular `domain_id`, and leave `domains` exclusively for Tavily hosts.

## 5.2 One used-source selection helper

Replace duplicate/synthetic source logic with one exported
`sourcesPayloadFor(message, focus?)` or `sourcesUsedByMessage()` used by both
`MessageSources` and `ChatMessages`:

1. collect visible prose marker indexes;
2. walk available cells only for known tabular viz;
3. take their resolved marker/index; do not re-infer CDS identity if the cell carries a
   marker;
4. union by index, preserve source registry order, and exclude unused cumulative/legacy
   entries;
5. fail closed on missing/ambiguous legacy matches;
6. never count unavailable cells or opaque payload data.

Remove `dbUsed`, `dbSchools`, and the `"counselle-data"` sentinel entirely.

## 5.3 Citation click path

Thread `SourceFocus` through:

```text
CitationRenderer / VizBlock
  -> ChatMessage / AgentRunView
  -> ChatMessages
  -> AiChatPage payload state
  -> SourcesRail
```

Update the mandatory files:

- `CitationRenderer.tsx`: CDS/profile `[n]` remains visible as an accessible compact
  button and opens `{index}`; external named chips keep existing behavior. Correct the
  stale comment in `remark-citation-refs.ts`.
- `ChatMessage.tsx`, `ChatMessages.tsx`, `AgentRunView.tsx`, `AiChatPage.tsx`: change
  index-only callbacks to `SourceFocus`, and pass sources/focus to cards/rail.
- `MessageSources.tsx`: show the count/list of real used entries; no synthetic DB card.

Prose never preselects evidence. A CDS viz cell opens
`{index, evidenceId: cell.field}`. External/profile cells open `{index}` unless a future
profile evidence model explicitly defines an evidence ID.

## 5.4 `VizBlock` behavior

Consume the canonical API `RenderSpec`, not a second loose mirror.

- known `stat_block|comparison_table` dispatch through `isTabularRenderSpec`;
- unknown type shows a titled “requires a newer client” fallback and never renders
  arbitrary fields;
- every available cell displays Official or Community; unavailable is inert and has no
  badge;
- source badge/button invokes the exact focus;
- use collision-safe keys including index, e.g. `db:${unitid}:${index}` or
  `web:${name}:${domain ?? ""}:${index}`;
- render canonical school name and optional favicon domain; web domain is decoration;
- keep horizontal overflow inside the card and use design tokens, not one-off values;
- no speculative virtualization or big-grid component;
- do not claim CLS skeleton behavior unless a real protocol sizing placeholder is
  implemented. The design does not provide pre-viz dimensions, so acceptance is
  stable contained layout, not a nonexistent skeleton.

## 5.5 `SourcesRail` behavior

Render actual used entries in marker order. For CDS:

- header: marker, server label (school + edition), Official tier, acquisition
  `source_kind`, retrieved date, and safe URL if present;
- evidence: sort a copy by page/eid, show label/value, page, optional section/row/
  column, and excerpt;
- IDs: `source-row-${index}` and a safely escaped/stable
  `source-evidence-${index}-${eid}` mapping;
- exact evidence focus scrolls/rings that item; missing/legacy evidence falls back to
  entry focus;
- render `…and N more values from this document` from
  `evidence_omitted_count`;
- unsafe URLs remain inert.

Profile and external entries remain flat. Old evidence-less turns never crash. Delete
the filter that currently removes DB entries.

## 5.6 Reducer and frontend tests

Update `turn-reducer.ts`:

- semantic signatures include full resolved v2 truth/provenance;
- known tables replay/export using columns;
- opaque unknown payloads survive and export a safe placeholder;
- no code assumes every cell has Citation;
- transcript replay retains outer v1.

Required tests:

- `sse.test.ts`: nested versions, source conditions, caveats/evidence, null unitid,
  malformed known vs accepted opaque unknown;
- `citations.test.ts`: exact DB set, prose/viz source union, viz-only CDS, unused
  exclusion, marker width, unavailable ignored;
- `CitationRenderer.test.tsx`: CDS/profile button, external behavior, unresolved fail
  closed;
- `VizBlock.test.tsx`: mixed CDS/edu/Reddit/unavailable, tier visibility, exact click,
  null keys, opaque fallback, contained overflow;
- `MessageSources.test.tsx`: actual documents, no synthetic credit, viz-only source;
- `SourcesRail.test.tsx`: metadata/evidence ordering/focus/omitted count/legacy/URL;
- `ChatMessage`, `ChatMessages`, `AiChatPage`: end-to-end prose entry focus and CDS
  cell evidence focus;
- `turn-reducer.test.ts`: provenance dedupe, v2 replay/export, unknown and legacy.

## 5.7 Shared protocol fixtures

Update only the generator, then regenerate:

```bash
REGEN_PROTOCOL_FIXTURES=1 uv run pytest tests/app/test_protocol_fixtures.py
git diff -- tests/fixtures/protocol/
uv run pytest tests/app/test_protocol_fixtures.py
```

The canonical full fixture must contain:

- outer event v1;
- v2 CDS envelope with document metadata, structured multiple caveats, and evidence;
- v2 profile citation;
- v2 tabular spec using columns;
- one DB CDS cell, one registered external cell, one explicit unavailable cell;
- a DB column and null-unitid web-only column;
- sources event with one evidence-bearing CDS document and one flat external entry;
- compact render ack and no table echo;
- singular `domain_id`, with Tavily `domains` still separate.

Strengthen the frontend fixture test to assert those facts, not merely successful parse.
Keep a separate manually named v1 legacy fixture for read compatibility; do not use it
as the current protocol golden.

## 5.8 Exit gate

```bash
uv run pytest tests/domain/test_specs.py tests/app/test_sources.py \
  tests/app/test_viz_pure.py tests/app/test_viz_signature.py \
  tests/app/test_protocol_fixtures.py
uv run pytest -m "not live_llm and not live_search and not live_db"
uv run ruff check . && uv run mypy .
cd frontend && npm run typecheck && npm test && npm run lint && npm run build
```

Inspect a real browser flow at desktop and narrow widths: mixed card, prose CDS marker,
cell evidence focus, evidence overflow, unavailable hole, and old turn. Screenshots go
under `artifacts/db-rewire/`. Phase 5 is complete only when no synthetic “Counselle
data” entry remains and a clicked CDS cell lands on its exact page evidence.

