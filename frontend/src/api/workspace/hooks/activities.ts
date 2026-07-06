import { useQuery } from "@tanstack/react-query";

import {
  archiveActivity,
  archiveHonor,
  createActivity,
  createHonor,
  listActivities,
  listHonors,
  reorderActivities,
  reorderHonors,
  restoreActivity,
  restoreHonor,
  updateActivity,
  updateHonor,
} from "@/api/workspace/activities";
import { tempActivity, tempHonor } from "@/api/workspace/hook-utils";
import {
  useArchiveFromList,
  useCreateInList,
  useQueuedUpdateInList,
  useReorderList,
  useRestoreToList,
} from "@/api/workspace/hooks/shared";
import { workspaceKeys } from "@/api/workspace/keys";
import type { Activity, Honor } from "@/api/workspace/types";

function insertBySortOrder<TItem extends { id: string; sort_order: number }>(
  current: TItem[] | undefined,
  item: TItem,
) {
  return [
    item,
    ...(current ?? []).filter((entry) => entry.id !== item.id),
  ].sort((a, b) => a.sort_order - b.sort_order);
}

export function useActivities() {
  return useQuery({
    queryKey: workspaceKeys.activities.list(),
    queryFn: listActivities,
  });
}

export function useCreateActivity() {
  return useCreateInList(
    workspaceKeys.activities.list(),
    createActivity,
    (input, current) => tempActivity(input, (current?.length ?? 0) + 1),
  );
}

export function useUpdateActivity() {
  return useQueuedUpdateInList(workspaceKeys.activities.list(), updateActivity);
}

export function useArchiveActivity() {
  return useArchiveFromList(workspaceKeys.activities.list(), archiveActivity);
}

export function useRestoreActivity() {
  return useRestoreToList<Activity>(
    workspaceKeys.activities.list(),
    restoreActivity,
    [],
    insertBySortOrder,
  );
}

export function useReorderActivities() {
  return useReorderList(workspaceKeys.activities.list(), reorderActivities);
}

export function useHonors() {
  return useQuery({
    queryKey: workspaceKeys.honors.list(),
    queryFn: listHonors,
  });
}

export function useCreateHonor() {
  return useCreateInList(
    workspaceKeys.honors.list(),
    createHonor,
    (input, current) => tempHonor(input, (current?.length ?? 0) + 1),
  );
}

export function useUpdateHonor() {
  return useQueuedUpdateInList(workspaceKeys.honors.list(), updateHonor);
}

export function useArchiveHonor() {
  return useArchiveFromList(workspaceKeys.honors.list(), archiveHonor);
}

export function useRestoreHonor() {
  return useRestoreToList<Honor>(
    workspaceKeys.honors.list(),
    restoreHonor,
    [],
    insertBySortOrder,
  );
}

export function useReorderHonors() {
  return useReorderList(workspaceKeys.honors.list(), reorderHonors);
}
