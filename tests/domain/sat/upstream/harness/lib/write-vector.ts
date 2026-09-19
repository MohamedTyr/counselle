import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";

const HARNESS_DIR = path.resolve(import.meta.dirname, "..");
const UPSTREAM_DIR = path.resolve(HARNESS_DIR, "..");
const VECTORS_DIR = path.resolve(UPSTREAM_DIR, "vectors");

interface Stamp {
  upstream_commit: string;
  patch_sha256: string;
  prepared_at: string;
}

function readStamp(): Stamp {
  const stampFile = path.join(HARNESS_DIR, ".upstream-stamp.json");
  if (!existsSync(stampFile)) {
    throw new Error(`missing ${stampFile} — run "npm run prepare:upstream" first`);
  }
  return JSON.parse(readFileSync(stampFile, "utf-8")) as Stamp;
}

// Vector files larger than this are gzipped (plan §8.2: "keep vector files
// reasonably sized, gzip any > 2 MB and say so" — documented per-file in the
// generator's console output and in the report).
const GZIP_THRESHOLD_BYTES = 2 * 1024 * 1024;

/** Writes `vectors/<name>.json` (or `.json.gz` past the size threshold), stamped with
 * the upstream commit and patch sha256 so a vector can always be traced back
 * to what produced it. */
export function writeVector(name: string, cases: unknown[]): { path: string; count: number; gzipped: boolean } {
  const stamp = readStamp();
  mkdirSync(VECTORS_DIR, { recursive: true });

  const payload = {
    suite: name,
    upstream_commit: stamp.upstream_commit,
    patch_sha256: stamp.patch_sha256,
    generated_at: new Date().toISOString(),
    count: cases.length,
    cases,
  };

  const json = JSON.stringify(payload, null, 2);
  const jsonBytes = Buffer.byteLength(json, "utf-8");

  if (jsonBytes > GZIP_THRESHOLD_BYTES) {
    const outPath = path.join(VECTORS_DIR, `${name}.json.gz`);
    writeFileSync(outPath, gzipSync(Buffer.from(json, "utf-8")));
    return { path: outPath, count: cases.length, gzipped: true };
  }

  const outPath = path.join(VECTORS_DIR, `${name}.json`);
  writeFileSync(outPath, json);
  return { path: outPath, count: cases.length, gzipped: false };
}
