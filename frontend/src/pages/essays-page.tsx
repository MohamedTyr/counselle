import { useNavigate } from "react-router";

import type { Essay } from "@/domain/essay";
import { EssaysPage as EssaysFeaturePage } from "@/features/essays/EssaysRoute";
import { useEssaysWorkspace } from "@/features/essays/useEssaysWorkspace";

export function EssaysPage() {
  const navigate = useNavigate();
  const { essays, setEssays } = useEssaysWorkspace();

  function handleOpenEssay(essay: Essay) {
    void navigate(`/app/essays/${essay.id}`);
  }

  return (
    <EssaysFeaturePage
      essays={essays}
      onEssaysChange={setEssays}
      onOpenEssay={handleOpenEssay}
    />
  );
}
