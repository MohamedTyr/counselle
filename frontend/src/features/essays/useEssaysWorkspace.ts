import { useContext } from "react";

import { EssaysWorkspaceContext } from "@/features/essays/essays-workspace-context";

export function useEssaysWorkspace() {
  const value = useContext(EssaysWorkspaceContext);

  if (!value) {
    throw new Error(
      "useEssaysWorkspace must be used within EssaysWorkspaceProvider",
    );
  }

  return value;
}
