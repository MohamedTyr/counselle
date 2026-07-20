import { useNavigate, useParams } from "react-router";

import { useEssay } from "@/api/workspace/hooks";
import { Button } from "@/components/ui/button";
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
        <div className="max-w-md rounded-xl border bg-card p-6">
          <div className="space-y-3">
            <h1 className="font-heading text-lg font-medium">
              Could not load essay
            </h1>
            <p className="text-sm text-muted-foreground">
              The workspace could not reach this essay.
            </p>
            <div className="flex gap-2">
              <Button onClick={() => void essayQuery.refetch()}>
                Try again
              </Button>
              <Button
                onClick={() => void navigate("/app/essays")}
                type="button"
                variant="outline"
              >
                Back to essays
              </Button>
            </div>
          </div>
        </div>
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
