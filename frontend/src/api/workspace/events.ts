import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { authQueryKey, useMe } from "@/app/auth";
import { fetchMe } from "@/api/http/auth";
import {
  createWorkspaceEventSource,
  type WorkspaceEventSourceFactory,
} from "@/api/workspace/event-source";
import { workspaceKeys } from "@/api/workspace/keys";
import type {
  ChangeEvent,
  ChangeOp,
  WorkspaceObjectType,
} from "@/api/workspace/types";

const objectTypes: WorkspaceObjectType[] = [
  "application",
  "task",
  "essay",
  "activity",
  "honor",
];
const changeOps: ChangeOp[] = ["created", "updated", "archived", "restored"];
const workspaceEventTypes = objectTypes.flatMap((objectType) =>
  changeOps.map((op) => `${objectType}.${op}`),
);

type UseWorkspaceEventsOptions = {
  enabled?: boolean;
};

function parseWorkspaceEvent(event: MessageEvent): ChangeEvent | null {
  try {
    return JSON.parse(event.data as string) as ChangeEvent;
  } catch {
    return null;
  }
}

export function useWorkspaceEvents(
  factory: WorkspaceEventSourceFactory = createWorkspaceEventSource,
  options: UseWorkspaceEventsOptions = {},
) {
  const enabled = options.enabled ?? true;
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!enabled) {
      return undefined;
    }

    const source = factory();
    let authCheck: Promise<void> | null = null;

    function invalidateFromChange(change: ChangeEvent) {
      switch (change.data.object_type) {
        case "application":
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.applications.list(),
          });
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.applications.detail(change.data.object_id),
          });
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.schoolSearchAll(),
          });
          break;
        case "task":
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.tasks.list(),
          });
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.applications.all(),
          });
          break;
        case "essay":
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.essays.list(),
          });
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.essays.detail(change.data.object_id),
          });
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.applications.all(),
          });
          break;
        case "activity":
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.activities.list(),
          });
          break;
        case "honor":
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.honors.list(),
          });
          break;
        default:
          // Only reachable if objectTypes gains a value with no matching
          // case above — the SSE subscription only listens for known
          // "type.op" names, so an unrecognized event never reaches here.
          // Guards against silently no-op'ing on that future drift.
          void queryClient.invalidateQueries({
            queryKey: workspaceKeys.all,
          });
          break;
      }
    }

    function handleMessage(event: MessageEvent) {
      const change = parseWorkspaceEvent(event);
      if (change) {
        invalidateFromChange(change);
      }
    }

    workspaceEventTypes.forEach((eventType) => {
      source.addEventListener(eventType, handleMessage as EventListener);
    });

    source.onerror = () => {
      if (authCheck) {
        return;
      }
      authCheck = queryClient
        .fetchQuery({ queryKey: authQueryKey, queryFn: fetchMe, staleTime: 0 })
        .then((user) => {
          if (!user) {
            queryClient.setQueryData(authQueryKey, null);
            source.close();
          }
        })
        .catch(() => {
          void queryClient.invalidateQueries({ queryKey: authQueryKey });
        })
        .finally(() => {
          authCheck = null;
        });
    };

    return () => {
      workspaceEventTypes.forEach((eventType) => {
        source.removeEventListener(eventType, handleMessage as EventListener);
      });
      source.close();
    };
  }, [enabled, factory, queryClient]);
}

export function WorkspaceEventsMount() {
  const { data: user } = useMe();
  useWorkspaceEvents(undefined, { enabled: Boolean(user) });
  return null;
}
