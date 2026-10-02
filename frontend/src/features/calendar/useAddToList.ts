// "Add to list" from the All schools layer, the same add Explore makes (plan
// D15): a Target application, the same toast, the same Undo. It differs in
// three ways. The round is the deadline's own. The cycle is the one the dates
// were reported for. And no deadline is sent, so the application inherits
// Counselle's date instead of carrying a copy of it.
import { toast } from "sonner";

import type { CalendarRound, SchoolDeadlineItem } from "@/api/calendar/types";
import {
  useAddApplication,
  useArchiveApplication,
} from "@/api/workspace/hooks";
import type { Round } from "@/api/workspace/types";

/** EA II has no `Round`: an EA application would inherit the EA date and land
 * on a different day than the one the student clicked, so it cannot be added
 * from here. */
const LIST_ROUND: Record<CalendarRound, Round | null> = {
  EA: "EA",
  EA2: null,
  ED: "ED",
  ED2: "ED2",
  RD: "RD",
};

export function canAddRound(round: CalendarRound): boolean {
  return LIST_ROUND[round] !== null;
}

export function useAddToList(cycleYear: number | undefined) {
  const addApplication = useAddApplication();
  const archiveApplication = useArchiveApplication();

  async function addToList(school: SchoolDeadlineItem): Promise<boolean> {
    const round = LIST_ROUND[school.round];
    if (!round || cycleYear === undefined) {
      return false;
    }
    try {
      const created = await addApplication.mutateAsync({
        cycle_year: cycleYear,
        list_type: "Target",
        optimisticSchool: {
          active_cycle_years: [cycleYear],
          city: null,
          has_legacy_application: false,
          name: school.school_name,
          on_list: true,
          state: null,
          unitid: school.unitid,
          website_url: school.website_url,
        },
        round,
        unitid: school.unitid,
      });
      toast.success(`${created.application.school_name} added to your list`, {
        action: {
          label: "Undo",
          onClick: () => {
            void archiveApplication.mutateAsync(created.application.id);
          },
        },
      });
      return true;
    } catch {
      // The workspace mutation hook owns rollback and the error toast.
      return false;
    }
  }

  return { addToList, isAdding: addApplication.isPending };
}
