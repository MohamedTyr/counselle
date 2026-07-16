import type {
  Citation,
  MessageSourcesPayload,
  RenderSpec,
  ReplaySourceEntry,
  SourceFocus,
  SourceName,
} from "@/api/chat/types";
import { isTabularRenderSpec } from "@/api/chat/validation";
import remarkGfm from "remark-gfm";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { visit } from "unist-util-visit";

import type { AssistantChatMessage } from "./model";
import { isLegacySourceEntry } from "@/api/chat/legacy-replay";

export const CITATION_PATTERN = /\[(\d+)\]/g;
export const DB_SOURCES: ReadonlySet<SourceName> = new Set(["cds", "profile"]);
const markdownParser = unified().use(remarkParse).use(remarkGfm);

export function isDbSource(source: SourceName | string): boolean {
  return source === "cds" || source === "profile";
}

export function uniqueSourceByIndex(
  sources: ReadonlyArray<ReplaySourceEntry> | undefined,
  index: number,
): ReplaySourceEntry | undefined {
  const matches = (sources ?? []).filter((entry) => entry.index === index);
  return matches.length === 1 ? matches[0] : undefined;
}

export function citedIndexesIn(markdown: string): Set<number> {
  const indexes = new Set<number>();
  const tree = markdownParser.parse(markdown);
  visit(tree, "text", (node: { value?: unknown }) => {
    if (typeof node.value !== "string") return;
    for (const match of node.value.matchAll(CITATION_PATTERN)) {
      const index = Number(match[1]);
      if (Number.isSafeInteger(index) && index > 0) indexes.add(index);
    }
  });
  return indexes;
}

export function citedIndexesForMessage(message: {
  blocks?: AssistantChatMessage["blocks"];
  text?: string;
}): Set<number> {
  const indexes = new Set<number>();
  const markdown = message.blocks?.filter((block) => block.kind === "markdown")
    .map((block) => block.text) ?? [message.text ?? ""];
  for (const text of markdown) {
    for (const index of citedIndexesIn(text)) indexes.add(index);
  }
  return indexes;
}

function markerIndex(marker: string | null | undefined): number | undefined {
  const match = marker?.match(/^\[(\d+)\]$/);
  if (match === undefined || match === null) return undefined;
  const index = Number(match[1]);
  return Number.isSafeInteger(index) && index > 0 ? index : undefined;
}

export function sourceFocusForCell(cell: {
  available: boolean;
  marker?: string | null;
  field?: string | null;
  citation?: Citation | null;
}): SourceFocus | undefined {
  if (!cell.available) return undefined;
  const index = markerIndex(cell.marker);
  if (index === undefined) return undefined;
  return cell.citation?.source === "cds" && cell.field
    ? { index, evidenceId: cell.field }
    : { index };
}

export function sourceIndexesForViz(spec: RenderSpec): Set<number> {
  const indexes = new Set<number>();
  if (!isTabularRenderSpec(spec)) return indexes;
  for (const row of spec.rows) {
    for (const cell of row.cells) {
      const focus = sourceFocusForCell(cell);
      if (focus !== undefined) indexes.add(focus.index);
    }
  }
  return indexes;
}

export function sourcesUsedByMessage(message: {
  blocks?: AssistantChatMessage["blocks"];
  text?: string;
  sources?: ReadonlyArray<ReplaySourceEntry>;
}): ReplaySourceEntry[] {
  const indexes = citedIndexesForMessage(message);
  for (const block of message.blocks ?? []) {
    if (block.kind !== "viz") continue;
    for (const index of sourceIndexesForViz(block.spec)) indexes.add(index);
  }

  const counts = new Map<number, number>();
  for (const entry of message.sources ?? []) {
    counts.set(entry.index, (counts.get(entry.index) ?? 0) + 1);
  }
  return (message.sources ?? []).filter(
    (entry) => indexes.has(entry.index) && counts.get(entry.index) === 1,
  );
}

export function sourcesPayloadFor(
  message: Parameters<typeof sourcesUsedByMessage>[0],
  active?: SourceFocus,
): MessageSourcesPayload | null {
  const sources = sourcesUsedByMessage(message);
  return sources.length === 0 ? null : { sources, active };
}

export function citedSourcesForMessage(message: {
  blocks?: AssistantChatMessage["blocks"];
  text?: string;
  sources?: ReadonlyArray<ReplaySourceEntry>;
}): ReplaySourceEntry[] {
  const indexes = citedIndexesForMessage(message);
  return sourcesUsedByMessage(message).filter((entry) => indexes.has(entry.index));
}

export function friendlySourceName(citation: Citation): string {
  if (citation.source === "reddit") {
    return citation.url?.match(/reddit\.com\/(r\/[A-Za-z0-9_]+)/i)?.[1] ?? "Reddit";
  }
  if (citation.source === "cds") return "Common Data Set";
  if (citation.source === "profile") return "School profile";
  return hostOf(citation) ?? "Source";
}

export function sourceDisplayName(entry: ReplaySourceEntry): string {
  return isLegacySourceEntry(entry)
    ? entry.citation.source
    : friendlySourceName(entry.citation);
}

function hostOf(citation: Citation): string | null {
  const href = safeExternalUrl(citation.url);
  return href === undefined ? null : new URL(href).hostname.replace(/^www\./, "");
}

export function safeExternalUrl(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : undefined;
  } catch {
    return undefined;
  }
}
