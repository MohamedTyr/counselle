import { useNavigate } from "react-router";

import type { Essay } from "@/domain/essay";
import { EssaysPage as EssaysFeaturePage } from "@/features/essays/EssaysRoute";

export function EssaysPage() {
  const navigate = useNavigate();

  function handleOpenEssay(essay: Essay) {
    void navigate(`/app/essays/${essay.id}`);
  }

  return <EssaysFeaturePage onOpenEssay={handleOpenEssay} />;
}
