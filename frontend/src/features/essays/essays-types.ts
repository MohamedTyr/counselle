import type { Essay, EssayDetail } from "@/domain/essay";

export type EssaysPageProps = {
  onOpenEssay?: (essay: Essay) => void;
};

export type EssayEditorPageProps = {
  essay: EssayDetail;
  onBack: () => void;
};
