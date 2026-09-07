import { useNavigate, useParams } from "react-router";

import { useEssay } from "@/api/workspace/hooks";
import { Button } from "@/components/ui/button";
import { ErrorCard } from "@/components/ui/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { essayFromApi } from "@/domain/essay";
import { EssayEditorPage as EssayEditorFeaturePage } from "@/features/essays/EssayEditorRoute";

function EssayEditorSkeleton() {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4 p-4">
      <Skeleton className="h-20 w-full" />
      <Skeleton className="mx-auto h-[44rem] w-full max-w-[820px]" />
    </section>
  );
}

export function EssayEditorPage() {
  const navigate = useNavigate();
  const { essayId } = useParams();
  const essayQuery = useEssay(essayId ?? null);

  if (!essayId || essayQuery.isLoading) {
    return <EssayEditorSkeleton />;
  }

  if (essayQuery.isError || !essayQuery.data) {
    return (
      <section className="flex min-h-0 flex-1 items-start p-6">
        <ErrorCard
          headingLevel="h1"
          message="The workspace could not reach this essay."
          onRetry={() => void essayQuery.refetch()}
          secondaryAction={
            <Button
              onClick={() => void navigate("/app/essays")}
              type="button"
              variant="outline"
            >
              Back to essays
            </Button>
          }
          title="Could not load essay"
        />
      </section>
    );
  }

  return (
    <EssayEditorFeaturePage
      essay={essayFromApi(essayQuery.data)}
      key={essayQuery.data.id}
      onBack={() => void navigate("/app/essays")}
    />
  );
}
