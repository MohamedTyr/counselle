import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { toast } from "sonner";
import type { PropsWithChildren } from "react";

import { authQueryKey } from "@/app/auth";
import { useCreateUpload, useProcessBatch } from "@/api/cds-admin/hooks";
import { cdsAdminKeys } from "@/api/cds-admin/keys";
import type { ProcessResult } from "@/api/cds-admin/types";
import { createTestQueryClient, jsonResponse } from "@/test/render-app";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function wrapper(queryClient = createTestQueryClient()) {
  return function Wrapper({ children }: PropsWithChildren) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("useProcessBatch", () => {
  it("[F-03] writes the skipped list into the query cache even after the calling component unmounts", async () => {
    const queryClient = createTestQueryClient();
    const response: ProcessResult = {
      queued: [],
      skipped: [{ file_id: "file-1", reason: "duplicate PDF" }],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(jsonResponse(response))),
    );

    const { result, unmount } = renderHook(() => useProcessBatch(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate("batch-1");
    // Simulates the admin navigating away before the mutation settles
    // (F-03's exact failure scenario) -- a call-level `onSuccess` passed to
    // `mutate()` would never fire once this component is gone.
    unmount();

    await waitFor(() => {
      expect(
        queryClient.getQueryData(cdsAdminKeys.batch.queueFailures("batch-1")),
      ).toEqual(response.skipped);
    });
  });
});

describe("useCreateUpload", () => {
  it("[F-01] never toasts a row-scoped failure — the row renders it inline instead", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(new Response("upload failed", { status: 500 })),
      ),
    );

    const { result } = renderHook(() => useCreateUpload(), {
      wrapper: wrapper(),
    });

    result.current.mutate({ file: new File(["x"], "a.pdf"), batchId: "batch-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("[F-01] still redirects on 401 even with the toast silenced", async () => {
    const queryClient = createTestQueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("nope", { status: 401 }))),
    );

    const { result } = renderHook(() => useCreateUpload(), {
      wrapper: wrapper(queryClient),
    });

    result.current.mutate({ file: new File(["x"], "a.pdf"), batchId: "batch-1" });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(toast.error).not.toHaveBeenCalled();
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: authQueryKey });
  });
});
