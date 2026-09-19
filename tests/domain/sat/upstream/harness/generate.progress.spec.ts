// Generates vectors/progress_file.json — plan §8.2 "progress file" suite:
// 20 export -> import round trips through upstream's own
// `exportUserData`/`importUserData`, including A13a's defaults and junk
// rows (plan §4.6). Each case records what upstream actually persists
// (ground truth for the Python port's importer) and, for the export-side
// cases, the exact exported JSON string (ground truth for the exporter).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportUserData, importUserData } from "@/db";
import type { AttemptRecord, BookmarkRecord } from "@/types/questions";
import { progressDb } from "@/db";
import { resetProgressDb, seedAttempts, seedBookmarks } from "./lib/dexie-helpers";
import { writeVector } from "./lib/write-vector";

async function importText(text: string): Promise<{ result: unknown; error: string | null }> {
  const file = new File([text], "import.liprep", { type: "application/json" });
  try {
    const result = await importUserData(file);
    return { result, error: null };
  } catch (err) {
    return { result: null, error: err instanceof Error ? err.message : String(err) };
  }
}

async function captureExport(): Promise<string> {
  const OriginalBlob = globalThis.Blob;
  let captured: string | null = null;
  class CapturingBlob extends OriginalBlob {
    constructor(parts: BlobPart[], options?: BlobPropertyBag) {
      super(parts, options);
      captured = parts.join("");
    }
  }
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevoke = URL.revokeObjectURL;
  // @ts-expect-error test-only stubs; jsdom has no real object URL store.
  URL.createObjectURL = () => "blob:mock";
  URL.revokeObjectURL = () => {};
  // @ts-expect-error swapped in for the duration of the export call only.
  globalThis.Blob = CapturingBlob;
  try {
    await exportUserData();
  } finally {
    globalThis.Blob = OriginalBlob;
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevoke;
  }
  if (captured === null) throw new Error("export did not construct a Blob");
  return captured;
}

async function dbSnapshot(): Promise<{ attempts: AttemptRecord[]; bookmarks: BookmarkRecord[] }> {
  return {
    attempts: await progressDb.attempts.toArray(),
    bookmarks: await progressDb.bookmarks.toArray(),
  };
}

interface ProgressCase {
  label: string;
  direction: "import" | "export" | "round_trip";
  input?: unknown;
  importResult?: unknown;
  importError?: string | null;
  persisted?: { attempts: AttemptRecord[]; bookmarks: BookmarkRecord[] };
  exportedJson?: string;
}

const FROZEN_NOW = new Date("2026-09-19T15:00:00");

const sampleAttempt = (over: Partial<Record<string, unknown>> = {}): Record<string, unknown> => ({
  questionId: "q1",
  module: "math",
  primary_class_cd: "H",
  skill_cd: "H.A.",
  score_band_range_cd: 5,
  userAnswer: "3",
  isCorrect: true,
  timeSpentSeconds: 42,
  solvedAt: FROZEN_NOW.getTime() - 3600_000,
  dateKey: "2026-09-19",
  ...over,
});

