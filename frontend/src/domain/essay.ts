export type EssayStatus =
  "Not started" | "Drafting" | "Needs review" | "Ready" | "Submitted";

export type EssayType =
  "Personal statement" | "Supplement" | "Scholarship" | "Optional";

export type EssayRisk =
  "Over limit" | "Missing real detail" | "Reuse risk" | "Too generic";

export type Essay = {
  comments: number;
  deadline: string;
  dueSoon?: boolean;
  id: string;
  logoUrl: string;
  previewLines: string[];
  previewTitle: string;
  risk?: EssayRisk;
  school: string;
  schoolLocation: string;
  status: EssayStatus;
  suggestions: number;
  title: string;
  type: EssayType;
  updatedAt: string;
  version: string;
  wordCount: number;
  wordLimit: number;
};
