import { useQuery } from "@tanstack/react-query"

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
} from "@/api/workspace/activities"
import { tempActivity, tempHonor } from "@/api/workspace/hook-utils"
import {
  useArchiveFromList,
  useCreateInList,
  useReorderList,
  useRestoreToList,
  useUpdateInList,
} from "@/api/workspace/hooks/shared"
import { workspaceKeys } from "@/api/workspace/keys"

export function useActivities() {
  return useQuery({
    queryKey: workspaceKeys.activities.list(),
    queryFn: listActivities,
  })
}

export function useCreateActivity() {
  return useCreateInList(
    workspaceKeys.activities.list(),
    createActivity,
    (input, current) => tempActivity(input, (current?.length ?? 0) + 1),
  )
}

export function useUpdateActivity() {
  return useUpdateInList(workspaceKeys.activities.list(), updateActivity)
}

export function useArchiveActivity() {
  return useArchiveFromList(workspaceKeys.activities.list(), archiveActivity)
}

export function useRestoreActivity() {
  return useRestoreToList(workspaceKeys.activities.list(), restoreActivity)
}

export function useReorderActivities() {
  return useReorderList(workspaceKeys.activities.list(), reorderActivities)
}

export function useHonors() {
  return useQuery({ queryKey: workspaceKeys.honors.list(), queryFn: listHonors })
}

export function useCreateHonor() {
  return useCreateInList(
    workspaceKeys.honors.list(),
    createHonor,
    (input, current) => tempHonor(input, (current?.length ?? 0) + 1),
  )
}

export function useUpdateHonor() {
  return useUpdateInList(workspaceKeys.honors.list(), updateHonor)
}

export function useArchiveHonor() {
  return useArchiveFromList(workspaceKeys.honors.list(), archiveHonor)
}

export function useRestoreHonor() {
  return useRestoreToList(workspaceKeys.honors.list(), restoreHonor)
}

export function useReorderHonors() {
  return useReorderList(workspaceKeys.honors.list(), reorderHonors)
}
