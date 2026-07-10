import { useMutation, useQuery } from "@tanstack/react-query"

import { handleMutationError } from "@/api/workspace/hook-utils"
import { archiveMemory, listMemories } from "@/api/workspace/memories"
import { workspaceKeys } from "@/api/workspace/keys"

export function useMemories() {
  return useQuery({
    queryKey: workspaceKeys.memories.list(),
    queryFn: listMemories,
  })
}

export function useArchiveMemory() {
  return useMutation({
    mutationFn: archiveMemory,
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.memories.list(),
      })
    },
  })
}
