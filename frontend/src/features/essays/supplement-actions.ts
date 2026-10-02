import { createContext, useContext } from "react";

import {
  useAcknowledgePromptChange,
  useStartSupplementEssay,
} from "@/api/workspace/hooks";

/* What a supplement surface can do: start an essay from a catalog prompt, and
 * clear a "the school changed this prompt" notice. One seam so every surface
 * (and every design variant of it) wires the same two actions. */
export type SupplementActions = {
  start: (applicationId: string, promptKey: string) => void;
  isStarting: (promptKey: string) => boolean;
  acknowledge: (essayId: string) => void;
  isAcknowledging: boolean;
};

/* Provide a value to override the API-backed actions, e.g. with no-ops on a
 * design gallery. */
export const SupplementActionsContext = createContext<SupplementActions | null>(null);

export function useSupplementActions(): SupplementActions {
  const override = useContext(SupplementActionsContext);
  const start = useStartSupplementEssay();
  const acknowledge = useAcknowledgePromptChange();
  if (override) return override;
  return {
    start: (applicationId, promptKey) => start.mutate({ applicationId, promptKey }),
    isStarting: (promptKey) =>
      start.isPending && start.variables?.promptKey === promptKey,
    acknowledge: (essayId) => acknowledge.mutate(essayId),
    isAcknowledging: acknowledge.isPending,
  };
}
