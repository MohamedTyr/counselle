"""Deterministic, zero-LLM scorer for CDS extraction tuning runs.

OFFLINE TEST HARNESS ONLY. Nothing here is wired into the runtime pipeline,
and it must never be: inline `[N]` citations authored by the agent are the
runtime honesty gate, and every programmatic output validator was deliberately
removed. This module exists so a human can compare a champion run against a
baseline run and trust the delta.

Design rules this file obeys:

* Pure Python. No LLM, no network, no DB. `load_compiled_manifest()` is
  filesystem-only; `verify_manifest_current()` (which hits Postgres) is never
  called from here.
* The metric universe comes from the compiled manifest, never from a
  hardcoded list or count -- so the scorer survives the catalog cut.
* One normalizer, one match rule per unit. The GT-diff tooling imports
  `normalize()` / `compare()` verbatim rather than reimplementing them.
* No fuzzy credit. Every transform beyond formatting-stripping is recorded in
  the per-comparison `transforms` list so an autopsy can find
  scorer-forgiveness bugs. When a comparison is genuinely ambiguous the
  scorer counts it WRONG and logs why.

SCORER_VERSION is stamped into every report. **If it changes mid-loop, every
persisted run -- champion and baseline alike -- must be re-scored with the new
version before any new comparison is made.** Mixing report versions silently
compares two different definitions of "correct".
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Literal

REPO_ROOT = Path(__file__).resolve().parents[4]
if str(REPO_ROOT) not in sys.path:  # importable as a script from anywhere
    sys.path.insert(0, str(REPO_ROOT))

from app.cds.manifest import load_compiled_manifest  # noqa: E402

# Bump on ANY change to normalization, match rules, or outcome classification.
# See module docstring: a bump invalidates every previously persisted report.
SCORER_VERSION = "1.3.0"
# 1.3.0: `fitness()` now prepends a `valid` flag (1.0/0.0) ahead of the four
#        existing axes. A report whose `run_errors` is non-empty is no longer
#        a real measurement -- it must lose to EVERY valid report on the first
#        lexicographic comparison, never fall through to accuracy/cost/latency
#        where a run that did almost no work can look cheap and win. `report`
#        also gains explicit `valid` / `failed_call_count` keys so a reader
#        never has to infer validity from `run_errors`, and `summarize()`
#        leads with a loud banner naming the failed-call count whenever
#        `run_errors` is non-empty. Per-comparison outcome classification
#        (correct/wrong/missed/hallucinated/correct_abstention) is unchanged.
# 1.2.0: `_num_canon` accepts bare-dot decimals (`.48`, `48.`) for EVERY numeric
#        rule, and a `present` GT value that will not normalize is quarantined
#        as `gt_error` instead of being charged to the engine as `wrong`.
#        Both change comparison semantics -- re-score persisted reports.

# The only `schema_version` a GT file may declare. Enforced at load time: a GT
# file written against a different schema is a hard error, never a silent load.
GT_SCHEMA_VERSION = 1

# ---------------------------------------------------------------------------
# Metric identity
# ---------------------------------------------------------------------------

MetricKey = tuple[str, str]  # (domain, bare_metric_id)

Outcome = Literal[
    "correct",
    "wrong",
    "missed",
    "hallucinated",
    "correct_abstention",
    "uncovered",
    "unreadable",
    "gt_error",
]

OUTCOMES: tuple[Outcome, ...] = (
    "correct",
    "wrong",
    "missed",
    "hallucinated",
    "correct_abstention",
    "uncovered",
    "unreadable",
    "gt_error",
)

# Buckets that are NOT charged to the engine and must stay out of every
# accuracy/coverage denominator: the metric was never scoreable in the first
# place (no GT entry / illegible source / a broken GT entry).
UNSCORED_OUTCOMES: frozenset[str] = frozenset({"uncovered", "unreadable", "gt_error"})

# `availability_status` values the engine may emit (domain/cds/claims.py:15).
# Only "reported" is an extraction; the other four are recognized abstentions.
EXTRACTED_STATUS = "reported"
KNOWN_AVAILABILITY_STATUSES: frozenset[str] = frozenset(
    {
        "reported",
        "not_reported",
        "not_applicable",
        "suppressed",
        "not_in_template_version",
    }
)


def metric_key(domain: str | None, metric_id: str) -> MetricKey:
    """Normalize the two shapes the runner may emit into `(domain, bare_id)`.

    Accepted:
      * ``metric_id="admissions.applicants_total"`` (domain prefix embedded,
        the manifest's own form), with or without a separate ``domain`` field
      * ``metric_id="applicants_total"`` plus ``domain="admissions"``

    A fully-qualified id always wins over a conflicting ``domain`` field --
    the id is what the model was actually asked to emit.
    """
    metric_id = (metric_id or "").strip()
    if "." in metric_id:
        head, _, tail = metric_id.partition(".")
        return (head, tail)
    if not domain:
        raise ValueError(
            f"metric_id {metric_id!r} is not domain-qualified and no `domain` field was given"
        )
    return (domain.strip(), metric_id)


def manifest_universe(manifest: Any | None = None) -> dict[MetricKey, dict[str, Any]]:
    """Every metric in the compiled manifest -> its compiled definition.

    This is THE metric universe. Never hardcode a count; it changes with the
    catalog cut and the scorer must follow it.
    """
    compiled = manifest if manifest is not None else load_compiled_manifest()
    universe: dict[MetricKey, dict[str, Any]] = {}
    for domain in compiled.content["domains"]:
        domain_id = domain["id"]
        for metric in domain["metrics"]:
            universe[metric_key(domain_id, metric["id"])] = metric
    return universe


# ---------------------------------------------------------------------------
# Normalization
# ---------------------------------------------------------------------------

Rule = Literal["count", "percent", "money", "ratio", "gpa", "boolean", "text", "number"]

# manifest `unit` -> normalization rule. `unit` is the real discriminator in
# the compiled manifest (`type` is too coarse: 58 percent-semantic metrics are
# typed `string` on purpose, to preserve qualifier tokens like "<1%").
_UNIT_RULES: dict[str, Rule] = {
    "boolean": "boolean",
    "category": "text",
    "percent": "percent",
    "usd": "money",
    "ratio": "ratio",
    "gpa": "gpa",
    "score": "count",
    "carnegie_units": "number",
    "academic_year": "text",
    "date": "text",
    "email": "text",
    "text": "text",
    "url": "text",
}

# Tokens that mean "the engine (or the document) said nothing here". Checked
# BEFORE any numeric parse, and before range detection, so a bare en-dash is
# an abstention rather than a malformed range.
_ABSENT_TOKENS = frozenset(
    {
        "",
        "-",
        "--",
        "–",  # en dash
        "—",  # em dash
        "−",  # minus sign
        "n/a",
        "na",
        "n.a.",
        "none",
        "null",
        "nil",
        "not reported",
        "not applicable",
        "not available",
        "blank",
    }
)

_TRUE_TOKENS = frozenset({"true", "yes", "y", "x", "✓", "✔", "checked", "/yes", "on"})
_FALSE_TOKENS = frozenset({"false", "no", "n", "unchecked", "/off", "/no", "off"})

_QUALIFIERS = ("<=", ">=", "≤", "≥", "<", ">", "~", "≈")
_DASHES = "‐‑‒–—―−"
_RANGE_RE = re.compile(r"^(?P<lo>[^\s]+)\s*-\s*(?P<hi>[^\s]+)$")


@dataclass(frozen=True)
class Normalized:
    """Canonical form of one value under one rule.

    `absent` is True when the value means "nothing here". `canonical` is None
    exactly when `absent` is True or the value could not be parsed under the
    rule (`unparseable=True`). An unparseable ENGINE value is a mismatch --
    never a pass. An unparseable `present` GROUND-TRUTH value is unwinnable and
    is quarantined as `gt_error`, never charged to the engine.
    """

    canonical: str | None
    absent: bool = False
    unparseable: bool = False
    transforms: tuple[str, ...] = ()


ABSENT = Normalized(canonical=None, absent=True)


def rule_for_metric(metric: Mapping[str, Any]) -> Rule:
    """Pick the normalization rule for a compiled manifest metric.

    Priority: `type == boolean` wins (a boolean is never numerically
    compared), then the `unit` table, then `type` as a fallback for units the
    manifest may grow later.
    """
    if metric.get("type") == "boolean":
        return "boolean"
    unit = str(metric.get("unit", ""))
    if unit in _UNIT_RULES:
        return _UNIT_RULES[unit]
    metric_type = metric.get("type")
    if metric_type == "integer":
        return "count"
    if metric_type == "number":
        return "number"
    return "text"


def _pre(value: Any) -> str:
    """Unicode-normalize and collapse whitespace, without touching semantics."""
    text = unicodedata.normalize("NFKC", str(value))
    text = text.replace(" ", " ")
    return re.sub(r"\s+", " ", text).strip()


# The ONLY numeric literal this module recognizes. Every rule that parses a
# number goes through `_num_canon`, so this pattern is the single definition of
# "is a plain number" for percent / count / money / gpa / number / ratio alike.
#
# Both bare-dot forms are accepted because they are FORMATTING variants of the
# same number, not looser comparisons: real CDS pages print `.48` for 0.48 and
# `48.` for 48, and AcroForm field values carry those spellings through
# verbatim. Rejecting them made every such value unwinnable on the GT side AND
# scored a faithful engine `wrong` for reproducing the page exactly.
# Precision is still meaning: `56` and `56.3` stay different canonical strings,
# and a lone `.`, `-.`, `..5` or `48..` still fails to match (-> unparseable,
# never silently coerced to 0).
_NUMBER_RE = re.compile(r"-?(?:\d+(?:\.\d*)?|\.\d+)")


def _num_canon(text: str) -> str | None:
    """Canonical decimal string: separators stripped, trailing zeros stripped,
    never exponent form. Returns None if `text` is not a plain number.

    `1,234` -> `1234`; `56.30` -> `56.3`; `56` -> `56` (so `56` != `56.3`);
    `.48` -> `0.48` and `48.` -> `48` (leading/trailing bare dot).
    """
    stripped = text.replace(",", "").replace("_", "").replace(" ", "").lstrip("+")
    if not _NUMBER_RE.fullmatch(stripped):
        return None
    try:
        number = Decimal(stripped)
    except InvalidOperation:  # pragma: no cover - guarded by the regex above
        return None
    number = number.normalize()
    if number == 0:
        return "0"
    exponent = number.as_tuple().exponent  # str for NaN/Inf, which the regex excludes
    if isinstance(exponent, int) and exponent > 0:  # 1.234E+3 -> 1234
        number = number.quantize(Decimal(1))
    return format(number, "f")


# Unicode qualifier -> ASCII canonical. Each rewrite is a REAL transform and is
# logged: `≈`->`~` in particular equates two different approximation markers,
# and `≤`->`<=` folds a typographic glyph a GT author may have transcribed
# either way. The module rule is "every transform beyond formatting-stripping
# is logged"; these entries are what keeps that rule true.
_QUALIFIER_REWRITES = {"≤": "<=", "≥": ">=", "≈": "~"}
_QUALIFIER_TRANSFORMS = {
    "≤": "qualifier_unicode_le_normalized",
    "≥": "qualifier_unicode_ge_normalized",
    "≈": "qualifier_approx_unified",
}


def _split_qualifier(text: str) -> tuple[str, str, tuple[str, ...]]:
    """-> (canonical qualifier, remaining body, transforms logged)."""
    for qualifier in _QUALIFIERS:
        if text.startswith(qualifier):
            canonical = _QUALIFIER_REWRITES.get(qualifier, qualifier)
            tag = _QUALIFIER_TRANSFORMS.get(qualifier)
            return canonical, text[len(qualifier) :].strip(), (tag,) if tag else ()
    return "", text, ()


def _as_range(text: str, inner: Rule) -> Normalized | None:
    """`1200-1400` / `1200 – 1400` -> `1200-1400`, both bounds normalized.

    Only fires when BOTH sides parse under `inner`; otherwise the value falls
    through to the scalar path (so `N/A` and a bare dash stay abstentions).
    """
    flattened = text
    for dash in _DASHES:
        flattened = flattened.replace(dash, "-")
    match = _RANGE_RE.match(flattened)
    if match is None:
        return None
    lo = normalize_text(match["lo"], inner)
    hi = normalize_text(match["hi"], inner)
    if lo.canonical is None or hi.canonical is None:
        return None
    return Normalized(
        canonical=f"{lo.canonical}-{hi.canonical}",
        transforms=("range_bounds_normalized",) + lo.transforms + hi.transforms,
    )


def normalize_text(value: Any, rule: Rule) -> Normalized:
    """Normalize one already-extracted value under `rule`. Pure and total."""
    if value is None:
        return ABSENT
    if isinstance(value, bool):
        # Real Python bools bypass string parsing entirely.
        if rule == "boolean":
            return Normalized(canonical="true" if value else "false")
        return Normalized(canonical=None, unparseable=True, transforms=("bool_for_nonbool_rule",))

    text = _pre(value)
    if text.casefold() in _ABSENT_TOKENS:
        return ABSENT

    if rule == "boolean":
        token = text.casefold()
        if token in _TRUE_TOKENS:
            extra = ("acroform_export_value",) if token.startswith("/") else ()
            return Normalized(canonical="true", transforms=extra)
        if token in _FALSE_TOKENS:
            extra = ("acroform_export_value",) if token.startswith("/") else ()
            return Normalized(canonical="false", transforms=extra)
        # Deliberately NOT accepting 1/0 as booleans: an engine emitting `0`
        # for a checkbox is far more likely reading an empty cell than a
        # deliberate "unchecked". Strict -> unparseable -> counted wrong.
        return Normalized(canonical=None, unparseable=True, transforms=("boolean_unrecognized",))

    if rule == "ratio":
        flattened = re.sub(r"\s*(:|\bto\b|/)\s*", ":", text, flags=re.IGNORECASE)
        if ":" in flattened:
            parts = [_num_canon(part) for part in flattened.split(":")]
            if len(parts) == 2 and all(parts):
                return Normalized(canonical=f"{parts[0]}:{parts[1]}")
            return Normalized(canonical=None, unparseable=True, transforms=("ratio_unparseable",))
        bare = _num_canon(text)
        if bare is None:
            return Normalized(canonical=None, unparseable=True, transforms=("ratio_unparseable",))
        # `12` for a student:faculty ratio means 12:1 -- an assumed denominator,
        # so it is logged rather than silently applied. A DECIMAL bare value is
        # a rate, not a dropped `:m` (the two `outcomes.*_rate_ratio` metrics
        # print `0.87`): `0.87` already means 0.87 per 1, so no denominator was
        # assumed and no tag is emitted. Scoring is unchanged and symmetric --
        # both sides still canonicalize to `0.87:1`; only the autopsy channel
        # is spared the permanent noise.
        implicit = () if "." in bare else ("ratio_implicit_denominator_1",)
        return Normalized(canonical=f"{bare}:1", transforms=implicit)

    if rule == "percent":
        qualifier, body, qtransforms = _split_qualifier(text)
        body = body.rstrip("%").strip()
        ranged = _as_range(body, "number") if not qualifier else None
        if ranged is not None:
            return Normalized(
                canonical=f"{qualifier}{ranged.canonical}",
                transforms=qtransforms + ranged.transforms,
            )
        number = _num_canon(body)
        if number is None:
            return Normalized(
                canonical=None,
                unparseable=True,
                transforms=qtransforms + ("percent_unparseable",),
            )
        transforms: tuple[str, ...] = qtransforms
        if not qualifier and "." in number and Decimal(number) < 1:
            # 0.56 for a percent metric is ambiguous: 0.56% or a fraction of
            # 56%? NO rescaling is applied -- the value is compared as
            # printed and the ambiguity is logged for the autopsy.
            transforms = transforms + ("percent_fraction_suspected_not_rescaled",)
        return Normalized(canonical=f"{qualifier}{number}", transforms=transforms)

    if rule == "money":
        body = text.replace("$", "").replace("USD", "").replace("usd", "").strip()
        qualifier, body, qtransforms = _split_qualifier(body)
        ranged = _as_range(body, "number") if not qualifier else None
        if ranged is not None:
            return Normalized(
                canonical=f"{qualifier}{ranged.canonical}",
                transforms=qtransforms + ranged.transforms,
            )
        number = _num_canon(body)
        if number is None:
            return Normalized(
                canonical=None, unparseable=True, transforms=qtransforms + ("money_unparseable",)
            )
        return Normalized(canonical=f"{qualifier}{number}", transforms=qtransforms)

    if rule in ("count", "gpa", "number"):
        qualifier, body, qtransforms = _split_qualifier(text)
        body = body.rstrip("%").strip() if rule != "count" else body
        ranged = _as_range(body, "number") if not qualifier else None
        if ranged is not None:
            return Normalized(
                canonical=f"{qualifier}{ranged.canonical}",
                transforms=qtransforms + ranged.transforms,
            )
        number = _num_canon(body)
        if number is None:
            return Normalized(
                canonical=None, unparseable=True, transforms=qtransforms + (f"{rule}_unparseable",)
            )
        return Normalized(canonical=f"{qualifier}{number}", transforms=qtransforms)

    # text / enum: case-folded, whitespace-collapsed, dashes unified.
    folded = text.casefold()
    for dash in _DASHES:
        folded = folded.replace(dash, "-")
    return Normalized(canonical=folded)


def normalize(value: Any, metric: Mapping[str, Any]) -> Normalized:
    """Normalize `value` using the rule implied by a compiled manifest metric.

    Adds one metric-aware check the rule-only path cannot do: an `enum` value
    outside the metric's compiled `enums` set is tagged
    `enum_value_not_in_manifest`. It is NOT coerced -- the manifest's enum
    tokens are snake_case (`very_important`), so a GT author who transcribed
    the PDF's printed label ("Very Important") gets a loud tag in the
    transforms list instead of a silent stream of `wrong`.
    """
    normalized = normalize_text(value, rule_for_metric(metric))
    allowed = metric.get("enums")
    if (
        metric.get("type") == "enum"
        and allowed
        and normalized.canonical is not None
        and normalized.canonical not in {str(option).casefold() for option in allowed}
    ):
        return Normalized(
            canonical=normalized.canonical,
            absent=normalized.absent,
            unparseable=normalized.unparseable,
            transforms=(*normalized.transforms, "enum_value_not_in_manifest"),
        )
    return normalized


# ---------------------------------------------------------------------------
# Run + ground-truth loading
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EngineFinding:
    key: MetricKey
    value: Any
    availability_status: str | None
    page_number: int | None
    raw: Mapping[str, Any]


@dataclass(frozen=True)
class GroundTruthEntry:
    key: MetricKey
    status: str  # present | blank | absent | unreadable
    value: Any
    page: int | None
    evidence: str | None


# See GT-SCHEMA.md for the authoritative definitions.
#   present    -- the document states a value (`value` required)
#   blank      -- a fill-in VALUE CELL exists on the form and was left empty
#   absent     -- the row/question does not appear in this template edition
#   unreadable -- the author looked and could not read it (scan artifact,
#                 cropped table, genuinely ambiguous multi-column row).
#                 Never charged to the engine, never folded into `missed`.
# An unticked CHECKBOX that IS on the form is `present` + `value: false`, never
# `blank` and never `absent`.
_GT_STATUSES = frozenset({"present", "blank", "absent", "unreadable"})


def _as_page(value: Any) -> int | None:
    """Page numbers are only used for the (never-gated) citation-mismatch
    count, so an unparseable page is dropped rather than failing the run."""
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    text = str(value).strip()
    return int(text) if re.fullmatch(r"-?\d+", text) else None


def load_run(path: Path) -> dict[str, Any]:
    loaded: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
    return loaded


def engine_findings(run: Mapping[str, Any]) -> dict[MetricKey, list[EngineFinding]]:
    """Index a run's findings by metric key, keeping duplicates (the scorer
    treats disagreeing duplicates as a conflict, never picking a winner)."""
    indexed: dict[MetricKey, list[EngineFinding]] = {}
    for finding in run.get("findings") or []:
        key = metric_key(finding.get("domain"), finding.get("metric_id", ""))
        value = finding.get("value")
        if value is None and finding.get("raw_value") is not None:
            value = finding.get("raw_value")
        indexed.setdefault(key, []).append(
            EngineFinding(
                key=key,
                value=value,
                availability_status=finding.get("availability_status"),
                page_number=_as_page(finding.get("page_number")),
                raw=finding,
            )
        )
    return indexed


def load_ground_truth(path: Path) -> dict[MetricKey, GroundTruthEntry]:
    """Read a GT file. See GT-SCHEMA.md for the authoritative schema.

    Two key layouts are accepted (both map to `(domain, bare_id)`):
      * flat, fully-qualified: ``{"admissions.applicants_total": {...}}``
      * nested by domain:      ``{"admissions": {"applicants_total": {...}}}``
    """
    raw = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(raw, dict) and "schema_version" in raw:
        declared = raw["schema_version"]
        if declared != GT_SCHEMA_VERSION:
            raise ValueError(
                f"GT {path}: schema_version {declared!r} but this scorer "
                f"({SCORER_VERSION}) reads schema_version {GT_SCHEMA_VERSION} only"
            )
    metrics = raw.get("metrics", raw) if isinstance(raw, dict) else {}
    entries: dict[MetricKey, GroundTruthEntry] = {}

    def add(key: MetricKey, body: Mapping[str, Any]) -> None:
        status = str(body.get("status", "")).strip().lower()
        if status not in _GT_STATUSES:
            raise ValueError(
                f"GT {key}: status must be one of {sorted(_GT_STATUSES)}, got {status!r}"
            )
        entries[key] = GroundTruthEntry(
            key=key,
            status=status,
            value=body.get("value"),
            page=_as_page(body.get("page")),
            evidence=body.get("evidence"),
        )

    for name, body in metrics.items():
        if name in {"schema_version", "school", "year", "document", "manifest_version", "notes"}:
            continue
        if not isinstance(body, Mapping):
            raise ValueError(f"GT {name}: expected an object, got {type(body)}")
        if "." in name:
            add(metric_key(None, name), body)
            continue
        if "status" in body:
            raise ValueError(
                f"GT key {name!r} is not domain-qualified -- use \"<domain>.<metric_id>\" "
                "or nest the entry under its domain (see GT-SCHEMA.md)"
            )
        for bare, inner in body.items():  # nested-by-domain layout
            if not isinstance(inner, Mapping):
                raise ValueError(f"GT {name}.{bare}: expected an object, got {type(inner)}")
            add((name, bare), inner)
    return entries


def gt_authoring_errors(
    ground_truth: Mapping[MetricKey, GroundTruthEntry],
    universe: Mapping[MetricKey, Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """GT entries that no engine output could ever satisfy.

    Two unwinnable shapes, both AUTHORING bugs rather than engine faults:

    1. ABSENT-TOKEN. A `present` entry whose value is `"None"`, `"N/A"`, `"-"`,
       `""`, JSON `null`, ... The token normalizes to *absent* on both sides,
       so the metric can never be matched. Real CDS free-text rows do print a
       literal `None`, so this is a live trap rather than a hypothetical one.

    2. UNPARSEABLE. A `present` entry whose value does not normalize under its
       metric's rule (`"~12ish"` for a count, a stray glyph in a percent, ...).
       Equally unwinnable, and until it was quarantined here it hid inside the
       `wrong` bucket and read as an ENGINE regression -- which is exactly how
       the leading-dot-decimal parser bug (`.48`) stayed invisible. Requires
       `universe`, since the rule comes from the compiled metric.

    Both are reported in their own bucket (`gt_error`), never charged to the
    engine, and force a non-zero exit so nobody tunes against a poisoned
    denominator.
    """
    errors: list[dict[str, Any]] = []
    for key, entry in sorted(ground_truth.items()):
        domain, bare = key
        if entry.status != "present":
            continue
        value = entry.value
        if isinstance(value, bool):
            continue
        if value is None or _pre(value).casefold() in _ABSENT_TOKENS:
            errors.append(
                {
                    "metric": f"{domain}.{bare}",
                    "value": value,
                    "reason": (
                        "`present` GT whose value is an absent-token -- unwinnable. "
                        "Use status `blank` (empty value cell) or `absent` "
                        "(row not in this template edition) instead."
                    ),
                }
            )
            continue
        metric = (universe or {}).get(key)
        if metric is None:
            continue
        if normalize(value, metric).unparseable:
            errors.append(
                {
                    "metric": f"{domain}.{bare}",
                    "value": value,
                    "reason": (
                        "`present` GT whose value does not normalize under rule "
                        f"`{rule_for_metric(metric)}` -- unwinnable: no engine output can "
                        "match it. Fix the transcription (or the normalizer, if the "
                        "document really prints it this way)."
                    ),
                }
            )
    return errors


# ---------------------------------------------------------------------------
# Comparison
# ---------------------------------------------------------------------------


@dataclass
class Comparison:
    domain: str
    metric_id: str
    outcome: Outcome
    rule: Rule | None
    gt_status: str | None
    gt_value: Any = None
    gt_canonical: str | None = None
    gt_page: int | None = None
    engine_value: Any = None
    engine_canonical: str | None = None
    engine_page: int | None = None
    availability_status: str | None = None
    unknown_availability_status: bool = False
    citation_mismatch: bool = False
    transforms: list[str] = field(default_factory=list)
    note: str | None = None


@dataclass(frozen=True)
class EngineView:
    finding: EngineFinding | None
    normalized: Normalized
    transforms: list[str]
    note: str | None
    unknown_status: bool = False


def _engine_view(findings: Sequence[EngineFinding], metric: Mapping[str, Any]) -> EngineView:
    """Collapse a metric's findings into one engine-side view.

    Abstention is granted ONLY for a RECOGNIZED non-`reported` status (the
    five-member vocabulary in `domain/cds/claims.py`), no finding at all, or a
    value that normalizes to an absent token.

    An UNRECOGNIZED `availability_status` -- `"Reported"`, `"reported "`,
    `None`, a future `"brand_new_status_v2"` -- buys nothing. Treating it as an
    abstention would silently convert every hallucination in the run into a
    `correct_abstention`, which is the single most dangerous direction this
    scorer can drift. Such findings are charged as if extracted AND flagged so
    the report and the exit code both shout. Whitespace/case variants are
    deliberately NOT coerced: silent coercion is how this bug class returns.

    Duplicate findings that disagree after normalization are a CONFLICT: the
    scorer refuses to pick a winner and marks the comparison unparseable
    (=> wrong / hallucinated).
    """
    unknown = [f for f in findings if f.availability_status not in KNOWN_AVAILABILITY_STATUSES]
    charged = [f for f in findings if f.availability_status == EXTRACTED_STATUS] + unknown
    unknown_tags = ["unknown_availability_status"] if unknown else []
    unknown_note = (
        "unknown availability_status: "
        f"{sorted({repr(f.availability_status) for f in unknown})} -- NOT treated as an abstention"
        if unknown
        else None
    )

    if not charged:
        note = None
        if findings:
            note = f"abstained: availability_status={findings[0].availability_status!r}"
        return EngineView(findings[0] if findings else None, ABSENT, [], note)

    normalized = [normalize(f.value, metric) for f in charged]
    live = [(f, n) for f, n in zip(charged, normalized, strict=True) if not n.absent]
    transforms = sorted({t for _, n in live for t in n.transforms} | set(unknown_tags))
    if not live:
        note = "abstained: reported an absent-token value"
        return EngineView(
            charged[0],
            ABSENT,
            transforms,
            unknown_note or note,
            unknown_status=bool(unknown),
        )

    distinct = {n.canonical for _, n in live}
    if len(distinct) > 1:
        conflict = f"conflicting duplicate findings: {sorted(str(d) for d in distinct)}"
        return EngineView(
            live[0][0],
            Normalized(canonical=None, unparseable=True),
            [*transforms, "duplicate_findings_conflict"],
            "; ".join(filter(None, (unknown_note, conflict))),
            unknown_status=bool(unknown),
        )
    finding, chosen = live[0]
    return EngineView(finding, chosen, transforms, unknown_note, unknown_status=bool(unknown))


def compare_metric(
    key: MetricKey,
    metric: Mapping[str, Any],
    findings: Sequence[EngineFinding],
    gt: GroundTruthEntry | None,
) -> Comparison:
    """Classify one metric into exactly one outcome. The whole scorer's
    honesty lives here; read it against the semantics table in the plan."""
    domain, bare = key
    rule = rule_for_metric(metric)
    view = _engine_view(findings, metric)
    finding, engine, transforms, note = view.finding, view.normalized, view.transforms, view.note
    engine_value = finding.value if finding is not None else None
    engine_page = finding.page_number if finding is not None else None
    availability = finding.availability_status if finding is not None else None

    if gt is None:
        return Comparison(
            domain=domain,
            metric_id=bare,
            outcome="uncovered",
            rule=rule,
            gt_status=None,
            engine_value=engine_value,
            engine_canonical=engine.canonical,
            engine_page=engine_page,
            availability_status=availability,
            unknown_availability_status=view.unknown_status,
            transforms=transforms,
            note="; ".join(
                filter(None, ("metric is in the manifest but has no ground-truth entry", note))
            ),
        )

    base = Comparison(
        domain=domain,
        metric_id=bare,
        outcome="wrong",
        rule=rule,
        gt_status=gt.status,
        gt_value=gt.value,
        gt_page=gt.page,
        engine_value=engine_value,
        engine_canonical=engine.canonical,
        engine_page=engine_page,
        availability_status=availability,
        unknown_availability_status=view.unknown_status,
        transforms=transforms,
        note=note,
    )

    if gt.status == "unreadable":
        # "I checked and could not read it" -- distinct from "I didn't check"
        # (`uncovered`) and from "the engine missed it" (`missed`). Neither
        # credited nor charged; it lands in its own bucket and stays out of
        # every denominator.
        base.outcome = "unreadable"
        base.note = "; ".join(
            filter(None, ("ground truth marked unreadable -- not charged to the engine", note))
        )
        return base

    if gt.status in ("blank", "absent"):
        base.outcome = "correct_abstention" if engine.absent else "hallucinated"
        if not engine.absent and base.note is None:
            base.note = f"engine emitted a value where GT says {gt.status}"
        return base

    # gt.status == "present"
    gt_norm = normalize(gt.value, metric)
    base.gt_canonical = gt_norm.canonical
    base.transforms = sorted({*transforms, *(f"gt:{t}" for t in gt_norm.transforms)})
    if gt_norm.absent:
        # Unwinnable by construction: an absent-token GT value can never be
        # matched. That is a GT AUTHORING bug, so it is quarantined in its own
        # bucket instead of being charged to the engine as `wrong`.
        # `gt_authoring_errors()` surfaces the same set at load time.
        base.outcome = "gt_error"
        base.note = (
            "`present` ground truth whose value is an absent-token -- unwinnable; "
            "use `blank` or `absent` (see GT-SCHEMA.md). NOT charged to the engine."
        )
        return base
    if gt_norm.unparseable:
        # Also unwinnable by construction, and NOT the engine's fault: a GT
        # value that will not normalize can never be matched by any output.
        # Charging it as `wrong` is how a normalizer defect masquerades as an
        # engine regression, so it is quarantined alongside the absent-token
        # case. `gt_authoring_errors()` surfaces the same set at load time.
        base.outcome = "gt_error"
        base.note = (
            "`present` ground truth that did not normalize under its rule -- unwinnable; "
            "fix the GT file (see GT-SCHEMA.md). NOT charged to the engine."
        )
        return base
    if engine.absent:
        base.outcome = "missed"
        return base
    if engine.unparseable or engine.canonical != gt_norm.canonical:
        base.outcome = "wrong"
        return base
    base.outcome = "correct"
    base.citation_mismatch = (
        gt.page is not None and engine_page is not None and gt.page != engine_page
    )
    return base


# ---------------------------------------------------------------------------
# Scoring a whole run
# ---------------------------------------------------------------------------


def _tally(comparisons: Iterable[Comparison]) -> dict[str, Any]:
    counts: dict[str, int] = dict.fromkeys(OUTCOMES, 0)
    citation_mismatch = 0
    unknown_status = 0
    for comparison in comparisons:
        counts[comparison.outcome] += 1
        citation_mismatch += int(comparison.citation_mismatch)
        unknown_status += int(comparison.unknown_availability_status)
    return ratios_from_counts(counts, citation_mismatch, unknown_status)


def ratios_from_counts(
    counts: Mapping[str, int], citation_mismatch: int = 0, unknown_status: int = 0
) -> dict[str, Any]:
    """Bucket counts -> the derived rates. The ONLY place rates are computed.

    Aggregation across documents reuses this on SUMMED buckets rather than
    averaging per-document percentages -- see `aggregate_reports`.
    """
    counts = {outcome: int(counts.get(outcome, 0)) for outcome in OUTCOMES}
    present = counts["correct"] + counts["wrong"] + counts["missed"]
    extracted_on_present = counts["correct"] + counts["wrong"]
    # `accuracy_pct` charges hallucinations against the engine: every value it
    # emitted for a covered metric is in the denominator. The
    # `_excl_hallucination` variant is reported alongside so a regression in
    # one is never hidden by the other.
    emitted = extracted_on_present + counts["hallucinated"]
    return {
        **counts,
        "total": sum(counts.values()),
        # `covered` = metrics this run could actually be scored on. `uncovered`
        # (no GT), `unreadable` (GT author could not read it) and `gt_error`
        # (broken GT entry) are all excluded: none of them is the engine's
        # fault and none may enter a denominator.
        "covered": sum(counts[o] for o in OUTCOMES if o not in UNSCORED_OUTCOMES),
        "unknown_availability_status": unknown_status,
        "present_in_document": present,
        "extracted_on_present": extracted_on_present,
        "emitted_values": emitted,
        "coverage_pct": round(100.0 * extracted_on_present / present, 2) if present else None,
        "accuracy_pct": round(100.0 * counts["correct"] / emitted, 2) if emitted else None,
        "accuracy_pct_excl_hallucination": (
            round(100.0 * counts["correct"] / extracted_on_present, 2)
            if extracted_on_present
            else None
        ),
        "citation_mismatch": citation_mismatch,
    }


# ---------------------------------------------------------------------------
# Fitness
# ---------------------------------------------------------------------------

# THE fitness scalar for the tuning loop, compared LEXICOGRAPHICALLY, higher is
# better, in this fixed order (from the mission spec, `valid` prepended -- do
# not reorder the four axes after it):
#
#     (valid, accuracy_pct, coverage_pct, -cost_per_doc, -latency_per_doc)
#
# `valid` is 1.0 when the report's `run_errors` is empty, 0.0 otherwise. It
# comes FIRST so it dominates every other axis: a run in which most model
# calls failed is not a measurement of anything, and it must never win a
# comparison by being coincidentally cheap or fast because it barely ran.
# Without this, a catastrophically broken run (few calls succeeded, so cost
# and latency are tiny) can beat a healthy run once the comparison reaches the
# cost/latency axes -- exactly the failure this field exists to make
# impossible, regardless of what a human or a future automated comparison
# happens to look at first.
#
# Accuracy alone is gameable: abstain on everything and `accuracy_pct` is
# `None`; extract one metric correctly and abstain on the other 393 and it is
# 100.0 at 0.25% coverage. Coverage is the tie-breaker that makes maximal
# abstention lose, and cost/latency break ties between equally accurate,
# equally complete configs.
FITNESS_FIELDS: tuple[str, ...] = (
    "valid",
    "accuracy_pct",
    "coverage_pct",
    "-cost_per_doc",
    "-latency_per_doc",
)

# A run that extracted NOTHING has no accuracy and no coverage. `None` must
# never sort as "best", so it maps to an explicit sentinel BELOW every real
# percentage (which are all >= 0.0). This is the line that stops an
# abstain-on-everything config from winning the loop.
NO_DATA_SENTINEL = -1.0

# A run with no recorded cost/latency must not win a tie on the strength of the
# missing number either: unknown cost is treated as infinitely expensive.
_UNKNOWN_COST = float("inf")


def _fitness_number(value: Any) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return _UNKNOWN_COST
    return float(value)


def fitness_inputs(report: Mapping[str, Any]) -> dict[str, Any]:
    """The four raw ACCURACY/COVERAGE/COST/LATENCY numbers `fitness()`
    consumes, named and reported. Validity (the fifth, leading fitness axis)
    is deliberately NOT one of these four: it is read straight off the
    report's own `run_errors`, never off this derived dict, so a caller that
    hand-builds `fitness_inputs` cannot accidentally launder an invalid run
    into looking valid.

    For a single-document report, cost/latency per doc ARE the run's own cost
    and duration. For an aggregate report, `aggregate_reports` supplies the
    MEAN per document (see its docstring for why mean and not total).
    """
    if "fitness_inputs" in report:
        supplied: dict[str, Any] = dict(report["fitness_inputs"])
        return supplied
    totals = report["totals"]
    cost = report.get("cost") or {}
    return {
        "accuracy_pct": totals.get("accuracy_pct"),
        "coverage_pct": totals.get("coverage_pct"),
        "cost_per_doc": cost.get("cost_usd_estimate"),
        "latency_per_doc": cost.get("duration_seconds"),
    }


def is_valid_report(report: Mapping[str, Any]) -> bool:
    """A report is a valid measurement only when its `run_errors` list is
    empty. Every score/aggregate report carries `run_errors` (see
    `score_run` and `aggregate_reports`), so this is total over both shapes.
    """
    return not (report.get("run_errors") or [])


def fitness(report: Mapping[str, Any]) -> tuple[float, float, float, float, float]:
    """The lexicographic fitness tuple for a scored run OR an aggregate.

    Higher is better. Identical semantics at both levels; an aggregate simply
    feeds summed-bucket rates and mean per-document cost/latency.

    The first element is `valid` (1.0 / 0.0, see `is_valid_report`). It sorts
    ahead of every other axis on purpose: a report with any run error is not
    a real measurement, so it must lose to every valid report before the
    comparison ever reaches accuracy, let alone cost or latency.
    """
    inputs = fitness_inputs(report)
    accuracy = inputs.get("accuracy_pct")
    coverage = inputs.get("coverage_pct")
    return (
        1.0 if is_valid_report(report) else 0.0,
        NO_DATA_SENTINEL if accuracy is None else float(accuracy),
        NO_DATA_SENTINEL if coverage is None else float(coverage),
        -_fitness_number(inputs.get("cost_per_doc")),
        -_fitness_number(inputs.get("latency_per_doc")),
    )


def compare_fitness(a: Mapping[str, Any], b: Mapping[str, Any]) -> int:
    """-1 if `a` is worse than `b`, 0 if equal, 1 if `a` is better."""
    fa, fb = fitness(a), fitness(b)
    if fa == fb:
        return 0
    return 1 if fa > fb else -1


def score_run(
    run: Mapping[str, Any],
    ground_truth: Mapping[MetricKey, GroundTruthEntry],
    *,
    universe: Mapping[MetricKey, Mapping[str, Any]] | None = None,
    manifest: Any | None = None,
) -> dict[str, Any]:
    """Score one run against one GT file over the full manifest universe."""
    compiled = manifest if manifest is not None else load_compiled_manifest()
    metrics = dict(universe) if universe is not None else manifest_universe(compiled)
    findings = engine_findings(run)

    comparisons = [
        compare_metric(key, metric, findings.get(key, []), ground_truth.get(key))
        for key, metric in metrics.items()
    ]

    per_domain: dict[str, list[Comparison]] = {}
    for comparison in comparisons:
        per_domain.setdefault(comparison.domain, []).append(comparison)

    unknown = sorted(f"{d}.{m}" for (d, m) in findings if (d, m) not in metrics)
    gt_unknown = sorted(f"{d}.{m}" for (d, m) in ground_truth if (d, m) not in metrics)
    authoring_errors = gt_authoring_errors(ground_truth, metrics)
    bad_status = sorted(
        {
            f"{c.domain}.{c.metric_id}={c.availability_status!r}"
            for c in comparisons
            if c.unknown_availability_status
        }
    )

    report: dict[str, Any] = {
        "scorer_version": SCORER_VERSION,
        "manifest_version": getattr(compiled, "version", None),
        "manifest_content_sha256": getattr(compiled, "content_sha256", None),
        "metric_universe_size": len(metrics),
        "document": run.get("document"),
        "config": run.get("config"),
        "domains_requested": run.get("domains_requested"),
        "cost": {
            "cost_usd_estimate": run.get("cost_usd_estimate"),
            "calls": len(run.get("calls") or []),
            "usage_total": run.get("usage_total"),
            "duration_seconds": run.get("duration_seconds"),
        },
        "run_errors": run.get("errors") or [],
        "totals": _tally(comparisons),
        "per_domain": {
            domain: _tally(items) for domain, items in sorted(per_domain.items())
        },
        "findings_outside_manifest": unknown,
        # A GT key matching no manifest metric is an AUTHORING bug (a typo
        # silently shrinks the denominator), not a scoring outcome: surfaced in
        # the console summary and forces a non-zero exit.
        "ground_truth_outside_manifest": gt_unknown,
        "ground_truth_authoring_errors": authoring_errors,
        "unknown_availability_statuses": bad_status,
        "transforms": [
            {
                "metric": f"{c.domain}.{c.metric_id}",
                "outcome": c.outcome,
                "transforms": c.transforms,
                "gt_value": c.gt_value,
                "engine_value": c.engine_value,
            }
            for c in comparisons
            if c.transforms
        ],
        "comparisons": [asdict(c) for c in comparisons],
    }
    report["fitness_fields"] = list(FITNESS_FIELDS)
    report["fitness_inputs"] = {
        **fitness_inputs(report),
        "basis": "single document; cost/latency are this document's own",
    }
    # Explicit so a reader never has to infer validity by re-deriving it from
    # `run_errors` themselves -- see `is_valid_report()` / `fitness()`.
    report["valid"] = is_valid_report(report)
    report["failed_call_count"] = len(report["run_errors"])
    report["fitness"] = list(fitness(report))
    report["blocking_issues"] = (
        [f"GT keys outside manifest: {gt_unknown}"] if gt_unknown else []
    ) + (
        [f"GT authoring errors: {[e['metric'] for e in authoring_errors]}"]
        if authoring_errors
        else []
    ) + ([f"unknown availability_status: {bad_status}"] if bad_status else [])
    return report


# ---------------------------------------------------------------------------
# Multi-document aggregation
# ---------------------------------------------------------------------------

# The tuning loop makes every keep/revert decision on the full N-document eval
# and NEVER on a single document. Scoring a partial eval is forbidden: this is
# the default the aggregate refuses to certify below.
EXPECTED_DOCUMENTS = 5

# Config keys that name the document rather than the configuration.
_PER_DOCUMENT_CONFIG_KEYS = frozenset({"pdf_path", "path", "document", "name"})


def aggregate_reports(
    reports: Sequence[Mapping[str, Any]],
    *,
    expected_documents: int | None = EXPECTED_DOCUMENTS,
    label: str | None = None,
) -> dict[str, Any]:
    """Fold N single-document reports (one config) into ONE aggregate report.

    Rates come from SUMMED BUCKETS, never from averaging per-document
    percentages. Averaging weights a 4-metric document the same as a
    300-metric one; that is a Simpson's-paradox trap in which a config
    improves on every single document and still shows a worse average. Summing
    correct/wrong/missed/hallucinated first and dividing once is the only
    honest reduction. (`test_summed_buckets_beat_averaged_percentages` builds
    a skewed pair where the two disagree.)

    Cost and latency are reported BOTH as totals and as means per document;
    the fitness tuple consumes the MEANS, so the number stays comparable if
    the document set ever changes size.

    A partial eval is never certified: too few runs, duplicate documents, any
    run carrying `errors`, any per-document blocking issue, or mixed
    scorer/manifest versions all populate `blocking_issues` and force a
    non-zero exit rather than emitting a complete-looking fitness tuple.
    """
    if not reports:
        raise ValueError("aggregate_reports() needs at least one report")

    counts: dict[str, int] = dict.fromkeys(OUTCOMES, 0)
    citation_mismatch = 0
    unknown_status = 0
    per_domain_counts: dict[str, dict[str, int]] = {}
    per_domain_extra: dict[str, list[int]] = {}
    documents: list[dict[str, Any]] = []
    total_cost = 0.0
    total_seconds = 0.0
    total_calls = 0
    cost_known = True
    latency_known = True
    findings_outside: list[str] = []
    gt_outside: list[str] = []
    authoring_errors: list[dict[str, Any]] = []
    bad_status: list[str] = []
    run_errors: list[str] = []
    blocking: list[str] = []

    for report in reports:
        totals = report["totals"]
        name = (report.get("document") or {}).get("name") or report.get("run_file") or "?"
        for outcome in OUTCOMES:
            counts[outcome] += int(totals.get(outcome, 0))
        citation_mismatch += int(totals.get("citation_mismatch", 0))
        unknown_status += int(totals.get("unknown_availability_status", 0))

        for domain, tally in (report.get("per_domain") or {}).items():
            bucket = per_domain_counts.setdefault(domain, dict.fromkeys(OUTCOMES, 0))
            for outcome in OUTCOMES:
                bucket[outcome] += int(tally.get(outcome, 0))
            extra = per_domain_extra.setdefault(domain, [0, 0])
            extra[0] += int(tally.get("citation_mismatch", 0))
            extra[1] += int(tally.get("unknown_availability_status", 0))

        cost = report.get("cost") or {}
        cost_value = cost.get("cost_usd_estimate")
        seconds = cost.get("duration_seconds")
        if isinstance(cost_value, (int, float)) and not isinstance(cost_value, bool):
            total_cost += float(cost_value)
        else:
            cost_known = False
        if isinstance(seconds, (int, float)) and not isinstance(seconds, bool):
            total_seconds += float(seconds)
        else:
            latency_known = False
        total_calls += int(cost.get("calls") or 0)

        findings_outside.extend(report.get("findings_outside_manifest") or [])
        gt_outside.extend(report.get("ground_truth_outside_manifest") or [])
        authoring_errors.extend(report.get("ground_truth_authoring_errors") or [])
        bad_status.extend(report.get("unknown_availability_statuses") or [])
        errors = report.get("run_errors") or []
        run_errors.extend(f"{name}: {error}" for error in errors)
        if errors:
            blocking.append(f"{name} carries {len(errors)} run error(s) -- the eval is INCOMPLETE")
        for issue in report.get("blocking_issues") or []:
            blocking.append(f"{name}: {issue}")
        documents.append(
            {
                "name": name,
                "run_file": report.get("run_file"),
                "scorer_version": report.get("scorer_version"),
                "manifest_content_sha256": report.get("manifest_content_sha256"),
                "config": report.get("config"),
                "totals": {outcome: int(totals.get(outcome, 0)) for outcome in OUTCOMES},
                "coverage_pct": totals.get("coverage_pct"),
                "accuracy_pct": totals.get("accuracy_pct"),
                "cost_usd_estimate": cost_value,
                "duration_seconds": seconds,
                "valid": is_valid_report(report),
                "failed_call_count": len(errors),
                "fitness": list(fitness(report)),
            }
        )

    count = len(reports)
    names = [document["name"] for document in documents]
    duplicates = sorted({name for name in names if names.count(name) > 1})
    if duplicates:
        blocking.append(f"duplicate documents in the eval set: {duplicates}")
    if expected_documents is not None and count != expected_documents:
        blocking.append(
            f"PARTIAL EVAL: {count} document(s) supplied, {expected_documents} expected -- "
            "a config's number is its full-eval aggregate; never score a partial eval"
        )
    versions = {document["scorer_version"] for document in documents}
    if len(versions) > 1:
        blocking.append(f"mixed scorer_version across the eval set: {sorted(map(str, versions))}")
    manifests = {document["manifest_content_sha256"] for document in documents}
    if len(manifests) > 1:
        blocking.append("mixed manifest_content_sha256 across the eval set -- re-run the eval")
    # `config` legitimately differs per document on the path keys; everything
    # else (model, prompt variant, batching, domains, label) must be identical
    # or these runs are not one config's eval.
    configs = {
        json.dumps(
            {
                key: value
                for key, value in (document["config"] or {}).items()
                if key not in _PER_DOCUMENT_CONFIG_KEYS
            },
            sort_keys=True,
            default=str,
        )
        for document in documents
    }
    if len(configs) > 1:
        blocking.append(
            f"{len(configs)} distinct configs in one aggregate -- these are not one config's eval"
        )

    totals = ratios_from_counts(counts, citation_mismatch, unknown_status)
    mean_cost = total_cost / count if cost_known else None
    mean_latency = total_seconds / count if latency_known else None
    aggregate: dict[str, Any] = {
        "kind": "aggregate",
        "label": label,
        "scorer_version": SCORER_VERSION,
        "manifest_content_sha256": documents[0]["manifest_content_sha256"],
        "documents": count,
        "expected_documents": expected_documents,
        "document_names": names,
        "config": reports[0].get("config"),
        "totals": totals,
        "per_domain": {
            domain: ratios_from_counts(
                bucket, per_domain_extra[domain][0], per_domain_extra[domain][1]
            )
            for domain, bucket in sorted(per_domain_counts.items())
        },
        "cost": {
            "total_cost_usd": round(total_cost, 6) if cost_known else None,
            "mean_cost_per_doc": round(mean_cost, 6) if mean_cost is not None else None,
            "total_duration_seconds": round(total_seconds, 3) if latency_known else None,
            "mean_latency_per_doc": round(mean_latency, 3) if mean_latency is not None else None,
            "calls": total_calls,
        },
        "run_errors": run_errors,
        "findings_outside_manifest": sorted(set(findings_outside)),
        "ground_truth_outside_manifest": sorted(set(gt_outside)),
        "ground_truth_authoring_errors": authoring_errors,
        "unknown_availability_statuses": sorted(set(bad_status)),
        "per_document": documents,
        "blocking_issues": blocking,
    }
    # Explicit, inspectable: rates from SUMMED buckets, cost/latency as the
    # MEAN per document (not the totals reported beside them).
    aggregate["fitness_inputs"] = {
        "accuracy_pct": totals["accuracy_pct"],
        "coverage_pct": totals["coverage_pct"],
        "cost_per_doc": mean_cost,
        "latency_per_doc": mean_latency,
        "basis": "summed buckets; cost/latency are the mean per document",
    }
    # Explicit so a reader never has to infer validity by re-deriving it from
    # `run_errors` themselves -- see `is_valid_report()` / `fitness()`. An
    # aggregate is invalid the moment ANY constituent document carried a run
    # error: `run_errors` above is already the union across all documents.
    aggregate["valid"] = is_valid_report(aggregate)
    aggregate["failed_call_count"] = len(run_errors)
    aggregate["fitness_fields"] = list(FITNESS_FIELDS)
    aggregate["fitness"] = list(fitness(aggregate))
    return aggregate


def summarize_aggregate(report: Mapping[str, Any]) -> str:
    totals = report["totals"]
    cost = report["cost"]
    run_errors = report.get("run_errors") or []
    lines: list[str] = []
    if run_errors:
        # Same loud banner as `summarize()`, first line, before any figure --
        # the tuning loop decides keep/revert on THIS report (never a single
        # document), so a broken eval must be unmissable right here.
        failed = report.get("failed_call_count", len(run_errors))
        total_calls = cost.get("calls")
        lines.append(
            f"!!! INVALID RUN -- {failed}/{total_calls} CALLS FAILED -- DO NOT COMPARE !!!"
        )
    lines += [
        f"== AGGREGATE over {report['documents']} document(s)"
        + (f"  [{report['label']}]" if report.get("label") else ""),
        f"scorer {report['scorer_version']}  documents: {', '.join(report['document_names'])}",
        "  ".join(f"{name}={totals[name]}" for name in OUTCOMES),
        f"coverage={totals['coverage_pct']}%  accuracy={totals['accuracy_pct']}%  "
        f"(excl. hallucination {totals['accuracy_pct_excl_hallucination']}%)  "
        "[SUMMED buckets, not averaged percentages]",
        f"cost total=${cost['total_cost_usd']} mean/doc=${cost['mean_cost_per_doc']}  "
        f"latency total={cost['total_duration_seconds']}s "
        f"mean/doc={cost['mean_latency_per_doc']}s  calls={cost['calls']}",
        f"fitness {tuple(FITNESS_FIELDS)} = {tuple(report['fitness'])}"
        f"   [valid=0 always ranks last, ahead of every other axis; "
        f"{NO_DATA_SENTINEL} = no data, ranks last within a validity tier; "
        f"cost/latency are MEAN per doc]",
    ]
    for document in report["per_document"]:
        lines.append(
            f"  {str(document['name']):<34} cov={document['coverage_pct']}% "
            f"acc={document['accuracy_pct']}% "
            f"correct={document['totals']['correct']} wrong={document['totals']['wrong']} "
            f"missed={document['totals']['missed']} halluc={document['totals']['hallucinated']}"
        )
    if report["run_errors"]:
        lines.append(f"  !! RUN ERRORS ({len(report['run_errors'])}) -- THIS EVAL IS INCOMPLETE:")
        lines.extend(f"     - {error}" for error in report["run_errors"][:20])
    for issue in report["blocking_issues"]:
        lines.append(f"  !! BLOCKING (exit != 0): {issue}")
    if not report["blocking_issues"]:
        lines.append("  certified: full eval, no run errors, no authoring issues")
    return "\n".join(lines)


def summarize(report: Mapping[str, Any]) -> str:
    totals = report["totals"]
    document = report.get("document") or {}
    run_errors = report.get("run_errors") or []
    lines: list[str] = []
    if run_errors:
        # THE loud banner: it must be the very first thing printed, before any
        # accuracy/coverage/cost figure, so a broken run is impossible to
        # mistake for a clean one -- dead calls otherwise print
        # `coverage=100.0% accuracy=100.0%` on the handful of metrics that did
        # come back, and a cheap, do-nothing run can look like a bargain on
        # the cost/latency axes. See `fitness()`: such a run is `valid=False`
        # and can never win a comparison regardless of what this banner says.
        failed = report.get("failed_call_count", len(run_errors))
        total_calls = (report.get("cost") or {}).get("calls")
        lines.append(
            f"!!! INVALID RUN -- {failed}/{total_calls} CALLS FAILED -- DO NOT COMPARE !!!"
        )
    lines += [
        f"scorer {report['scorer_version']}  manifest {report['manifest_version']}  "
        f"universe {report['metric_universe_size']}",
        f"document: {document.get('name')}  cost=${report['cost']['cost_usd_estimate']}  "
        f"calls={report['cost']['calls']}  {report['cost']['duration_seconds']}s",
        "  ".join(f"{name}={totals[name]}" for name in OUTCOMES),
        f"coverage={totals['coverage_pct']}%  accuracy={totals['accuracy_pct']}%  "
        f"(excl. hallucination {totals['accuracy_pct_excl_hallucination']}%)  "
        f"citation-mismatch={totals['citation_mismatch']}",
        f"fitness {tuple(FITNESS_FIELDS)} = {tuple(report.get('fitness') or fitness(report))}"
        f"   [valid=0 always ranks last, ahead of every other axis; "
        f"{NO_DATA_SENTINEL} = no data, ranks last within a validity tier]",
    ]
    if run_errors:
        lines.append(f"  !! RUN ERRORS ({len(run_errors)}) -- THIS RUN IS INCOMPLETE:")
        lines.extend(f"     - {error}" for error in run_errors[:20])
        if len(run_errors) > 20:
            lines.append(f"     ... and {len(run_errors) - 20} more")
    for domain, tally in report["per_domain"].items():
        if tally["covered"] == 0:
            continue
        lines.append(
            f"  {domain:<16} correct={tally['correct']:<4} wrong={tally['wrong']:<4} "
            f"missed={tally['missed']:<4} halluc={tally['hallucinated']:<4} "
            f"abst={tally['correct_abstention']:<4} uncov={tally['uncovered']:<4} "
            f"unread={tally['unreadable']:<4} gterr={tally['gt_error']:<4} "
            f"cov={tally['coverage_pct']}% acc={tally['accuracy_pct']}%"
        )
    if report["findings_outside_manifest"]:
        lines.append(f"  !! findings outside manifest: {report['findings_outside_manifest']}")
    for issue in report.get("blocking_issues") or []:
        lines.append(f"  !! BLOCKING (exit != 0): {issue}")
    if totals.get("unknown_availability_status"):
        lines.append(
            f"  !! {totals['unknown_availability_status']} metric(s) carried an unrecognized "
            "availability_status -- charged as extracted, NOT forgiven as abstentions"
        )
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _resolve_gt(run_path: Path, run: Mapping[str, Any], args: argparse.Namespace) -> Path:
    if args.gt:
        return Path(args.gt)
    stem = Path((run.get("document") or {}).get("name") or run_path.name).stem
    return Path(args.gt_dir) / f"{stem}.json"


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("runs", nargs="+", type=Path, help="run output JSON file(s)")
    parser.add_argument("--gt", help="explicit ground-truth file (single run only)")
    parser.add_argument(
        "--gt-dir",
        default=str(Path(__file__).resolve().parent.parent / "gt"),
        help="directory of <document-stem>.json ground-truth files",
    )
    parser.add_argument("--out", type=Path, help="write the full JSON report here")
    parser.add_argument("--json", action="store_true", help="print the JSON report to stdout")
    parser.add_argument(
        "--aggregate",
        action="store_true",
        help="fold the runs (one config's full eval) into ONE aggregate report with ONE "
        "fitness tuple, computed from summed buckets. This is the only number a "
        "keep/revert decision may be made on.",
    )
    parser.add_argument(
        "--expect-documents",
        type=int,
        default=EXPECTED_DOCUMENTS,
        help=f"documents a full eval must contain (default {EXPECTED_DOCUMENTS}); "
        "0 disables the check. A short eval refuses to certify.",
    )
    parser.add_argument("--label", help="experiment label recorded on the aggregate report")
    args = parser.parse_args(argv)

    if args.gt and len(args.runs) > 1:
        parser.error("--gt takes a single run file; use --gt-dir for many")

    manifest = load_compiled_manifest()
    universe = manifest_universe(manifest)
    reports = []
    for run_path in args.runs:
        run = load_run(run_path)
        gt_path = _resolve_gt(run_path, run, args)
        if not gt_path.exists():
            print(f"!! no ground truth for {run_path}: {gt_path} missing", file=sys.stderr)
            return 2
        report = score_run(
            run, load_ground_truth(gt_path), universe=universe, manifest=manifest
        )
        report["run_file"] = str(run_path)
        report["gt_file"] = str(gt_path)
        reports.append(report)
        print(f"== {run_path}")
        print(summarize(report))

    aggregate = None
    if args.aggregate:
        aggregate = aggregate_reports(
            reports,
            expected_documents=args.expect_documents or None,
            label=args.label,
        )
        print()
        print(summarize_aggregate(aggregate))

    if aggregate is not None:
        payload: Any = {"aggregate": aggregate, "reports": reports}
    else:
        payload = reports[0] if len(reports) == 1 else {"reports": reports}
    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    if args.json:
        print(json.dumps(payload, indent=2, default=str))

    # Authoring bugs and unrecognized engine vocabulary are NOT scoring
    # outcomes -- they make the numbers above untrustworthy, so they fail the
    # command rather than printing a clean-looking report with exit 0.
    blocking = (
        aggregate["blocking_issues"]
        if aggregate is not None
        else [issue for report in reports for issue in report["blocking_issues"]]
    )
    if blocking:
        print("\n!! scorer refused to certify this run:", file=sys.stderr)
        for issue in blocking:
            print(f"   - {issue}", file=sys.stderr)
        return 3
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
