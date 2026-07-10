import { useMutation, useQuery } from "@tanstack/react-query"

import { handleMutationError } from "@/api/workspace/hook-utils"
import {
  archiveDocument,
  listDocuments,
  uploadDocument,
} from "@/api/workspace/documents"
import { workspaceKeys } from "@/api/workspace/keys"

export function useDocuments() {
  return useQuery({
    queryKey: workspaceKeys.documents.list(),
    queryFn: listDocuments,
  })
}

export function useUploadDocument() {
  return useMutation({
    mutationFn: uploadDocument,
    onError: (error, _input, _snapshot, context) => {
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, _input, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.documents.list(),
      })
    },
  })
}

export function useArchiveDocument() {
  return useMutation({
    mutationFn: archiveDocument,
    onError: (error, _id, _snapshot, context) => {
      handleMutationError(error, context)
    },
    onSettled: (_data, _error, _id, _snapshot, context) => {
      void context.client.invalidateQueries({
        queryKey: workspaceKeys.documents.list(),
      })
    },
  })
}
