import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { AdminScholarship } from "@/api/scholarships/types";
import { todayIso } from "@/features/scholarships-admin/editor-draft";
import { authUserFixture, defaultAuthenticatedFetch, emptyResponse, jsonResponse, renderApp } from "@/test/render-app";

const ID = "11111111-1111-4111-8111-111111111111";
const PATH = `/app/admin/scholarships/${ID}`;

function admin(overrides: Partial<AdminScholarship> = {}): AdminScholarship {
  return {
    id: ID,
    created_at: "2026-09-01T00:00:00Z",
    updated_at: "2026-09-02T00:00:00Z",
    updated_by_email: "ana@acceptra.ai",
    status: "draft",
    version: 1,
    name: "Future Leaders Award",
    sponsor: "Acme Foundation",
    summary: "For students who lead.",
    apply_url: "https://acme.org/apply",
    source_url: "https://acme.org/scholarship",
    logo_url: "",
    award: { kind: "fixed", amount: 5000, min: null, max: null, renewable: false, years: null, awards_count: null },
    deadline: { kind: "rolling", date: null, opens_on: null, recurs_annually: false },
    basis: ["merit"],
    fields: [],
    eligibility: [],
    other_eligibility: [],
    requirements: { essays: [], recommendations: 0, transcript: false, financial_documents: false, interview: false },
    last_checked_on: todayIso(),
    ...overrides,
  };
}

type Call = { method: string; url: string; body: Record<string, unknown> | null };

/** A stateful fake of the admin routes. `put` decides each PUT's response. */
function adminServer(initial: AdminScholarship, put?: (body: Record<string, unknown>) => Response) {
  let record = initial;
  const calls: Call[] = [];
  const handler = (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
    if (url.includes("/v1/admin/scholarships") || url.includes("/v1/scholarships")) calls.push({ method, url, body });
    if (url.endsWith("/v1/me")) return jsonResponse({ ...authUserFixture, is_superuser: true });
    if (url.endsWith("/v1/admin/scholarships")) return jsonResponse([record]);
    if (url.endsWith(`/v1/admin/scholarships/${ID}`) && method === "GET") return jsonResponse(record);
    if (url.endsWith(`/v1/admin/scholarships/${ID}`) && method === "PUT") {
      if (put) return put(body ?? {});
      record = { ...record, ...(body as Partial<AdminScholarship>), version: record.version + 1 };
      return jsonResponse(record);
    }
    if (url.endsWith("/status")) {
      record = { ...record, status: body?.status as AdminScholarship["status"], version: record.version + 1 };
      return jsonResponse(record);
    }
    if (url.endsWith("/checked")) {
      record = { ...record, last_checked_on: todayIso(), version: record.version + 1 };
      return jsonResponse(record);
    }
    if (url.endsWith("/revisions")) return jsonResponse([]);
    if (url.endsWith("/v1/scholarships")) return jsonResponse({ items: [] });
    if (url.endsWith("/v1/scholarships/saved")) return jsonResponse({ ids: [] });
    if (url.includes("/v1/admin/") || url.includes("/v1/scholarships")) return emptyResponse();
    return defaultAuthenticatedFetch(input, init);
  };
  return {
    handler,
    calls,
    setRecord: (next: AdminScholarship) => {
      record = next;
    },
  };
}

async function nameInput() {
  return screen.findByLabelText("Name");
}

function saveBar() {
  return within(screen.getByRole("region", { name: "Unsaved changes" }));
}

function checkRow(key: string) {
  return document.querySelector(`[data-check="${key}"]`);
}

afterEach(() => vi.unstubAllGlobals());

