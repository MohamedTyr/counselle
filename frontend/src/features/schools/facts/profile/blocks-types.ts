import type React from "react";

import type { FactReader } from "./reader";

/*
 * A block is one designed unit of a school's data — the admit rate, the
 * aid it gives, its housing. Variants differ in how they frame and order
 * blocks, never in what a block shows, so every layout covers the same
 * facts. `keys` names every fact the block draws (a trailing `*` is a
 * prefix) so the leftovers can be computed rather than guessed.
 */

export type QuestionId = "in" | "cost" | "apply" | "learn" | "life" | "finish";

export type Block = {
  id: string;
  question: QuestionId;
  title: string;
  /** How much room it wants in a grid: s = a third, m = half, l = full. */
  size: "s" | "m" | "l";
  keys: string[];
  /** Whether this school has anything for the block. Defaults to "at least
   * one of `keys` is published" — set only for a block fed from elsewhere. */
  present?: (r: FactReader) => boolean;
  render: (r: FactReader) => React.ReactNode | null;
};

export const QUESTIONS: { id: QuestionId; ask: string; title: string }[] = [
  { id: "in", ask: "Can I get in?", title: "Getting in" },
  { id: "cost", ask: "Can I afford it?", title: "Paying for it" },
  { id: "apply", ask: "How do I apply?", title: "Applying" },
  { id: "learn", ask: "What can I study?", title: "Academics" },
  { id: "life", ask: "What's it like?", title: "Campus life" },
  { id: "finish", ask: "Do students finish?", title: "Finishing" },
];

export function covers(block: Block, key: string): boolean {
  return block.keys.some((k) =>
    k.endsWith("*") ? key.startsWith(k.slice(0, -1)) : k === key,
  );
}
