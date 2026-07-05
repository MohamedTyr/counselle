import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import type { Essay } from "@/domain/essay";
import { EssayEditorPage } from "@/features/essays/EssayEditorRoute";
import { EssaysPage } from "@/features/essays/EssaysRoute";
import { renderApp } from "@/test/render-app";

const testEssays: Essay[] = [
  {
    comments: 2,
    deadline: "Jan 1, 2027",
    id: "common",
    logoUrl: "",
    previewLines: ["A specific scene."],
    previewTitle: "Scene",
    school: "Common App",
    schoolLocation: "All schools",
    status: "Drafting",
    suggestions: 0,
    title: "Common App Personal Statement",
    type: "Personal statement",
    updatedAt: "1h ago",
    version: "v1",
    wordCount: 120,
    wordLimit: 650,
  },
  {
    comments: 1,
    deadline: "Jan 5, 2027",
    dueSoon: true,
    id: "stanford",
    logoUrl: "",
    previewLines: ["A roommate line."],
    previewTitle: "Roommate",
    school: "Stanford",
    schoolLocation: "Stanford, CA",
    status: "Needs review",
    suggestions: 3,
    title: "Stanford Roommate Note",
    type: "Supplement",
    updatedAt: "2h ago",
    version: "v2",
    wordCount: 216,
    wordLimit: 250,
  },
];

describe("EssaysPage", () => {
  it("renders the shared page header and controls", () => {
    render(<EssaysPage essays={testEssays} />);

    expect(
      screen.getByRole("heading", { name: "Essay workspace" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "New essay" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("searchbox", { name: "Search essays" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /All2/ })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: /Needs review1/ }),
    ).toBeInTheDocument();
  });

  it("filters cards by search query", async () => {
    const user = userEvent.setup();
    render(<EssaysPage essays={testEssays} />);

    await user.type(
      screen.getByRole("searchbox", { name: "Search essays" }),
      "stanford",
    );

    expect(screen.getByText("Stanford Roommate Note")).toBeInTheDocument();
    expect(
      screen.queryByText("Common App Personal Statement"),
    ).not.toBeInTheDocument();
  });

  it("filters cards by tab", async () => {
    const user = userEvent.setup();
    render(<EssaysPage essays={testEssays} />);

    await user.click(screen.getByRole("tab", { name: /Personal statement/ }));

    expect(
      screen.getByText("Common App Personal Statement"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Stanford Roommate Note"),
    ).not.toBeInTheDocument();
  });

  it("shows an empty state and clears filters", async () => {
    const user = userEvent.setup();
    render(<EssaysPage essays={testEssays} />);

    await user.type(
      screen.getByRole("searchbox", { name: "Search essays" }),
      "missing",
    );

    expect(screen.getByText("No essays found")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(
      screen.getByText("Common App Personal Statement"),
    ).toBeInTheDocument();
  });

  it("opens an essay from the primary card action", async () => {
    const user = userEvent.setup();
    const onOpenEssay = vi.fn();
    render(<EssaysPage essays={testEssays} onOpenEssay={onOpenEssay} />);

    await user.click(
      screen.getByRole("button", { name: "Open Stanford Roommate Note" }),
    );

    expect(onOpenEssay).toHaveBeenCalledWith(testEssays[1]);
  });

  it("opens the card action menu without opening the essay", async () => {
    const user = userEvent.setup();
    const onOpenEssay = vi.fn();
    render(<EssaysPage essays={testEssays} onOpenEssay={onOpenEssay} />);

    await user.click(
      screen.getByRole("button", {
        name: "Open Stanford Roommate Note actions",
      }),
    );

    expect(
      screen.getByRole("menuitem", { name: "Duplicate" }),
    ).toBeInTheDocument();
    expect(onOpenEssay).not.toHaveBeenCalled();
  });

  it("duplicates and marks essays ready through real menu actions", async () => {
    const user = userEvent.setup();
    render(<EssaysPage essays={testEssays} />);

    await user.click(
      screen.getByRole("button", {
        name: "Open Stanford Roommate Note actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    expect(screen.getByText("Stanford Roommate Note copy")).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", {
        name: "Open Stanford Roommate Note actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Ready" }));

    const cards = screen.getAllByText("Stanford Roommate Note");
    const originalCard = cards[0]!.closest("article");

    expect(originalCard).not.toBeNull();
    expect(
      within(originalCard as HTMLElement).getByText("Ready"),
    ).toBeInTheDocument();
  });

  it("opens newly created essays when requested", async () => {
    const user = userEvent.setup();
    const onOpenEssay = vi.fn();
    render(<EssaysPage essays={testEssays} onOpenEssay={onOpenEssay} />);

    await user.click(screen.getByRole("button", { name: "New essay" }));

    expect(onOpenEssay).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "Not started",
        title: "Untitled essay 3",
      }),
    );
  });
});

