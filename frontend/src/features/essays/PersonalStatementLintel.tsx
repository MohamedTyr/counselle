import { PencilLine, Plus } from "lucide-react";

import type { ApplicationView } from "@/api/workspace/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Essay } from "@/domain/essay";
import {
  EssayActionsMenu,
  type EssayActions,
} from "@/features/essays/EssayActionsMenu";
import { EssayWordProgress } from "@/features/essays/EssayWordProgress";
import { schoolColourStyle } from "@/features/essays/SchoolEssayColumn";
import { SchoolAvatar } from "@/features/schools/school-cells";
import { essayStatusVariant } from "@/lib/essay-display";

const MAX_MARKS = 5;
const COMMON_APP_URL = "https://www.commonapp.org";
/* Derived from the Common App favicon by scripts/build_school_colours.py,
 * the same way every school's colour is. */
const COMMON_APP_COLOUR = { fill: "#006bc0", ink: "#006bc0" };

function ReachLine({ schools }: { schools: ApplicationView[] }) {
  const shown = schools.slice(0, MAX_MARKS);

  if (schools.length === 0) {
    return <>Common App</>;
  }

  return (
    <>
      <span>Goes to</span>
      <span aria-hidden="true" className="flex -space-x-1">
        {shown.map((school) => (
          <span
            className="rounded-[7px] ring-[1.5px] ring-(--essay-column-surface)"
            key={school.id}
          >
            <SchoolAvatar
              name={school.school_name}
              size="sm"
              websiteUrl={school.website_url}
            />
          </span>
        ))}
      </span>
      <span className="tabular-nums">
        {schools.length} {schools.length === 1 ? "school" : "schools"}
      </span>
    </>
  );
}

/* The personal statement is one essay that every school on the list reads,
 * so it sits above the school columns as a single row built like a column
 * header: who it is for on the left, how far along it is and the way back
 * into it on the right. */
export function PersonalStatementLintel({
  actions,
  essay,
  onStart,
  schools,
}: {
  actions: EssayActions;
  essay: Essay | null;
  onStart: () => void;
  schools: ApplicationView[];
}) {
  const isStarted =
    essay !== null && (essay.status !== "Not started" || essay.wordCount > 0);

  return (
    <section
      aria-label="Personal statement"
      className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-[18px] px-4 py-3"
      data-slot="essay-lintel"
      style={schoolColourStyle(COMMON_APP_COLOUR)}
    >
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <SchoolAvatar name="Common App" websiteUrl={COMMON_APP_URL} />
        <div className="min-w-0">
          <h2 className="truncate text-[15px] leading-5 font-semibold tracking-[-0.015em] text-(--ink)">
            {essay?.title ?? "Personal statement"}
          </h2>
          <p className="mt-1 flex items-center gap-1.5 truncate text-xs text-(--ink-secondary)">
            <ReachLine schools={schools} />
          </p>
        </div>
      </div>

      {essay ? (
        <div className="flex items-center gap-4 max-sm:w-full">
          <EssayWordProgress className="w-40 max-sm:flex-1" essay={essay} />
          <Badge variant={essayStatusVariant[essay.status]}>
            {essay.status}
          </Badge>
          <div className="flex items-center gap-1">
            <Button
              onClick={() => actions.onOpenEssay?.(essay)}
              size="sm"
              type="button"
            >
              <PencilLine aria-hidden="true" data-icon="inline-start" />
              {isStarted ? "Keep writing" : "Start writing"}
            </Button>
            <EssayActionsMenu essay={essay} {...actions} />
          </div>
        </div>
      ) : (
        <Button onClick={onStart} size="sm" type="button">
          <Plus aria-hidden="true" data-icon="inline-start" />
          Start writing
        </Button>
      )}
    </section>
  );
}
