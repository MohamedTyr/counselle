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
