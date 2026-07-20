export type WorkspaceEventSource = Pick<
  EventSource,
  "addEventListener" | "close" | "removeEventListener"
> & {
  onerror: ((event: Event) => void) | null;
};

export type WorkspaceEventSourceFactory = (
  url?: string,
) => WorkspaceEventSource;

export function createWorkspaceEventSource(
  url = "/v1/workspace/events",
): WorkspaceEventSource {
  return new EventSource(url, { withCredentials: true });
}
