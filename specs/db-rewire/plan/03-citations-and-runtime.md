# Phase 3 — Citation v2, evidence ledger, caveats, and ambient runtime

## Mission

Carry profile/CDS truth from the Phase 2 normalized values into per-turn sources and
the system prompt without eagerly checkpointing exploratory evidence. Preserve the
outer protocol and completed legacy turns while making all new citations strict v2.

## Read first

- `specs/db-rewire/design.md` §§6, 8–11, 13.
- `domain/envelope.py`, `domain/events.py`; `app/sources.py`, `state.py`,
  `tool_middleware.py`, `graph.py`, `prompt.py`, `agent_node.py`, `run_turn.py`,
  `records.py`, `transcript.py`, `turns.py`; corresponding tests.
- Current search citation construction in `adapters/tavily_tools.py`.
- Current prompt assets and loader in `config/assets/prompts/`.

## 3.1 Exact v2 domain contract

Rewrite `domain/envelope.py` with one current vocabulary and source-conditional
validation. Keep legacy models separate and non-exported from current constructors.

```python
JsonScalar = str | int | float | bool
JsonValue = JsonScalar | list["JsonValue"] | dict[str, "JsonValue"] | None
SourceName = Literal["cds", "profile", "web", "edu", "reddit"]
Tier = Literal["official", "community"]

class Caveat(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: str = Field(pattern=r"^[a-z][a-z0-9_]*$")
    text: str = Field(min_length=1)

class EvidenceItem(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    eid: str
    value_display: str
    label: str
    page: int = Field(ge=1)
    section: str | None = None
    row_label: str | None = None
    column_label: str | None = None
    excerpt: str = Field(min_length=1)

class Citation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    v: Literal[2] = 2
    source: SourceName
    tier: Tier
    vintage: str
    url: str | None = None
    document_sha256: str | None = None
    source_kind: str | None = None
    retrieved_at: datetime | None = None
    academic_year: int | None = None
    manifest_version: str | None = None
    school_unitid: int | None = None
    profile_sha256: str | None = None

class CitationEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    v: Literal[2] = 2
    field: str | None
    label: str
    display: str
    raw: JsonValue = None
    available: bool
    unit: str | None = None
    citation: Citation | None = None
    evidence: EvidenceItem | None = None
    caveats: tuple[Caveat, ...] = ()
    marker: str | None = None
```

Use validators to enforce:

- CDS: official, lowercase 64-char SHA, academic year, manifest version, source kind,
  retrieved time, and school unitid required; profile snapshot fields null.
- Profile: official, unitid + 64-char profile SHA required; document fields null.
- Web/edu: official; URL required; all DB identity fields null.
- Reddit: community; URL required; all DB identity fields null.
- Available envelopes: citation and nonblank display required. CDS available values
  require evidence whose `eid == field` and `value_display == display`.
- Unavailable envelopes: exact display `not available`, null raw/unit/citation/evidence/
  marker. They may carry structured caveats/reason kinds.
- Current code never accepts the legacy string caveat/raw-table shape.

If a profile raw leaf is an array, preserve JSON-compatible raw data; render code uses
the data-layer display, not raw. Reject non-finite floats at the boundary.

## 3.2 Structured caveat catalog

Add `config/assets/caveats.yaml`, validated and preloaded at boot. Give it exactly one
entry for every canonical kind used by code:

- `profile_snapshot`
- `stale_edition`
- `partial_packet`
- `definition_drift`
- `not_in_template_version`
- `edition_mismatch_comparison`
- `coverage_denominator`
- any separately surfaced `not_reported`, `not_applicable`, or `suppressed` reason if
  student-facing wording differs.

Each item has `text` and an exact declared `slots` list. Implement one strict renderer:

- reject unknown kind, missing/unexpected slot, conversion, or format specification;
- use a `Formatter` parse rather than permissive `.format(**values)`;
- return a new frozen `Caveat`;
- never duplicate wording in prompts, skills, Python, TypeScript, or tests.

Tests assert canonical rendering and simultaneous attachment. Snapshot tests may pin
the asset, but agent-output tests must judge kinds/semantics rather than brittle prose.

## 3.3 Per-turn source registry

Separate checkpoint-only bookkeeping from the public source event.

