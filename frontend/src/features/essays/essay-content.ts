import { faviconUrlForDomain } from "@/features/ai-chat/citations";
import type { Essay } from "@/domain/essay";

export const emptyTiptapDocument = {
  type: "doc",
  content: [{ type: "paragraph" }],
} as const;

export const commonAppPrompt =
  "Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. Share your story.";

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

export function getEssayPrompt(essay: Essay) {
  if (essay.prompt) {
    return essay.prompt;
  }

  if (essay.type === "Personal statement") {
    return commonAppPrompt;
  }

  return `${essay.schoolName} ${essay.type.toLowerCase()}: respond directly to the prompt, use school-specific details, and keep the answer inside the listed word limit.`;
}

export function getPreviewLines(preview: string) {
  return preview
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 5);
}
