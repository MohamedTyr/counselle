import type {
  Citation,
  CitationEnvelope,
  RenderSpec,
  SourceEntry,
  SourceName,
} from "@/api/chat/types";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import type { AssistantChatMessage } from "./model";

const CITATION_PATTERN = /\[(\d{1,3})\]/g;
const DB_SOURCES: ReadonlySet<string> = new Set(["cds", "ipeds", "scorecard"]);
const markdownParser = unified().use(remarkParse).use(remarkGfm);

export function isDbSource(source: SourceName | string): boolean {
  return DB_SOURCES.has(source);
}

export function uniqueSourceByIndex(
  sources: ReadonlyArray<SourceEntry> | undefined,
  index: number,
): SourceEntry | undefined {
  let found: SourceEntry | undefined;

  for (const entry of sources ?? []) {
    if (entry.index !== index) {
      continue;
    }

    if (found !== undefined) {
      return undefined;
    }

    found = entry;
  }

  return found;
}

export function uniqueSourcesByIndexes(
  sources: ReadonlyArray<SourceEntry> | undefined,
  indexes: ReadonlySet<number>,
): SourceEntry[] {
  if (sources === undefined || sources.length === 0 || indexes.size === 0) {
    return [];
  }

  const firstByIndex = new Map<number, SourceEntry>();
  const duplicateIndexes = new Set<number>();

  for (const entry of sources) {
    if (!indexes.has(entry.index)) {
      continue;
    }

    if (firstByIndex.has(entry.index)) {
      duplicateIndexes.add(entry.index);
      continue;
    }

    firstByIndex.set(entry.index, entry);
  }

  return sources.filter(
    (entry) =>
      indexes.has(entry.index) &&
      firstByIndex.get(entry.index) === entry &&
      !duplicateIndexes.has(entry.index),
  );
}

export function citedIndexesIn(markdown: string): Set<number> {
  const indexes = new Set<number>();
  const tree = markdownParser.parse(markdown);

  visit(tree, "text", (node: { value?: unknown }) => {
    if (typeof node.value !== "string") {
      return;
    }

    for (const match of node.value.matchAll(CITATION_PATTERN)) {
      indexes.add(Number(match[1]));
    }
  });

  return indexes;
}

export function citedIndexesForMessage(message: {
  blocks?: AssistantChatMessage["blocks"];
  text?: string;
}): Set<number> {
  if (message.blocks !== undefined) {
    const indexes = new Set<number>();

    for (const block of message.blocks) {
      if (block.kind !== "markdown") {
        continue;
      }

      for (const index of citedIndexesIn(block.text)) {
        indexes.add(index);
      }
    }

    return indexes;
  }

  return citedIndexesIn(message.text ?? "");
}

export function citedSourcesForMessage(message: {
  blocks?: AssistantChatMessage["blocks"];
  text?: string;
  sources?: ReadonlyArray<SourceEntry>;
}): SourceEntry[] {
  return uniqueSourcesByIndexes(
    message.sources,
    citedIndexesForMessage(message),
  );
}

export function dbSourcesForMessage(message: {
  blocks?: AssistantChatMessage["blocks"];
  text?: string;
  sources?: ReadonlyArray<SourceEntry>;
}): SourceEntry[] {
  return citedSourcesForMessage(message).filter((entry) =>
    isDbSource(entry.citation.source),
  );
}

export function isRevealableDbCell(
  cell: CitationEnvelope | undefined,
): boolean {
  return cell?.available === true && isDbSource(cell.citation.source);
}

export function renderedCellsForSpec(
  spec: RenderSpec,
): Array<CitationEnvelope | undefined> {
  if (spec.type === "stat_block") {
    return spec.rows.map((row) => row.cells[0]);
  }

  if (spec.type === "comparison_table") {
    const schoolCount = spec.schools.length;
    return spec.rows.flatMap((row) => row.cells.slice(0, schoolCount));
  }

  return spec.rows.map((row) => row.cells[0]);
}

function hasDbVizCells(message: {
  blocks?: AssistantChatMessage["blocks"];
}): boolean {
  return (message.blocks ?? []).some(
    (block) =>
      block.kind === "viz" &&
      renderedCellsForSpec(block.spec).some(isRevealableDbCell),
  );
}

export function usedDbData(message: {
  blocks?: AssistantChatMessage["blocks"];
  text?: string;
  sources?: ReadonlyArray<SourceEntry>;
}): boolean {
  return dbSourcesForMessage(message).length > 0 || hasDbVizCells(message);
}

export function schoolFromDbLabel(label: string): string | null {
  const separatorIndex = label.indexOf(" — ");
  if (separatorIndex === -1) {
    return null;
  }

  const name = label.slice(0, separatorIndex).trim();

  return name.length > 0 ? name : null;
}

function addDbVizSchools(spec: RenderSpec, push: (name: string) => void): void {
  if (spec.type === "stat_block") {
    const school = spec.schools[0];
    if (school !== undefined && renderedCellsForSpec(spec).some(isRevealableDbCell)) {
      push(school.name);
    }
    return;
  }

  if (spec.type === "comparison_table") {
    spec.schools.forEach((school, index) => {
      if (spec.rows.some((row) => isRevealableDbCell(row.cells[index]))) {
        push(school.name);
      }
    });
    return;
  }

  const school = spec.schools[0];
  if (school !== undefined && renderedCellsForSpec(spec).some(isRevealableDbCell)) {
    push(school.name);
  }
}

export function dbSchoolsForMessage(message: {
  blocks?: AssistantChatMessage["blocks"];
  text?: string;
  sources?: ReadonlyArray<SourceEntry>;
}): string[] {
  const ordered: string[] = [];
  const seen = new Set<string>();
  const push = (name: string): void => {
    if (!seen.has(name)) {
      seen.add(name);
      ordered.push(name);
    }
  };

  for (const block of message.blocks ?? []) {
    if (block.kind === "viz") {
      addDbVizSchools(block.spec, push);
    }
  }

  if (ordered.length > 0) {
    return ordered;
  }

  for (const entry of dbSourcesForMessage(message)) {
    if (entry.citation.source !== "cds") {
      continue;
    }

    const name = schoolFromDbLabel(entry.label);
    if (name !== null) {
      push(name);
    }
  }

  return ordered;
}

function hostOf(citation: Citation): string | null {
  if (!citation.url) {
    return null;
  }

  try {
    return new URL(citation.url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function friendlySourceName(citation: Citation): string {
  if (citation.source === "reddit") {
    const match = citation.url?.match(/reddit\.com\/(r\/[A-Za-z0-9_]+)/i);
    return match?.[1] ?? "Reddit";
  }

  return hostOf(citation) ?? "Source";
}