describe("ScholarshipEditorPage", () => {
  it("keeps the draft on a 409 and replaces it only after Load their version is confirmed", async () => {
    const user = userEvent.setup();
    const server = adminServer(admin(), () =>
      jsonResponse(
        { error: { message: "Someone else changed this scholarship.", trace_id: "t", current_version: 2 } },
        { status: 409 },
      ),
    );
    renderApp(PATH, { fetchHandler: server.handler });

    const input = await nameInput();
    await user.clear(input);
    await user.type(input, "My edit");
    await user.click(saveBar().getByRole("button", { name: /^Save/ }));

    expect(await screen.findByText("Someone else changed this scholarship")).toBeInTheDocument();
    expect(input).toHaveValue("My edit");

    server.setRecord(admin({ name: "Their edit", version: 2 }));
    await user.click(screen.getByRole("button", { name: "Load their version" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Load their version" }));

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Their edit"));
    expect(screen.queryByText("Someone else changed this scholarship")).not.toBeInTheDocument();
  });

  it("disables Save and ⌘S while in conflict", async () => {
    const user = userEvent.setup();
    const server = adminServer(admin(), () =>
      jsonResponse({ error: { message: "Someone else changed this scholarship.", trace_id: "t", current_version: 2 } }, { status: 409 }),
    );
    renderApp(PATH, { fetchHandler: server.handler });

    const input = await nameInput();
    await user.type(input, "!");
    await user.click(saveBar().getByRole("button", { name: /^Save/ }));
    await screen.findByText("Someone else changed this scholarship");

    expect(saveBar().queryByRole("button", { name: /^Save/ })).not.toBeInTheDocument();
    await user.keyboard("{Control>}s{/Control}");
    expect(server.calls.filter((call) => call.method === "PUT")).toHaveLength(1);
  });

  it("marks exactly the rows a 422 names", async () => {
    const user = userEvent.setup();
    const server = adminServer(admin(), () =>
      jsonResponse(
        { error: { message: "This scholarship isn't ready to publish.", trace_id: "t", problems: ["fresh", "award"] } },
        { status: 422 },
      ),
    );
    renderApp(PATH, { fetchHandler: server.handler });

    await nameInput();
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(checkRow("fresh")).toHaveAttribute("data-ok", "false"));
    expect(checkRow("award")).toHaveAttribute("data-ok", "false");
    for (const key of ["basics", "apply_url", "rules_complete", "deadline", "source_url"]) {
      expect(checkRow(key)).toHaveAttribute("data-ok", "true");
    }
  });

  it("disables status actions while dirty, and resyncs the draft after mark-checked", async () => {
    const user = userEvent.setup();
    const server = adminServer(admin({ status: "published", last_checked_on: "2026-01-02" }));
    renderApp(PATH, { fetchHandler: server.handler });

    const input = await nameInput();
    await user.type(input, "!");
    await user.click(screen.getByRole("button", { name: "More actions" }));
    for (const name of ["Unpublish", "Mark checked today", "Archive"]) {
      expect(screen.getByRole("menuitem", { name })).toHaveAttribute("aria-disabled", "true");
    }
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Discard" }));

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Mark checked today" }));
    await waitFor(() => expect(screen.getByLabelText("Last checked")).toHaveValue(todayIso()));
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();

    await user.type(screen.getByLabelText("Name"), "?");
    await user.click(saveBar().getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(server.calls.some((call) => call.method === "PUT")).toBe(true));
    const put = server.calls.find((call) => call.method === "PUT");
    expect(put?.body).toMatchObject({ expected_version: 2, last_checked_on: todayIso(), status: "published" });
  });

  it("resyncs the draft after a status change, so the next save keeps the new status", async () => {
    const user = userEvent.setup();
    const server = adminServer(admin({ status: "published" }));
    renderApp(PATH, { fetchHandler: server.handler });

    await nameInput();
    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Unpublish" }));
    await screen.findByRole("button", { name: "Publish" });

    await user.type(screen.getByLabelText("Name"), "!");
    await user.click(saveBar().getByRole("button", { name: /^Save/ }));
    await waitFor(() => expect(server.calls.some((call) => call.method === "PUT")).toBe(true));
    expect(server.calls.find((call) => call.method === "PUT")?.body).toMatchObject({ status: "draft", expected_version: 2 });
  });

  it("publishing a clean draft leaves the editor clean and published", async () => {
    const user = userEvent.setup();
    const server = adminServer(admin());
    renderApp(PATH, { fetchHandler: server.handler });

    await nameInput();
    await user.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(server.calls.find((call) => call.method === "PUT")?.body).toMatchObject({ status: "published" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: /Publish/ })).not.toBeInTheDocument());
    expect(screen.queryByRole("region", { name: "Unsaved changes" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Published").length).toBeGreaterThan(0);
  });

  it("keeps edits typed while a save is in flight", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const server = adminServer(admin());
    const handler = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") await gate;
      return server.handler(input, init);
    };
    renderApp(PATH, { fetchHandler: handler });

    const input = await nameInput();
    await user.type(input, " A");
    await user.click(saveBar().getByRole("button", { name: /^Save/ }));
    await user.type(input, "B");
    release();

    await waitFor(() => expect(server.calls.some((call) => call.method === "PUT")).toBe(true));
    await waitFor(() => expect(input).toHaveValue("Future Leaders Award AB"));
    expect(screen.getByRole("region", { name: "Unsaved changes" })).toBeInTheDocument();
  });

  it("leaves the conflict state on Discard and shows their version", async () => {
    const user = userEvent.setup();
    const server = adminServer(admin(), () =>
      jsonResponse({ error: { message: "Someone else changed this scholarship.", trace_id: "t", current_version: 2 } }, { status: 409 }),
    );
    renderApp(PATH, { fetchHandler: server.handler });

    const input = await nameInput();
    await user.type(input, "!");
    server.setRecord(admin({ name: "Their edit", version: 2 }));
    await user.click(saveBar().getByRole("button", { name: /^Save/ }));
    await screen.findByText("Someone else changed this scholarship");
    await user.click(saveBar().getByRole("button", { name: "Discard" }));

    await waitFor(() => expect(screen.getByLabelText("Name")).toHaveValue("Their edit"));
    expect(screen.getByRole("button", { name: "Publish" })).toBeEnabled();
  });

  it("renders a never-checked record without crashing", async () => {
    const server = adminServer(admin({ last_checked_on: null }));
    renderApp(PATH, { fetchHandler: server.handler });

    expect(await screen.findByText("Never checked")).toBeInTheDocument();
    expect(screen.getAllByText(/Never checked — confirm with the sponsor/).length).toBeGreaterThan(0);
    expect(checkRow("fresh")).toHaveAttribute("data-ok", "false");
  });

  it("shows an archived record read-only with Restore as draft", async () => {
    const user = userEvent.setup();
    const server = adminServer(admin({ status: "archived" }));
    renderApp(PATH, { fetchHandler: server.handler });

    const restore = await screen.findByRole("button", { name: "Restore as draft" });
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    await user.click(restore);

    expect(await screen.findByLabelText("Name")).toHaveValue("Future Leaders Award");
    expect(server.calls.find((call) => call.url.endsWith("/status"))?.body).toEqual({ status: "draft", expected_version: 1 });
  });
});
