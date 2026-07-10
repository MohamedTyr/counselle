import { useMutation, useQuery } from "@tanstack/react-query"

import { handleMutationError } from "@/api/workspace/hook-utils"
import { workspaceKeys } from "@/api/workspace/keys"
import { getProfile, updateProfile } from "@/api/workspace/profile"
import type { ProfilePatch } from "@/api/workspace/types"

export function useProfile() {
  return useQuery({
    queryKey: workspaceKeys.profile.detail(),
    queryFn: getProfile,
  })
}

/** No optimistic patching: the merge-patch shape means a naive local echo of
 * the sent patch would clobber sibling fields already normalized by the
 * server (decimals, exclude_none). Invalidate-on-success is the honest
 * behavior here — see AGENTS.md lazy-but-clean guidance. */
export function useUpdateProfile() {
  return useMutation({
    mutationFn: (patch: ProfilePatch) => updateProfile(patch),
    onError: (error, _patch, _snapshot, context) => {
      handleMutationError(error, context)
    },
    onSuccess: (profile, _patch, _snapshot, context) => {
      context.client.setQueryData(workspaceKeys.profile.detail(), profile)
    },
  })
}
