import { QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import {
  authUserFixture,
  createTestQueryClient,
  emptyResponse,
} from "@/test/render-app";
import { ConfirmIdentity } from "./ConfirmIdentity";

it("uses email confirmation for a Google-only user even when Google is enabled", async () => {
  const queryClient = createTestQueryClient();
  queryClient.setQueryData(["config", "public"], {
    auth: { google_enabled: true },
  });
  const fetchMock = vi.fn(() => emptyResponse({ status: 202 }));
  vi.stubGlobal("fetch", fetchMock);
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ConfirmIdentity
          user={{
            ...authUserFixture,
            has_password: false,
            google_connected: true,
            reauthentication_required: true,
          }}
          onConfirmed={() => undefined}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  expect(
    screen.queryByRole("button", { name: "Confirm with Google" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Current password")).not.toBeInTheDocument();
  await userEvent
    .setup()
    .click(screen.getByRole("button", { name: "Confirm identity by email" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      "/v1/auth/reauthenticate/email",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Open it in this browser",
  );
});
