import type { Essay } from "@/domain/essay";
export const commonAppPrompt =
  "Some students have a background, identity, interest, or talent that is so meaningful they believe their application would be incomplete without it. Share your story.";

export function countWords(text: string) {
  return text
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0).length;
}

export function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function getInitialEssayContent(essay: Essay) {
  const lines =
    essay.previewLines.length > 0
      ? essay.previewLines
      : ["Start with the most specific moment, image, or decision first."];

  return `
    <h1>${escapeHtml(essay.previewTitle || essay.title)}</h1>
    ${lines.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}
  `;
}

export function estimateInitialWordCount(content: string) {
  return countWords(content.replace(/<[^>]*>/g, " "));
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

export function getEssayPrompt(essay: Essay) {
  if (essay.id === "common-app-main") {
    return commonAppPrompt;
  }

  if (essay.type === "Personal statement") {
    return "Draft the personal statement around a concrete story, then connect the reflection back to the applicant's values and future work.";
  }

  return `${essay.school} ${essay.type.toLowerCase()}: respond directly to the prompt, use school-specific details, and keep the answer inside the listed word limit.`;
}