describe("progress file vectors", () => {
  beforeEach(() => {
    // Fake only Date — faking setTimeout/queueMicrotask deadlocks
    // fake-indexeddb's internal transaction scheduling (it relies on real
    // timers to flush).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(FROZEN_NOW);
  });
  afterEach(async () => {
    vi.useRealTimers();
    await resetProgressDb();
  });

  it("generates 20 export/import round-trip vectors", async () => {
    const cases: ProgressCase[] = [];

    // --- Import-direction cases (A13a defaults + junk rows) ---
    const importScenarios: Array<{ label: string; payload: unknown }> = [
      {
        label: "well_formed_liprep_file",
        payload: {
          format: "LiPrep",
          version: 1,
          exportedAt: FROZEN_NOW.getTime(),
          exportDateStr: "2026-09-19",
          data: { attempts: [sampleAttempt()], bookmarks: [{ questionId: "q1", bookmarkedAt: FROZEN_NOW.getTime() }] },
        },
      },
      {
        label: "missing_module_defaults_reading",
        payload: { data: { attempts: [sampleAttempt({ module: undefined })], bookmarks: [] } },
      },
      {
        label: "missing_module_other_string_kept_as_given",
        payload: { data: { attempts: [sampleAttempt({ module: "ebrw-legacy" })], bookmarks: [] } },
      },
      {
        label: "missing_band_defaults_3",
        payload: { data: { attempts: [sampleAttempt({ score_band_range_cd: undefined })], bookmarks: [] } },
      },
      {
        label: "band_out_of_range_kept_as_is_by_upstream",
        payload: { data: { attempts: [sampleAttempt({ score_band_range_cd: 99 })], bookmarks: [] } },
      },
      {
        label: "missing_seconds_defaults_1",
        payload: { data: { attempts: [sampleAttempt({ timeSpentSeconds: undefined })], bookmarks: [] } },
      },
      {
        label: "zero_seconds_kept_as_is_by_upstream",
        payload: { data: { attempts: [sampleAttempt({ timeSpentSeconds: 0 })], bookmarks: [] } },
      },
      {
        label: "missing_solved_at_defaults_now",
        payload: { data: { attempts: [sampleAttempt({ solvedAt: undefined })], bookmarks: [] } },
      },
      {
        label: "missing_date_key_defaults_today",
        payload: { data: { attempts: [sampleAttempt({ dateKey: undefined })], bookmarks: [] } },
      },
      {
        label: "missing_primary_class_and_skill_default_empty_string",
        payload: { data: { attempts: [sampleAttempt({ primary_class_cd: undefined, skill_cd: undefined })], bookmarks: [] } },
      },
      {
        label: "missing_question_id_row_rejected",
        payload: { data: { attempts: [sampleAttempt({ questionId: undefined }), sampleAttempt({ questionId: "q2" })], bookmarks: [] } },
      },
      {
        label: "missing_is_correct_row_rejected",
        payload: { data: { attempts: [sampleAttempt({ isCorrect: undefined }), sampleAttempt({ questionId: "q3" })], bookmarks: [] } },
      },
      {
        label: "version_field_unchecked",
        payload: { version: 999, data: { attempts: [sampleAttempt()], bookmarks: [] } },
      },
      {
        label: "no_format_no_data_key_but_has_attempts_top_level",
        payload: { attempts: [sampleAttempt()], bookmarks: [] },
      },
      {
        label: "bookmarks_wiped_even_when_file_has_none",
        payload: { data: { attempts: [sampleAttempt()], bookmarks: [] } },
        seedBookmarksFirst: true,
      },
      {
        label: "non_array_attempts_and_bookmarks_treated_as_empty",
        payload: { data: { attempts: "not-an-array", bookmarks: "not-an-array" } },
      },
      {
        label: "invalid_json_content",
        payload: "{not valid json",
        raw: true,
      },
      {
        label: "wrong_shape_no_format_no_data",
        payload: { foo: "bar" },
      },
    ];

    for (const scenario of importScenarios as Array<{ label: string; payload: unknown; raw?: boolean; seedBookmarksFirst?: boolean }>) {
      await resetProgressDb();
      if (scenario.seedBookmarksFirst) {
        await seedBookmarks([{ questionId: "pre-existing", bookmarkedAt: FROZEN_NOW.getTime() }]);
      }
      const text = scenario.raw ? (scenario.payload as string) : JSON.stringify(scenario.payload);
      const { result, error } = await importText(text);
      const persisted = await dbSnapshot();
      cases.push({
        label: scenario.label,
        direction: "import",
        input: scenario.payload,
        importResult: result,
        importError: error,
        persisted,
      });
    }

    // --- Export-direction + round trip cases ---
    await resetProgressDb();
    await seedAttempts([
      sampleAttempt() as AttemptRecord,
      sampleAttempt({ questionId: "q2", isCorrect: false, skill_cd: "P.A.", primary_class_cd: "P" }) as AttemptRecord,
    ]);
    await seedBookmarks([{ questionId: "q1", bookmarkedAt: FROZEN_NOW.getTime() }]);
    const exportedJson = await captureExport();
    cases.push({ label: "export_known_state", direction: "export", exportedJson, persisted: await dbSnapshot() });

    // Round trip: export the seeded state, wipe, re-import the exported file, confirm what persists.
    await resetProgressDb();
    const { result: roundTripResult, error: roundTripError } = await importText(exportedJson);
    const roundTripPersisted = await dbSnapshot();
    cases.push({
      label: "round_trip_export_then_import",
      direction: "round_trip",
      input: JSON.parse(exportedJson),
      importResult: roundTripResult,
      importError: roundTripError,
      persisted: roundTripPersisted,
    });

    const result = writeVector("progress_file", cases);
    // eslint-disable-next-line no-console
    console.log(`wrote ${result.path} (${result.count} cases, gzipped=${result.gzipped})`);
    expect(result.count).toBe(20);
  });
});
