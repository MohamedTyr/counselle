# ADR 0018 — Central typed configuration + versioned data assets; no hardcoded tunables

**Status:** Accepted

## Context
"Anything a developer would plausibly want to change must be configurable in one place" is a hard requirement. Tunables were accumulating in scattered homes: models in env vars, research caps in GPT-Researcher's own env names, the subreddit menu "in the agent's context", prompts implicitly in code, DB guardrails unspecified.

## Decision
Three buckets, one policy:

1. **Typed settings** (`config/settings.py`, pydantic-settings): one `Settings` object loaded once at startup, **fail-fast validated** (missing/malformed → boot error, never a silent default). Layered: code defaults → environment/`.env` → explicit overrides. Holds everything deploy- or cost-relevant: per-agent models, provider credentials, research depth/breadth/concurrency/cost ceilings, DB DSNs + statement timeout + row cap, checkpointer config + session TTL, embedding model + reconcile interval, default source-config, Tavily key, API host/CORS, log level. `.env.example` documents every variable.
2. **Versioned data assets** (`config/assets/`): editorially-tuned content, hot-changeable without code changes — agent prompts (one file per agent), the labeled subreddit menu, the curated dossier field shortlist, the admission-season calendar table.
3. **Live-derived from the DB (never configured, never hardcoded):** the data calendar, coverage tiers, the field catalog, `current_cycle_year`, school URLs. Facts come from the database at runtime.

**What may be hardcoded:** only invariants — the reading-rule logic itself (R1–R12 are a spec, not a preference), the envelope/protocol schemas (versioned code), SQL parameterization. The test: *would a developer ever plausibly change this without an architecture discussion?* If yes → bucket 1 or 2.

## Rationale
- One discoverable surface per kind of knob kills config drift and the "where is this set?" hunt.
- Fail-fast validation surfaces misconfiguration at boot, not mid-conversation with a student.
- Prompts and menus as reviewable files make editorial tuning a diff, not a deploy-blocking code change.
- Deriving facts live (bucket 3) is what keeps recency and coverage honest after every pipeline re-ingest — configuring them would be a lie waiting to happen.

## Alternatives considered
- **Env vars only** — rejected: prompts/menus/shortlists don't belong in env; they're multi-line editorial content needing diffs.
- **A config database / admin UI** — rejected for MVP1: infrastructure for a problem we don't have (YAGNI).
- **Scattered per-module constants** — rejected: the exact failure mode the requirement forbids.

## Consequences
- Adding any new tunable means touching `Settings` or `config/assets/` — reviewers reject inline constants for tunables.
- GPT-Researcher's own env-var config is set *from* `Settings` at initialization, so there is still one source of truth.
- Startup cost: a few milliseconds of validation; worth it.
