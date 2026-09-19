import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

// Default research corpus shipped with the plan. Every generator accepts an
// override so it can be re-run later over the full raw bank directory (see
// each generate.*.spec.ts's header comment and README.md).
export const DEFAULT_RESEARCH_DIR = path.resolve(
  import.meta.dirname,
  "../../../../../../artifacts/sat-practice/research",
);

export function researchDir(): string {
  return process.env.SAT_RESEARCH_DIR ?? DEFAULT_RESEARCH_DIR;
}

export function listJsonFiles(subdir: string, base = researchDir()): string[] {
  const dir = path.join(base, subdir);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => path.join(dir, f));
}

export function readJson<T = unknown>(file: string): T {
  return JSON.parse(readFileSync(file, "utf-8")) as T;
}
