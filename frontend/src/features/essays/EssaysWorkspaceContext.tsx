import {
  useCallback,
  useMemo,
  useState,
  type ReactNode,
  type SetStateAction,
} from "react";

import type { Essay } from "@/domain/essay";
import { EssaysWorkspaceContext } from "@/features/essays/essays-workspace-context";
import { essays as initialEssays } from "@/fixtures/essays";

let essayWorkspaceSnapshot: Essay[] = initialEssays;

function resolveEssaysUpdate(
  current: Essay[],
  action: SetStateAction<Essay[]>,
) {
  return typeof action === "function" ? action(current) : action;
}

export function EssaysWorkspaceProvider({ children }: { children: ReactNode }) {
  const [essays, setLocalEssays] = useState<Essay[]>(essayWorkspaceSnapshot);
  const setEssays = useCallback((action: SetStateAction<Essay[]>) => {
    setLocalEssays((current) => {
      const next = resolveEssaysUpdate(current, action);
      essayWorkspaceSnapshot = next;
      return next;
    });
  }, []);
  const value = useMemo(() => ({ essays, setEssays }), [essays, setEssays]);

  return (
    <EssaysWorkspaceContext.Provider value={value}>
      {children}
    </EssaysWorkspaceContext.Provider>
  );
}
