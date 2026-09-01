import { renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";

import { useProcessBatch } from "@/api/cds-admin/hooks";
import { cdsAdminKeys } from "@/api/cds-admin/keys";
import type { ProcessResult } from "@/api/cds-admin/types";
import { createTestQueryClient, jsonResponse } from "@/test/render-app";

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
