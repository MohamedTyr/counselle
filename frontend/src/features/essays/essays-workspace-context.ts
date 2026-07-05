import { createContext, type Dispatch, type SetStateAction } from "react";

import type { Essay } from "@/domain/essay";

export type EssaysWorkspaceValue = {
  essays: Essay[];
  setEssays: Dispatch<SetStateAction<Essay[]>>;
};

export const EssaysWorkspaceContext =
  createContext<EssaysWorkspaceValue | null>(null);
