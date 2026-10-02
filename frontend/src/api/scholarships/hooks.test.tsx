import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { toast } from "sonner";

import { scholarshipKeys, useToggleSavedScholarship } from "@/api/scholarships/hooks";
import type { SavedIds } from "@/api/scholarships/types";
import { createTestQueryClient, emptyResponse, jsonResponse } from "@/test/render-app";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function setup(saved: string[]) {
  const client = createTestQueryClient();
  client.setQueryData<SavedIds>(scholarshipKeys.saved(), { ids: saved });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useToggleSavedScholarship(), { wrapper }) };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(toast.error).mockClear();
});

describe("useToggleSavedScholarship", () => {
  it("saves optimistically with a PUT", async () => {
    const fetch = vi.fn((url: string, init?: RequestInit) => {
      if (init?.method === "PUT") return Promise.resolve(emptyResponse({ status: 204 }));
      return Promise.resolve(jsonResponse({ ids: ["a"] }));
    });
    vi.stubGlobal("fetch", fetch);
    const { client, result } = setup([]);

    act(() => result.current.toggle("a"));

    await waitFor(() => expect(client.getQueryData<SavedIds>(scholarshipKeys.saved())?.ids).toEqual(["a"]));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining("/scholarships/a/save"), expect.objectContaining({ method: "PUT" })));
  });

  it("rolls back the star and toasts when the save fails", async () => {
    let failSave!: () => void;
    const fetch = vi.fn((_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        return new Promise<Response>((resolve) => {
          failSave = () => resolve(jsonResponse({ error: { message: "That scholarship was not found." } }, { status: 404 }));
        });
      }
      return Promise.resolve(jsonResponse({ ids: ["a"] }));
    });
    vi.stubGlobal("fetch", fetch);
    const { client, result } = setup(["a"]);

    act(() => result.current.toggle("a"));
    await waitFor(() => expect(client.getQueryData<SavedIds>(scholarshipKeys.saved())?.ids).toEqual([]));
    await waitFor(() => expect(failSave).toBeTypeOf("function"));
    act(() => failSave());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("That scholarship was not found."));
    await waitFor(() => expect(client.getQueryData<SavedIds>(scholarshipKeys.saved())?.ids).toEqual(["a"]));
  });
});
