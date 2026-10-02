import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { renderApp } from "@/test/render-app";

function sidebarElement() {
  const sidebar = document.querySelector('[data-slot="sidebar"]');

  if (!(sidebar instanceof HTMLElement)) {
    throw new Error("Sidebar was not rendered");
  }

  return sidebar;
}

async function waitForTasksRoute() {
  await waitFor(() => expect(window.location.pathname).toBe("/app/tasks/today"));
}

async function waitForDesktopSidebar() {
  await waitFor(() => {
    expect(document.querySelector('[data-slot="sidebar"]')).toBeInstanceOf(
      HTMLElement,
    );
  });
}

describe("workspace shell", () => {
  beforeEach(() => {
    localStorage.clear();
    document.cookie = "sidebar_state=; path=/; max-age=0";
    window.history.replaceState(null, "", "/");
    window.innerWidth = 1280;
  });

  it("redirects the default route into the workspace shell", async () => {
    renderApp("/");

    await waitFor(() => expect(window.location.pathname).toBe("/app/ai"));
    expect(
      await screen.findByRole("link", { name: "Acceptra home" }),
    ).toBeVisible();
  });

  it("navigates top-level workspace routes from the sidebar", async () => {
    const user = userEvent.setup();
    renderApp("/app/tasks");
    await waitForTasksRoute();
    await waitForDesktopSidebar();

    const sidebar = sidebarElement();
    await user.click(within(sidebar).getByRole("link", { name: "Schools" }));

    expect(
      await screen.findByRole("heading", { name: "Schools" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/schools");

    await user.click(within(sidebar).getByRole("link", { name: "Essays" }));

    expect(
      await screen.findByRole("heading", { name: "Essay workspace" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/essays");
  });

  it("renders the real activities route from the sidebar", async () => {
    const user = userEvent.setup();
    renderApp("/app/tasks");
    await waitForTasksRoute();
    await waitForDesktopSidebar();

    const sidebar = sidebarElement();
    await user.click(within(sidebar).getByRole("link", { name: "Activities" }));

    expect(
      await screen.findByRole("heading", { name: "Activities" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add activity" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/app/activities");
  });

  it("marks the active sidebar route", async () => {
    renderApp("/app/schools");

    const schoolsLink = await screen.findByRole("link", { name: "Schools" });
    const tasksLink = screen.getByRole("link", { name: "Tasks" });

    expect(schoolsLink).toHaveAttribute("aria-current", "page");
    expect(tasksLink).not.toHaveAttribute("aria-current");
  });

  it("does not steal editor shortcuts from editable controls", async () => {
    renderApp("/app/tasks");
    await waitForDesktopSidebar();

    const sidebar = sidebarElement();
    const editor = document.createElement("input");
    document.body.append(editor);
    editor.focus();

    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });

    expect(sidebar).toHaveAttribute("data-state", "expanded");

    editor.remove();
  });

  it("toggles the desktop sidebar by keyboard and ignores key repeat", async () => {
    renderApp("/app/tasks");
    await waitForDesktopSidebar();

    const sidebar = sidebarElement();
    expect(sidebar).toHaveAttribute("data-state", "expanded");

    fireEvent.keyDown(window, { key: "b", ctrlKey: true });

    expect(sidebar).toHaveAttribute("data-state", "collapsed");

    fireEvent.keyDown(window, { key: "b", ctrlKey: true, repeat: true });

    expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });

  it("opens the mobile sidebar sheet", async () => {
    const user = userEvent.setup();
    window.innerWidth = 390;

    renderApp("/app/tasks");
    await waitForTasksRoute();

    await user.click(
      await screen.findByRole("button", { name: "Toggle Sidebar" }),
    );

    const dialogs = await screen.findAllByRole("dialog", { hidden: true });
    const mobileSidebar = dialogs.find((dialog) =>
      within(dialog).queryByRole("link", { name: "Schools" }),
    );

    expect(mobileSidebar).toBeDefined();
  });

  it("closes the mobile sidebar sheet from the brand link", async () => {
    const user = userEvent.setup();
    window.innerWidth = 390;

    renderApp("/app/schools");
    await screen.findByRole("heading", { name: "Schools" });

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const brandLinks = await screen.findAllByRole("link", {
      name: "Acceptra home",
    });
    await user.click(brandLinks[0]!);

    await waitFor(() => expect(window.location.pathname).toBe("/app/ai"));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { hidden: true }),
      ).not.toBeInTheDocument();
    });
  });
});