```python
class RegisteredSource(BaseModel):             # app/state.py
    index: int = Field(ge=1)
    citation: Citation
    label: str
    snippet: str | None = None
    evidence: tuple[EvidenceItem, ...] = ()
    evidence_seen_eids: tuple[str, ...] = ()

class SourceEntry(BaseModel):                  # domain/events.py
    v: Literal[2] = 2
    index: int = Field(ge=1)
    citation: Citation
    label: str
    snippet: str | None = None
    evidence: tuple[EvidenceItem, ...] = ()
    evidence_omitted_count: int = Field(ge=0)
```

`SourceRegistry` operates by immutable replacement and provides:

- `register_source(citation,label,snippet) -> marker`;
- `lookup_marker(marker) -> RegisteredSource | None` using
  `^\[([1-9]\d*)\]$` (no three-digit cap);
- `marker_for(citation)`;
- `register_pending_evidence(marker,evidence)` in a runtime-only map;
- `promote_pending_evidence(index,eid)`;
- `register_used_evidence(index,evidence)` for accepted viz cells;
- `fork()` and `commit_from(candidate)` for render transactions;
- `dump_state()` and `entries_for_wire()` as distinct serializers.

Dedupe identity is exact and conditional:

```python
def source_key(c: Citation) -> Hashable:
    if c.source == "cds":
        return ("cds", c.document_sha256)
    if c.source == "profile":
        return ("profile", c.school_unitid, c.profile_sha256)
    return (c.source, c.url, c.vintage)
```

CDS label is server-built from canonical school name + edition; profile label from
canonical school name + snapshot. Never ask the model or frontend to derive these.
When a used EID is new, append it to `evidence_seen_eids`; append its full evidence to
`evidence` only while below Settings cap. Wire omitted count is exact:

```python
len(evidence_seen_eids) - len(evidence)
```

Sort public CDS evidence by `(page, eid)` without mutating stored tuples. Deduplicate
repeated EIDs across prose/viz/turn retries. Cap excerpts to the existing 300-character
limit at registration, not in the UI.

### Registry lifecycle

At every genuinely new answer—new turn, edit, or regeneration—initialize an empty
registry and pending map. A detached client reattaches to the same running task without
state changes. A parked clarification resume preserves the unfinished answer's current
registry/pending evidence so pre-interruption reads remain valid. Completed turn
records keep their emitted sources, so transcript replay has the correct per-answer
bibliography. Terminate in-flight turns at deployment; do not try to translate a
half-streamed v1 registry.

Update `app/turns.py`, graph input/resume construction, state tests, edit/regeneration,
detach/reattach, parked-resume tests, and record/transcript helpers to pin this
behavior. In particular, history rewrite sets `source_registry=[]` instead of restoring
the last surviving completed record; parked resume leaves the current unfinished
registry intact. Do not carry a completed previous answer's indexes into the next one.

## 3.4 Exact used-evidence ledger for prose

The visible document marker cannot identify a metric. Solve this without a fifth tool
or visible syntax by pairing the marker in each `get_domain` row with an internal
evidence-use token:

```text
[3][[evidence:3:admissions.applicants_men]]
```

Rules:

- middleware registers the document source immediately but places evidence only in
  the runtime pending map;
- the compact tool row gives the model the composite string as its copy-verbatim
  marker;
- add `EvidenceMarkerStripper` beside the existing viz marker/stream processor;
- it handles arbitrary chunk splits, removes the hidden portion before SSE and before
  persistence, and promotes evidence only for an exact pending `(index,eid)` pair;
- malformed/invented tokens are stripped and ignored; they never create a source or
  evidence row;
- a plain source marker with no evidence token remains valid for document-level prose;
- the visible response and stored assistant text contain only `[3]`;
- clicking prose `[3]` opens the document, never a preselected evidence item;
- accepted viz cells promote exact evidence directly and do not emit hidden text.

Implement the token grammar in one backend module and expose a helper used by tool
annotation/tests; do not duplicate regexes. Encode/validate EIDs using the canonical
qualified-ref grammar—no arbitrary delimiters. Tests must cover a token split at every
character boundary, adjacent tokens, repeated evidence, malformed index/ref, invented
pair, cancellation, retry, and proof that hidden syntax never reaches delta/final text.

Change `app/tool_middleware.py` so generic web/profile annotations still register
normally, but `get_domain` does not eagerly append all evidence. Overflow processing
must preserve marker/evidence-use strings for rows actually returned to the model.

