import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import type { WaitlistRow } from "@/features/landing/waitlist/contract";

const ENDPOINT = "/admin/api/waitlist";
const WAITLIST_KEY = ["waitlist"] as const;
const STALE_MS = 30_000;
const MAX_RETRIES = 2;

export type WaitlistData = {
  rows: WaitlistRow[];
  total: number;
  capped: boolean;
};

/** Access answered instead of the Function: the sign-in has expired. A
 * reload lets Access redirect to its login. */
export class SessionEndedError extends Error {
  constructor() {
    super("session ended");
    this.name = "SessionEndedError";
  }
}

export class WaitlistRequestError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`waitlist request failed (${status})`);
    this.name = "WaitlistRequestError";
    this.status = status;
  }
}

/**
 * X-Requested-With makes an expired Access session answer 401 instead of a
 * cross-origin redirect; redirect: "manual" turns any redirect that still
 * comes back into an opaqueredirect rather than a CORS TypeError. A 404 or
 * 5xx is never "session ended": a reload can't fix it and would loop.
 */
async function request<T>(init?: RequestInit): Promise<T> {
  const response = await fetch(ENDPOINT, {
    ...init,
    credentials: "same-origin",
    redirect: "manual",
    headers: { "X-Requested-With": "XMLHttpRequest", ...init?.headers },
  });
  if (response.type === "opaqueredirect" || response.status === 401)
    throw new SessionEndedError();
  if (!response.ok) throw new WaitlistRequestError(response.status);
  return (await response.json()) as T;
}

export function useWaitlist() {
  return useQuery({
    queryKey: WAITLIST_KEY,
    queryFn: async () => {
      const { rows, total, capped } = await request<
        WaitlistData & { ok: true }
      >();
      return { rows, total, capped } satisfies WaitlistData;
    },
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
    retry: (count, error) =>
      !(error instanceof SessionEndedError) && count < MAX_RETRIES,
  });
}

/** Pessimistic: the row leaves the cache only once D1 says it's gone. */
export function useDeleteSignup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (email: string) =>
      request<{ ok: true; deleted: number }>({
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      }),
    onSuccess: ({ deleted }, email) => {
      queryClient.setQueryData<WaitlistData>(WAITLIST_KEY, (data) =>
        data
          ? {
              ...data,
              rows: data.rows.filter((row) => row.email !== email),
              total: data.total - deleted,
            }
          : data,
      );
      void queryClient.invalidateQueries({ queryKey: WAITLIST_KEY });
    },
  });
}
