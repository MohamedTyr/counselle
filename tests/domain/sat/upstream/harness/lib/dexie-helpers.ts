import { progressDb } from "@/db";
import type { AttemptRecord, BookmarkRecord } from "@/types/questions";

export async function resetProgressDb(): Promise<void> {
  await progressDb.attempts.clear();
  await progressDb.bookmarks.clear();
}

export async function seedAttempts(attempts: AttemptRecord[]): Promise<void> {
  if (attempts.length === 0) return;
  await progressDb.attempts.bulkAdd(attempts);
}

export async function seedBookmarks(bookmarks: BookmarkRecord[]): Promise<void> {
  if (bookmarks.length === 0) return;
  await progressDb.bookmarks.bulkAdd(bookmarks);
}