## 3.5 Search citations

Update `adapters/tavily_tools.py` to construct v2 `Citation` objects:

- `search_web` -> `web`, official;
- `search_school_site` -> `edu`, official;
- `search_reddit` -> `reddit`, community;
- URL/vintage required, DB-only fields null;
- caveats belong on envelopes, not duplicated in Citation.

Preserve safe URL validation and search snippets. Search entries have no evidence list;
their snippet remains the flat supporting context. Update tests for strict source/tier
combinations.

## 3.6 Legacy completed-turn read adapter

Do not put `ipeds|scorecard` into current `SourceName`. Add a compatibility parser used
only when reading stored turn/transcript JSON:

- source is opaque string;
- old `caveat: str|null`, `raw_table`, `schools`, v1 envelope/spec fields optional;
- old source entries may have no evidence;
- frontend and transcript functions render them as legacy, evidence-less, and
  non-highlightable where identity cannot be resolved;
- no legacy object can be inserted into the live v2 SourceRegistry or passed to a new
  render call;
- a bad historical payload degrades that old card/source only, not the whole transcript.

Add a checked-in v1 compatibility fixture separate from the regenerated current-v2
protocol fixtures. Test viewing an old turn, starting a new v2 turn in the same chat,
editing/regenerating, and preserving old display/source text without minting old kinds.

## 3.7 Ambient data picture

Add `config/assets/prompts/data_picture.md` with exactly these slots:

```text
as_of, n_schools, snapshot_date, manifest_version, total_metrics,
covered, fully, partial, stale, by_year, domain_menu
```

Use this content shape (wording remains asset-owned):

```markdown
## What's in the database (live, as of {as_of})
- {n_schools} US 4-year schools — every one has an identity profile
  (profile snapshot date(s): {snapshot_date}; identity only, verify time-sensitive facts).
- CDS data (manifest {manifest_version}, {total_metrics} metrics) for {covered} schools —
  {fully} fully extracted, {partial} partial; {stale} are older editions (stale).
  Editions: {by_year}.
- Domains: {domain_menu}
- No first-party data for a school/question → its profile + web search are your sources.
  Never answer "across all schools" questions as if {n_schools} schools have CDS data.
```

Rendering rules:

- thousands separators;
- UTC successful-snapshot `as_of`;
- one profile date or oldest–newest range;
- academic year `2024` renders `2024-25`;
- empty edition map renders `none`;
- domains stay in manifest order as `id (count)`, joined consistently;
- output is persisted in `TurnState` so detached/resumed execution and audit see the
  exact context used.

Rewrite `app/prompt.py` with the same strict slot renderer used for caveat assets or a
shared tiny asset formatter. `build_system_prompt` accepts only
`temporal_context`, `student_context`, and rendered `data_picture`; it fills exactly
those plus `subreddit_menu`. Delete static-map, dossier-summary, tier-note, and
school-count helpers/imports.

In `app/graph.py` prepare:

1. call `catalog.maybe_refresh()` every turn;
2. capture one immutable snapshot;
3. render the data picture;
4. store it on state;
5. build the system prompt from that same text.

Remove `CalendarEntry`, `get_data_calendar`, and calendar state. Update
`app/agent_node.py`'s actual prompt call; the old `school_count` caller is a mandatory
touchpoint. Initial malformed/missing assets fail boot.

Ambient/raw SQL numbers are computed metadata, not document citations. Prompt wording
must require “live Counselle data picture/query as of …” plus a coverage-denominator
caveat if the model surfaces them. Named school metric values still require typed
source markers.

## 3.8 Phase exit gate

Tests must prove:

- every source-specific Citation invariant and v2 round trip;
- multiple caveats, profile identity, CDS evidence equality;
- conditional source dedupe, per-turn reset, immutable updates, fork/rollback;
- pending evidence is never checkpointed, only exact use is promoted, omitted count is
  exact, evidence ordering/cap survives state round trip;
- hidden evidence tokens never leak under arbitrary streaming chunks;
- v1 completed turns render, but new registries reject legacy shapes;
- search citations remain safe and correctly tiered;
- catalog refresh/data-picture formatting/state persistence and stale fallback;
- system prompt has exactly the four final slots and no old blocks.

Run the routine suite, Ruff, and mypy. Do not regenerate shared protocol fixtures until
Phase 4 finalizes RenderSpec v2.
