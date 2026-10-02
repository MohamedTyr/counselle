import type {
  ApplicationSupplements,
  ApplicationView,
} from "@/api/workspace/types";
import type { Essay } from "@/domain/essay";
import type { EssayActions } from "@/features/essays/EssayActionsMenu";
import type { EssaysBySchool as Groups } from "@/features/essays/essays-by-school";
import { PersonalStatementLintel } from "@/features/essays/PersonalStatementLintel";
import { SchoolEssayColumn } from "@/features/essays/SchoolEssayColumn";
import {
  SupplementColumnRows,
  SupplementSourceNote,
} from "@/features/essays/SupplementColumnRows";
import { formatDeadlineDate } from "@/features/schools/explore/explore-format";
import { schoolColour } from "@/features/schools/explore/school-colours";
import { SchoolAvatar } from "@/features/schools/school-cells";
import { getDeadlineUrgency } from "@/features/schools/schools-deadline";

function deadlineLabel(application: ApplicationView) {
  const date = formatDeadlineDate(application.deadline);
  return date ? `Due ${date}` : null;
}

/* The personal statement as one row above the schools, then one column per
 * school with the essays it needs. `visible` is the set the filter and search
 * let through; the "done" counts always use every essay. */
export function EssaysBySchool({
  actions,
  groups,
  isFiltering,
  onAddEssay,
  onStartPersonalStatement,
  supplements,
  visible,
}: {
  actions: EssayActions;
  groups: Groups;
  isFiltering: boolean;
  onAddEssay: (applicationId: string) => void;
  onStartPersonalStatement: () => void;
  /* Each listed school's prompts, by application id. Hidden while filtering:
   * a filter narrows essays, and prompts not yet started are not essays. */
  supplements: Map<string, ApplicationSupplements>;
  visible: Set<string>;
}) {
  const only = (essays: Essay[]) =>
    essays.filter((essay) => visible.has(essay.id));
  const ps = groups.personalStatement;
  const showLintel = !isFiltering || (ps !== null && visible.has(ps.id));
  const schools = groups.schools.filter(
    (group) => !isFiltering || only(group.essays).length > 0,
  );
  const unlinked = only(groups.unlinked);

  return (
    <>
      {showLintel ? (
        <PersonalStatementLintel
          actions={actions}
          essay={ps}
          onStart={onStartPersonalStatement}
          schools={groups.schools.map((group) => group.application)}
        />
      ) : null}
      {/* Masonry: schools differ a lot in how many essays they ask for, so a
       * row-aligned grid leaves holes under the short ones. Columns flow
       * top to bottom, earliest deadline first. */}
      <div className="gap-4 md:columns-2 xl:columns-3 [&>*]:mb-4 [&>*]:break-inside-avoid">
        {schools.map(({ application, essays }) => (
          <SchoolEssayColumn
            actions={actions}
            addLabel={`Add an essay for ${application.school_name}`}
            colour={schoolColour(application.school_unitid)}
            countEssays={essays}
            deadlineLabel={deadlineLabel(application)}
            dueSoon={getDeadlineUrgency(application.deadline) === "close"}
            essays={only(essays)}
            key={application.id}
            mark={
              <SchoolAvatar
                name={application.school_name}
                websiteUrl={application.website_url}
              />
            }
            name={application.school_name}
            onAdd={isFiltering ? undefined : () => onAddEssay(application.id)}
            supplements={
              isFiltering ? null : (
                <SupplementColumnRows supplements={supplements.get(application.id)} />
              )
            }
            footnote={
              isFiltering ? null : (
                <SupplementSourceNote supplements={supplements.get(application.id)} />
              )
            }
          />
        ))}
        {unlinked.length > 0 ? (
          <SchoolEssayColumn
            actions={actions}
            colour={null}
            countEssays={groups.unlinked}
            deadlineLabel="Not tied to a school"
            essays={unlinked}
            mark={null}
            name="Other essays"
          />
        ) : null}
      </div>
    </>
  );
}
