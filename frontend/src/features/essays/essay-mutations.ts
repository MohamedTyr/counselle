import type { Essay } from "@/domain/essay";

function createEssayId(prefix: string) {
  return `${prefix}-${Date.now()}`;
}

export function createNewEssay(nextIndex: number): Essay {
  return {
    comments: 0,
    deadline: "Jan 1, 2027",
    id: createEssayId("new-essay"),
    logoUrl: "https://www.google.com/s2/favicons?domain=commonapp.org&sz=64",
    previewLines: [],
    previewTitle: "Untitled",
    school: "Common App",
    schoolLocation: "All schools",
    status: "Not started",
    suggestions: 0,
    title: `Untitled essay ${nextIndex + 1}`,
    type: "Supplement",
    updatedAt: "Not started",
    version: "v0",
    wordCount: 0,
    wordLimit: 250,
  };
}

export function duplicateEssay(essay: Essay, nextIndex: number): Essay {
  return {
    ...essay,
    comments: 0,
    id: `${essay.id}-copy-${Date.now()}`,
    status: "Drafting",
    suggestions: 0,
    title: `${essay.title} copy`,
    updatedAt: "just now",
    version: `v${nextIndex + 1}`,
  };
}

export function updateEssayById(
  essays: Essay[],
  essayId: string,
  patch: Partial<Essay>,
) {
  return essays.map((essay) =>
    essay.id === essayId ? { ...essay, ...patch } : essay,
  );
}
