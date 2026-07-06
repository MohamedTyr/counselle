import type { Essay } from "@/domain/essay";

export type EssaysPageProps = {
  onOpenEssay?: (essay: Essay) => void;
};

export type EssayEditorPageProps = {
  essay: Essay;
  onBack: () => void;
};
