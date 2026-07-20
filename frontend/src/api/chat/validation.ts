import {
  SOURCE_NAMES,
  type Citation,
  type CitationEnvelope,
  type EvidenceItem,
  type SourceEntry,
  type SourceName,
  type TabularRenderSpec,
  type Tier,
} from "@/api/chat/types";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): value is JsonRecord {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function only(value: JsonRecord, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nullableString(value: unknown): boolean {
  return value === null || typeof value === "string";
}

function absentOrNull(value: JsonRecord, key: string): boolean {
  return !(key in value) || value[key] === null;
}

function serializedDatetime(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(
      value,
    );
  if (match === null) return false;
  const [
    ,
    year,
    month,
    day,
    hour,
    minute,
    second,
    ,
    offsetHour = "00",
    offsetMinute = "00",
  ] = match;
  const daysInMonth = new Date(
    Date.UTC(Number(year), Number(month), 0),
  ).getUTCDate();
  return (
    Number(year) > 0 &&
    Number(month) >= 1 &&
    Number(month) <= 12 &&
    Number(day) >= 1 &&
    Number(day) <= daysInMonth &&
    Number(hour) <= 23 &&
    Number(minute) <= 59 &&
    Number(second) <= 59 &&
    Number(offsetHour) <= 23 &&
    Number(offsetMinute) <= 59 &&
    Number.isFinite(Date.parse(value))
  );
}

const sourceNames = new Set<SourceName>(SOURCE_NAMES);
const tiers = new Set<Tier>(["official", "community"]);
const sourceCurrentness = new Set(["current", "historical", "undated"]);
const sourcePeriodBases = new Set(["page_content", "metadata"]);

function hasSourcePeriodEvidence(value: JsonRecord): boolean {
  const currentness = value.source_currentness;
  const period = value.source_period;
  const basis = value.source_period_basis;
  const evidence = value.source_period_evidence;
  if (currentness === null || currentness === undefined) {
    return [period, basis, evidence].every(
      (item) => item === null || item === undefined,
    );
  }
  if (typeof currentness !== "string" || !sourceCurrentness.has(currentness))
    return false;
  if (currentness === "undated") {
    return [period, basis, evidence].every(
      (item) => item === null || item === undefined,
    );
  }
  return (
    nonEmpty(period) &&
    typeof basis === "string" &&
    sourcePeriodBases.has(basis) &&
    nonEmpty(evidence)
  );
}

export function isCurrentCitation(value: unknown): value is Citation {
  if (
    !record(value) ||
    !only(value, [
      "v",
      "source",
      "tier",
      "vintage",
      "url",
      "document_sha256",
      "source_kind",
      "retrieved_at",
      "academic_year",
      "manifest_version",
      "school_unitid",
      "profile_sha256",
      "source_period",
      "source_period_basis",
      "source_period_evidence",
      "source_currentness",
    ])
  )
    return false;
  if (
    value.v !== 2 ||
    typeof value.source !== "string" ||
    !sourceNames.has(value.source as SourceName) ||
    typeof value.tier !== "string" ||
    !tiers.has(value.tier as Tier) ||
    !nonEmpty(value.vintage) ||
    (!("url" in value) || nullableString(value.url)) === false ||
    (!("retrieved_at" in value) || nullableString(value.retrieved_at)) ===
      false ||
    (!("academic_year" in value) ||
      value.academic_year === null ||
      positiveInteger(value.academic_year)) === false ||
    (!("school_unitid" in value) ||
      value.school_unitid === null ||
      positiveInteger(value.school_unitid)) === false
  )
    return false;
  const dbKeys = [
    "document_sha256",
    "source_kind",
    "retrieved_at",
    "academic_year",
    "manifest_version",
    "school_unitid",
    "profile_sha256",
  ];
  const periodKeys = [
    "source_period",
    "source_period_basis",
    "source_period_evidence",
    "source_currentness",
  ];
  if (value.source === "cds")
    return (
      value.tier === "official" &&
      typeof value.document_sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(value.document_sha256) &&
      nonEmpty(value.source_kind) &&
      serializedDatetime(value.retrieved_at) &&
      positiveInteger(value.academic_year) &&
      nonEmpty(value.manifest_version) &&
      positiveInteger(value.school_unitid) &&
      absentOrNull(value, "profile_sha256") &&
      periodKeys.every((key) => absentOrNull(value, key))
    );
  if (value.source === "profile")
    return (
      value.tier === "official" &&
      positiveInteger(value.school_unitid) &&
      typeof value.profile_sha256 === "string" &&
      /^[0-9a-f]{64}$/.test(value.profile_sha256) &&
      dbKeys.slice(0, 5).every((key) => absentOrNull(value, key)) &&
      periodKeys.every((key) => absentOrNull(value, key))
    );
  return (
    value.tier === (value.source === "reddit" ? "community" : "official") &&
    nonEmpty(value.url) &&
    dbKeys.every((key) => absentOrNull(value, key)) &&
    hasSourcePeriodEvidence(value)
  );
}

export function isCurrentEvidence(value: unknown): value is EvidenceItem {
  return (
    record(value) &&
    only(value, [
      "eid",
      "value_display",
      "label",
      "page",
      "section",
      "row_label",
      "column_label",
      "excerpt",
    ]) &&
    nonEmpty(value.eid) &&
    typeof value.value_display === "string" &&
    nonEmpty(value.label) &&
    positiveInteger(value.page) &&
    (!("section" in value) || nullableString(value.section)) &&
    (!("row_label" in value) || nullableString(value.row_label)) &&
    (!("column_label" in value) || nullableString(value.column_label)) &&
    nonEmpty(value.excerpt)
  );
}

function jsonValue(value: unknown): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(jsonValue);
  return record(value) && Object.values(value).every(jsonValue);
}

function envelope(value: unknown): value is CitationEnvelope {
  if (
    !record(value) ||
    !only(value, [
      "v",
      "field",
      "label",
      "display",
      "raw",
      "available",
      "unit",
      "citation",
      "evidence",
      "caveats",
      "marker",
    ]) ||
    value.v !== 2 ||
    !(value.field === null || typeof value.field === "string") ||
    typeof value.label !== "string" ||
    typeof value.display !== "string" ||
    typeof value.available !== "boolean" ||
    (!("raw" in value) || jsonValue(value.raw)) === false ||
    (!("unit" in value) || nullableString(value.unit)) === false ||
    !Array.isArray(value.caveats) ||
    !value.caveats.every(
      (item) =>
        record(item) &&
        only(item, ["kind", "text"]) &&
        typeof item.kind === "string" &&
        /^[a-z][a-z0-9_]*$/.test(item.kind) &&
        nonEmpty(item.text),
    )
  )
    return false;
  if (!value.available)
    return (
      value.display === "not available" &&
      ["raw", "unit", "citation", "evidence", "marker"].every((key) =>
        absentOrNull(value, key),
      )
    );
  if (
    !nonEmpty(value.display) ||
    !isCurrentCitation(value.citation) ||
    !nonEmpty(value.marker) ||
    !/^\[[1-9]\d*\]$/.test(value.marker)
  )
    return false;
  if (value.citation.source !== "cds") return absentOrNull(value, "evidence");
  return (
    isCurrentEvidence(value.evidence) &&
    value.evidence.eid === value.field &&
    value.evidence.value_display === value.display
  );
}

export function isTabularRenderSpec(
  value: unknown,
): value is TabularRenderSpec {
  if (
    !record(value) ||
    !only(value, ["v", "type", "title", "columns", "rows"]) ||
    value.v !== 2 ||
    (value.type !== "stat_block" && value.type !== "comparison_table") ||
    typeof value.title !== "string" ||
    !Array.isArray(value.columns) ||
    !Array.isArray(value.rows)
  )
    return false;
  const columns = value.columns;
  const rows = value.rows;
  if (
    columns.length === 0 ||
    !columns.every(
      (column) =>
        record(column) &&
        only(column, ["unitid", "name", "domain"]) &&
        (column.unitid === null || positiveInteger(column.unitid)) &&
        nonEmpty(column.name) &&
        (!("domain" in column) || nullableString(column.domain)),
    ) ||
    rows.length === 0 ||
    !rows.every(
      (row) =>
        record(row) &&
        only(row, ["label", "cells"]) &&
        typeof row.label === "string" &&
        Array.isArray(row.cells) &&
        row.cells.length === columns.length &&
        row.cells.every(envelope),
    )
  )
    return false;
  return value.type === "stat_block"
    ? columns.length === 1
    : columns.length >= 2;
}

export function isCurrentSourceEntry(value: unknown): value is SourceEntry {
  if (
    !record(value) ||
    !only(value, [
      "v",
      "index",
      "citation",
      "label",
      "snippet",
      "evidence",
      "evidence_omitted_count",
    ]) ||
    value.v !== 2 ||
    !positiveInteger(value.index) ||
    !isCurrentCitation(value.citation) ||
    typeof value.label !== "string" ||
    (!("snippet" in value) || nullableString(value.snippet)) === false ||
    !Array.isArray(value.evidence) ||
    !value.evidence.every(isCurrentEvidence) ||
    !Number.isSafeInteger(value.evidence_omitted_count) ||
    (value.evidence_omitted_count as number) < 0
  )
    return false;
  return value.citation.source === "cds" || value.evidence.length === 0;
}
