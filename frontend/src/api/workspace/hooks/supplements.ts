import {
  useMutation,
  useQuery,
  type QueryClient,
} from "@tanstack/react-query";

import { handleMutationError } from "@/api/workspace/hook-utils";
import { workspaceKeys } from "@/api/workspace/keys";
import {
  acknowledgePromptChange,
  listSupplements,
  startSupplementEssay,
} from "@/api/workspace/supplements";

export function useSupplements() {
  return useQuery({
    queryKey: workspaceKeys.supplements.all(),
    queryFn: listSupplements,
  });
}

/* Starting a supplement and clearing a prompt notice both change what the
 * Essays tab, the school page and the prompt list show, so all three refresh. */
function refreshEssaySurfaces(client: QueryClient) {
  void client.invalidateQueries({ queryKey: workspaceKeys.supplements.all() });
  void client.invalidateQueries({ queryKey: workspaceKeys.essays.all() });
  void client.invalidateQueries({ queryKey: workspaceKeys.applications.all() });
}

export function useStartSupplementEssay() {
  return useMutation({
    mutationFn: ({ applicationId, promptKey }: { applicationId: string; promptKey: string }) =>
      startSupplementEssay(applicationId, promptKey),
    onError: (error, _input, _snapshot, context) =>
      handleMutationError(error, context),
    onSettled: (_essay, _error, _input, _snapshot, context) =>
      refreshEssaySurfaces(context.client),
  });
}

export function useAcknowledgePromptChange() {
  return useMutation({
    mutationFn: acknowledgePromptChange,
    onError: (error, _input, _snapshot, context) =>
      handleMutationError(error, context),
    onSettled: (_result, _error, _input, _snapshot, context) =>
      refreshEssaySurfaces(context.client),
  });
}
