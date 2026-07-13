import { fireEvent, screen } from "@testing-library/react";

import {
  defaultAuthenticatedFetch,
  emptyResponse,
  jsonResponse,
  renderApp,
} from "@/test/render-app";
import type { Document, Memory, Profile } from "@/api/workspace/types";

const profileFixture: Profile = {
  basics: { preferred_name: "Sam" },
};

const documentFixture: Document = {
  id: "60000000-0000-4000-8000-000000000001",
  user_id: "00000000-0000-4000-8000-000000000001",
  title: "Fall transcript",
  doc_type: "transcript",
  filename: "transcript.pdf",
  mime: "application/pdf",
  size_bytes: 1024,
  text_status: "failed",
  summary: null,
  created_at: "2026-07-01T12:00:00Z",
  archived_at: null,
};

const memoryFixture: Memory = {
  id: "70000000-0000-4000-8000-000000000001",
  user_id: "00000000-0000-4000-8000-000000000001",
  content: "Prefers small liberal arts colleges.",
  created_at: "2026-07-01T12:00:00Z",
  updated_at: "2026-07-01T12:00:00Z",
  archived_at: null,
};

function profileFetchHandler(input: RequestInfo | URL, init?: RequestInit) {
  const url = String(input);
  if (url.endsWith("/v1/profile")) {
    if (init?.method === "PATCH") {
      return jsonResponse(profileFixture);
    }
    return jsonResponse(profileFixture);
  }
  if (url.endsWith("/v1/documents")) {
    return jsonResponse([documentFixture]);
  }
  if (url.includes("/v1/documents/") && init?.method === "DELETE") {
    return emptyResponse();
  }
  if (url.endsWith("/v1/memories")) {
    return jsonResponse([memoryFixture]);
  }
  if (url.includes("/v1/memories/") && init?.method === "DELETE") {
    return emptyResponse();
  }
  return defaultAuthenticatedFetch(input, init);
}

describe("ProfileRoute", () => {
  it("renders the profile page with sections, documents, and memories", async () => {
    renderApp("/app/profile", { fetchHandler: profileFetchHandler });

    expect(
      await screen.findByRole("heading", { name: "Profile" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole("heading", { name: "Basics" }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Documents" }));
    expect(
      screen.getByRole("heading", { name: "Documents" }),
    ).toBeInTheDocument();

    expect(await screen.findByText("Fall transcript")).toBeInTheDocument();
    expect(screen.getByText("Couldn't read")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Memory" }));
    expect(
      screen.getByRole("heading", { name: "What Counselle remembers" }),
    ).toBeInTheDocument();
    expect(
      await screen.findByText("Prefers small liberal arts colleges."),
    ).toBeInTheDocument();
  });
});
