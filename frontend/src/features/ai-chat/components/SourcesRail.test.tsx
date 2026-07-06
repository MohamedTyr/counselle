import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

import type { MessageSourcesPayload } from "./MessageSources";
import { SourcesRail } from "./SourcesRail";

function payload(overrides: Partial<MessageSourcesPayload> = {}): MessageSourcesPayload {
  return {
    sources: [
      {
        index: 1,
        citation: { source: "web", tier: "official", vintage: "2026", url: "https://example.com/aid" },
        label: "Example",
        snippet: "Aid overview",
      },
    ],
    dbUsed: true,
    dbSchools: ["Harvard University"],
    ...overrides,
  };
}

describe("SourcesRail", () => {
  test("renders nothing when there is no open payload", () => {
    const { container } = render(
      <SourcesRail isMobile={false} onClose={vi.fn()} payload={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  test("desktop rail: shows the source count, focuses the heading, and closes via the close button", async () => {
    const onClose = vi.fn();
    render(<SourcesRail isMobile={false} onClose={onClose} payload={payload()} />);

    const heading = await screen.findByRole("heading", { name: "2 sources" });
    expect(heading).toHaveFocus();
    expect(screen.getByText("Counselle data")).toBeInTheDocument();
    expect(screen.getByText("Harvard University")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close sources" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Esc closes the rail", () => {
    const onClose = vi.fn();
    render(<SourcesRail isMobile={false} onClose={onClose} payload={payload()} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("mobile: renders as a sheet with the same content", async () => {
    render(<SourcesRail isMobile onClose={vi.fn()} payload={payload()} />);
    expect(await screen.findByRole("heading", { name: "2 sources" })).toBeInTheDocument();
  });

  test("singular count reads '1 source'", async () => {
    render(
      <SourcesRail
        isMobile={false}
        onClose={vi.fn()}
        payload={payload({ dbUsed: false })}
      />,
    );
    expect(await screen.findByRole("heading", { name: "1 source" })).toBeInTheDocument();
  });

  test("focuses and highlights the active source row", async () => {
    render(
      <SourcesRail
        isMobile={false}
        onClose={vi.fn()}
        payload={payload({ activeIndex: 1 })}
      />,
    );

    const row = document.getElementById("source-row-1");
    await screen.findByRole("heading", { name: "2 sources" });
    expect(row).toHaveFocus();
    expect(row).toHaveAttribute("data-active", "true");
  });

  test("renders unsafe source urls as inert text, not links", async () => {
    render(
      <SourcesRail
        isMobile={false}
        onClose={vi.fn()}
        payload={payload({
          dbUsed: false,
          sources: [
            {
              index: 1,
              citation: {
                source: "web",
                tier: "official",
                vintage: "2026",
                url: "javascript:alert(1)",
              },
              label: "Unsafe",
              snippet: "Unsafe source",
            },
          ],
        })}
      />,
    );

    expect(await screen.findByText("Source")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  test("orders sources by trust rank, not payload order", async () => {
    render(
      <SourcesRail
        isMobile={false}
        onClose={vi.fn()}
        payload={payload({
          dbUsed: false,
          sources: [
            {
              index: 3,
              citation: {
                source: "reddit",
                tier: "community",
                vintage: "2026",
                url: "https://reddit.com/r/ApplyingToCollege/comments/1",
              },
              label: "Reddit",
            },
            {
              index: 1,
              citation: {
                source: "edu",
                tier: "official",
                vintage: "2026",
                url: "https://admissions.example.edu",
              },
              label: "Official",
            },
            {
              index: 2,
              citation: {
                source: "web",
                tier: "community",
                vintage: "2026",
                url: "https://example.com",
              },
              label: "Web",
            },
          ],
        })}
      />,
    );

    await screen.findByRole("heading", { name: "3 sources" });
    const rows = Array.from(document.querySelectorAll("[id^='source-row-']"));
    expect(rows.map((row) => row.id)).toEqual([
      "source-row-1",
      "source-row-2",
      "source-row-3",
    ]);
  });
});