describe("EssayEditorPage", () => {
  it("renders selected essay editor chrome and prompt menu", async () => {
    const user = userEvent.setup();
    const onBack = vi.fn();
    render(<EssayEditorPage essay={testEssays[1]!} onBack={onBack} />);

    expect(
      screen.getByRole("heading", { name: "Stanford Roommate Note" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText((_, element) => element?.textContent === "4/250 words"),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Prompt/ }));

    expect(screen.getByText(/Stanford supplement/)).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "Back to essays" }));

    expect(onBack).toHaveBeenCalled();
  });
});

describe("essay routes", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "sidebar_state=; path=/; max-age=0";
  });

  it("renders the essay workspace route from the sidebar", async () => {
    const user = userEvent.setup();
    renderApp("/app/tasks");

    await user.click(await screen.findByRole("link", { name: "Essays" }));

    expect(
      await screen.findByRole("heading", { name: "Essay workspace" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/essays");
  });

  it("opens an essay editor route and returns to the list", async () => {
    const user = userEvent.setup();
    renderApp("/app/essays");

    await user.click(
      await screen.findByRole("button", {
        name: "Open Common App Personal Statement",
      }),
    );

    await waitFor(() =>
      expect(window.location.pathname).toBe("/app/essays/common-app-main"),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Common App Personal Statement",
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Back to essays" }));

    await waitFor(() => expect(window.location.pathname).toBe("/app/essays"));
    expect(
      await screen.findByRole("heading", { name: "Essay workspace" }),
    ).toBeInTheDocument();
  });

  it("opens a duplicated essay in the shared editor route", async () => {
    const user = userEvent.setup();
    renderApp("/app/essays");

    await user.click(
      await screen.findByRole("button", {
        name: "Open Stanford Roommate Note actions",
      }),
    );
    await user.click(screen.getByRole("menuitem", { name: "Duplicate" }));

    await waitFor(() =>
      expect(window.location.pathname).toMatch(
        /^\/app\/essays\/stanford-roommate-copy-/,
      ),
    );
    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Stanford Roommate Note copy",
      }),
    ).toBeInTheDocument();
  });

  it("resets the editor route when the essay ID changes", async () => {
    renderApp("/app/essays/common-app-main");

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Common App Personal Statement",
      }),
    ).toBeInTheDocument();

    act(() => {
      window.history.pushState(null, "", "/app/essays/stanford-roommate");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });

    expect(
      await screen.findByRole("heading", {
        level: 1,
        name: "Stanford Roommate Note",
      }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.queryByText("The Workshop After Midnight"),
      ).not.toBeInTheDocument(),
    );
  });

  it("redirects unknown essay IDs back to the essay workspace", async () => {
    renderApp("/app/essays/not-real");

    await waitFor(() => expect(window.location.pathname).toBe("/app/essays"));
    expect(
      await screen.findByRole("heading", { name: "Essay workspace" }),
    ).toBeInTheDocument();
  });
});
