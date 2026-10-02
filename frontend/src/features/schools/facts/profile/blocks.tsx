import type { FactSection } from "@/features/schools/facts/school-facts-types";

import { APPLY_BLOCKS, FINISH_BLOCKS } from "./blocks-apply";
import { COST_BLOCKS } from "./blocks-cost";
import { IN_BLOCKS } from "./blocks-in";
import { LEARN_BLOCKS } from "./blocks-learn";
import { LIFE_BLOCKS } from "./blocks-life";
import { type Block, type QuestionId, covers } from "./blocks-types";
import type { FactReader } from "./reader";

/*
 * Every block, in reading order, plus the bookkeeping that keeps the
 * server's cautions attached to whatever shows its figures. A block that
 * renders nothing for this school is dropped, so the page never shows an
 * empty section.
 */

const ALL_BLOCKS: Block[] = [
  ...IN_BLOCKS,
  ...COST_BLOCKS,
  ...APPLY_BLOCKS,
  ...LEARN_BLOCKS,
  ...LIFE_BLOCKS,
  ...FINISH_BLOCKS,
];

export type RenderedBlock = { block: Block; node: React.ReactNode };

export function renderBlocks(
  r: FactReader,
  question: QuestionId,
): RenderedBlock[] {
  return ALL_BLOCKS.filter(
    (b) =>
      b.question === question &&
      (b.present ? b.present(r) : keysOf(r, b).length > 0),
  )
    .map((block) => ({ block, node: block.render(r) }))
    .filter((x) => x.node !== null && x.node !== false);
}

/** The published facts a block draws. */
export function keysOf(r: FactReader, block: Block): string[] {
  return [...r.facts.values()]
    .filter((fact) => fact.state === "value" && covers(block, fact.key))
    .map((fact) => fact.key);
}

/** Published facts no block draws — shown as plain rows so a figure the
 * crawler adds before a block knows about it is never lost. */
export function leftoverKeys(r: FactReader): string[] {
  return [...r.facts.values()]
    .filter(
      (fact) =>
        fact.state === "value" && !ALL_BLOCKS.some((b) => covers(b, fact.key)),
    )
    .map((fact) => fact.key);
}

/** The school years these figures cover, as the server dated them. Figures
 * with no year fall under their section's own note. */
export function periodsOf(r: FactReader, keys: string[]): string[] {
  const periods = keys
    .map((key) => r.facts.get(key)?.reported_period ?? null)
    .filter((p): p is string => p !== null);
  return [...new Set(periods)].sort();
}

/** The server's notes on the groups these figures came from, once each. */
export function groupFootsOf(r: FactReader, keys: string[]): string[] {
  return unique(keys.map((key) => r.groupFootOf.get(key) ?? null));
}

/** The server sections these figures came from, in the server's order. */
export function sectionsOf(r: FactReader, keys: string[]): FactSection[] {
  const ids = new Set(keys.map((key) => r.sectionOf.get(key)));
  return r.data.sections.filter((section) => ids.has(section.id));
}

export function unique(values: (string | null)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))];
}
