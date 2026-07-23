import { FilePenLine, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { EssayPromptDraftSummary } from "@/api/workspace/types";

export function PromptDraftRow({
  draft,
  isConverting,
  onConvert,
  onDelete,
  showSchool = false,
}: {
  draft: EssayPromptDraftSummary;
  isConverting: boolean;
  onConvert: () => void;
  onDelete: () => void;
  showSchool?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1">
        {showSchool ? (
          <p className="text-xs font-medium text-muted-foreground">
            {draft.school_name}
          </p>
        ) : null}
        <p className="text-sm leading-6">{draft.prompt}</p>
        {draft.word_limit ? (
          <Badge className="mt-1.5" variant="outline">
            {draft.word_limit} words
          </Badge>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <Button
          disabled={isConverting}
          onClick={onConvert}
          size="sm"
        >
          <FilePenLine data-icon="inline-start" />
          Start writing
        </Button>
        <Button
          aria-label="Delete tracked prompt"
          onClick={onDelete}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2 className="text-muted-foreground" />
        </Button>
      </div>
    </div>
  );
}
