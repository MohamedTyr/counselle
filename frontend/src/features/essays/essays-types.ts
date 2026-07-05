import type { Essay } from "@/domain/essay";
import type { Dispatch, SetStateAction } from "react";

export type EssaysPageProps = {
  essays?: Essay[];
  onEssaysChange?: Dispatch<SetStateAction<Essay[]>>;
  onOpenEssay?: (essay: Essay) => void;
};

export type EssayEditorPageProps = {
  essay: Essay;
  onBack: () => void;
};
