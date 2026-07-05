import { Navigate, useNavigate, useParams } from "react-router";

import { EssayEditorPage as EssayEditorFeaturePage } from "@/features/essays/EssayEditorRoute";
import { useEssaysWorkspace } from "@/features/essays/useEssaysWorkspace";

export function EssayEditorPage() {
  const navigate = useNavigate();
  const { essayId } = useParams();
  const { essays } = useEssaysWorkspace();
  const essay = essays.find((candidateEssay) => candidateEssay.id === essayId);

  if (!essay) {
    return <Navigate replace to="/app/essays" />;
  }

  return (
    <EssayEditorFeaturePage
      essay={essay}
      key={essay.id}
      onBack={() => void navigate("/app/essays")}
    />
  );
}
