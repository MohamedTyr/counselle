import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { axe, toHaveNoViolations } from "jest-axe";
import { MemoryRouter } from "react-router";
import { describe, expect, test, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import type { WaitlistRow } from "@/features/landing/waitlist/contract";
import { WaitlistAdminPage } from "./WaitlistAdminPage";

expect.extend(toHaveNoViolations);

// axe in jsdom catches missing names, bad ARIA and duplicate ids, not real
// contrast (DESIGN.md §18). Covers the loaded page, the empty list and the
// delete dialog.

const rows: WaitlistRow[] = [
  {
    email: "ana@school.org",
    side: "me",
    source: "plan",
    plan: "free",
    role: "student",
    class_of: "2027",
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: "launch",
    created_at: new Date(Date.now() - 36e5).toISOString(),
    updated_at: new Date(Date.now() - 36e5).toISOString(),
  },
  {
    email: "head@academy.edu",
    side: "school",
    source: "schools",
    plan: null,
    role: null,
    class_of: null,
    utm_source: null,
    utm_medium: null,
    utm_campaign: null,
    created_at: new Date(Date.now() - 864e5 * 3).toISOString(),
    updated_at: new Date(Date.now() - 864e5 * 3).toISOString(),
  },
];

function renderPage(list: WaitlistRow[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        ok: true,
        rows: list,
        total: list.length,
        capped: false,
      }),
    ),
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={["/admin/"]}>
        <TooltipProvider>
          <WaitlistAdminPage />
        </TooltipProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("waitlist admin accessibility", () => {
  test("the loaded page", async () => {
    const { container } = renderPage(rows);
    await screen.findByText("ana@school.org");
    expect(await axe(container)).toHaveNoViolations();
  });

  test("the empty list", async () => {
    const { container } = renderPage([]);
    await screen.findByText("No signups yet");
    expect(await axe(container)).toHaveNoViolations();
  });

  test("the delete dialog", async () => {
    renderPage(rows);
    const user = userEvent.setup();
    await user.click(
      await screen.findByRole("button", { name: "Actions for ana@school.org" }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: "Delete signup…" }),
    );
    const dialog = await screen.findByRole("alertdialog");
    expect(screen.getByRole("button", { name: "Cancel" })).toHaveFocus();
    expect(await axe(dialog)).toHaveNoViolations();
  });
});
