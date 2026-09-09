/**
 * Typed client + React Query hooks for the school-data admin dashboard
 * (`/app/admin/facts`, plan §5.5, D12): `GET /v1/admin/facts/status`,
 * `GET /v1/admin/facts/unmapped`, `POST /v1/admin/facts/passes`.
 *
 * Types mirror `app/facts/models.py::FactsStatusResponse` (that shape —
 * not redesigned here) and `api/routes/admin_facts.py`'s two local response
 * models. One file, matching the surface's size: this is a three-endpoint,
 * one-screen admin feature, not a multi-file API module like `cds-admin`.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
} from "@tanstack/react-query";

import { requestJson, requestVoid } from "@/api/http/client";

export type TabName =
  | "overview"
  | "admission"
  | "money-matters"
  | "academics"
  | "campus-life"
  | "students";

export type CrawlStatus = "running" | "succeeded" | "partial" | "failed" | "aborted";

export type CrawlRunSummary = {
  id: number;
  started_at: string;
  finished_at: string | null;
  duration_s: number | null;
  status: CrawlStatus;
  error_code: string | null;
  error_message: string | null;
  build_id: string | null;
  build_id_rotations: number;
  schools_seen: number;
  pages_fetched: number;
  pages_changed: number;
  pages_failed: number;
  facts_changed: number;
  unmapped_label_count: number;
};

export type TabFailure = {
  tab: TabName;
  status: string;
  count: number;
};

export type UnmappedLabelSample = {
  source_path: string;
  label: string;
  schools: number;
};

export type CoverageCounts = {
  sitemap_slugs: number | null;
  crosswalk_matched: number;
  crosswalk_unmatched: number;
  schools_total: number;
  schools_with_facts: number;
};

export type FactsStatus = {
  last_run: CrawlRunSummary | null;
  next_run_at: string | null;
  worker_enabled: boolean;
  queued_or_running: boolean;
  coverage: CoverageCounts;
  tab_failures: TabFailure[];
  unmapped_labels: UnmappedLabelSample[];
  unmapped_labels_truncated: boolean;
  history: CrawlRunSummary[];
};

export type UnmappedLabelItem = {
  source_path: string;
  label: string;
  school_count: number;
};

export type UnmappedLabelsPage = {
  items: UnmappedLabelItem[];
  total: number;
};

export function getFactsStatus() {
  return requestJson<FactsStatus>("/admin/facts/status");
}

export function getUnmappedLabels(page: number) {
  return requestJson<UnmappedLabelsPage>(`/admin/facts/unmapped?page=${page}`);
}

export function enqueueFactsPass() {
  return requestVoid("/admin/facts/passes", { method: "POST" });
}

export const adminFactsKeys = {
  all: ["admin-facts"] as const,
  status: () => [...adminFactsKeys.all, "status"] as const,
  unmapped: (page: number) => [...adminFactsKeys.all, "unmapped", page] as const,
};

/** Polls only while the last-seen run is `running` (DESIGN.md §1.8's
 * self-cancelling `refetchInterval`) — a dashboard for a ~daily job has no
 * business polling every 30s forever once a pass has settled. */
const FACTS_STATUS_POLL_MS = 30_000;

function pollWhileRunning(query: Query<FactsStatus, unknown, FactsStatus>): number | false {
  return query.state.data?.last_run?.status === "running" ? FACTS_STATUS_POLL_MS : false;
}

export function useFactsStatus() {
  return useQuery({
    queryKey: adminFactsKeys.status(),
    queryFn: getFactsStatus,
    refetchInterval: pollWhileRunning,
    staleTime: FACTS_STATUS_POLL_MS,
  });
}

export function useUnmappedLabels(page: number, enabled: boolean) {
  return useQuery({
    queryKey: adminFactsKeys.unmapped(page),
    queryFn: () => getUnmappedLabels(page),
    enabled,
  });
}

export function useEnqueueFactsPass() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: enqueueFactsPass,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: adminFactsKeys.status() });
    },
  });
}
