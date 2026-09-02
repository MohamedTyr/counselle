import { faviconUrlForDomain } from "@/features/ai-chat/citations";
import type { Essay } from "@/domain/essay";

export const emptyTiptapDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
} as const;

export function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

export function getSchoolFallback(school: string) {
  const words = school.trim().split(/\s+/).filter(Boolean);

  if (words.length >= 2) {
    return words
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  }

  return school.slice(0, 2).toUpperCase();
}

export function getSchoolFaviconUrl(websiteUrl: string | null): string | undefined {
  if (!websiteUrl) {
    return undefined;
  }

  try {
    return faviconUrlForDomain(new URL(websiteUrl).hostname);
  } catch {
    return undefined;
  }
}

/**
 * The essay's real prompt, or `null` when the student hasn't added one.
 * There is no fallback text here — a promptless essay has no prompt, and
 * `PromptMenu` (`EssayEditorHeader.tsx`) is responsible for saying that
 * honestly rather than being handed something invented to display.
 */
export function getEssayPrompt(essay: Essay): string | null {
  return essay.prompt || null;
}

export function getPreviewLines(preview: string) {
  return preview
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
}
