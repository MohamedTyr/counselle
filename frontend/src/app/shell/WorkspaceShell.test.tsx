import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import App from "@/App";
import { createAppRouter } from "@/app/router";

function renderApp(path = "/") {
  window.history.replaceState(null, "", path);
  return render(<App routerInstance={createAppRouter()} />);
}

function sidebarElement() {
  const sidebar = document.querySelector('[data-slot="sidebar"]');

  if (!(sidebar instanceof HTMLElement)) {
    throw new Error("Sidebar was not rendered");
  }

  return sidebar;
}

function sidebarMenuButtonFor(link: HTMLElement) {
  const button = link.closest('[data-slot="sidebar-menu-button"]');

  if (!(button instanceof HTMLElement)) {
    throw new Error("Sidebar menu button was not rendered");
  }

  return button;
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

    expect(
      await screen.findByRole("heading", { name: "Tasks" }),
    ).toBeInTheDocument();
    await waitFor(() => expect(window.location.pathname).toBe("/tasks"));
    expect(screen.getByRole("link", { name: "Counselle" })).toBeVisible();
  });

  it("navigates top-level workspace routes from the sidebar", async () => {
    const user = userEvent.setup();
    renderApp("/tasks");
    await screen.findByRole("heading", { name: "Tasks" });

    const sidebar = sidebarElement();
    await user.click(within(sidebar).getByRole("link", { name: "Schools" }));

    expect(
      await screen.findByRole("heading", { name: "Schools" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/schools");

    await user.click(within(sidebar).getByRole("link", { name: "Essays" }));

    expect(
      await screen.findByRole("heading", { name: "Essays" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/essays");
  });

  it("marks the active sidebar route", async () => {
    renderApp("/schools");

    const schoolsLink = await screen.findByRole("link", { name: "Schools" });
    const tasksLink = screen.getByRole("link", { name: "Tasks" });

    expect(sidebarMenuButtonFor(schoolsLink)).toHaveAttribute(
      "data-active",
      "true",
    );
    expect(sidebarMenuButtonFor(tasksLink)).toHaveAttribute(
      "data-active",
      "false",
    );
  });

  it("collapses the desktop sidebar", async () => {
    const user = userEvent.setup();
    renderApp("/tasks");

    const sidebar = sidebarElement();
    expect(sidebar).toHaveAttribute("data-state", "expanded");

    await user.click(
      within(sidebar).getByRole("button", { name: "Toggle Sidebar" }),
    );

    expect(sidebar).toHaveAttribute("data-state", "collapsed");
  });

  it("restores the persisted desktop sidebar state", async () => {
    const user = userEvent.setup();
    const view = renderApp("/tasks");

    const sidebar = sidebarElement();
    await user.click(
      within(sidebar).getByRole("button", { name: "Toggle Sidebar" }),
    );

    expect(document.cookie).toContain("sidebar_state=false");

    view.unmount();
    renderApp("/tasks");

    expect(sidebarElement()).toHaveAttribute("data-state", "collapsed");
    expect(screen.getByRole("link", { name: "Counselle" })).toBeInTheDocument();
  });

  it("keeps the shell mounted while route content changes", async () => {
    const user = userEvent.setup();
    renderApp("/tasks");
    await screen.findByRole("heading", { name: "Tasks" });

    const sidebar = sidebarElement();
    await user.click(
      within(sidebar).getByRole("button", { name: "Toggle Sidebar" }),
    );

    expect(sidebar).toHaveAttribute("data-state", "collapsed");

    await user.click(within(sidebar).getByRole("link", { name: "Schools" }));

    expect(
      await screen.findByRole("heading", { name: "Schools" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/schools");
    expect(sidebarElement()).toBe(sidebar);
    expect(sidebarElement()).toHaveAttribute("data-state", "collapsed");
  });

  it("does not steal editor shortcuts from editable controls", async () => {
    renderApp("/tasks");

    const sidebar = sidebarElement();
    const editor = document.createElement("input");
    document.body.append(editor);
    editor.focus();

    fireEvent.keyDown(editor, { key: "b", ctrlKey: true });

    expect(sidebar).toHaveAttribute("data-state", "expanded");

    editor.remove();
  });

  it("toggles the desktop sidebar by keyboard and ignores key repeat", async () => {
    renderApp("/tasks");

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

    renderApp("/tasks");
    await screen.findByRole("heading", { name: "Tasks" });

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    const dialogs = await screen.findAllByRole("dialog", { hidden: true });
    const mobileSidebar = dialogs.find((dialog) =>
      within(dialog).queryByRole("link", { name: "Schools" }),
    );

    expect(mobileSidebar).toBeDefined();
  });

  it("keeps mobile sidebar labels visible after desktop collapse is persisted", async () => {
    const user = userEvent.setup();
    window.innerWidth = 390;
    document.cookie = "sidebar_state=false; path=/; max-age=604800";

    renderApp("/tasks");
    await screen.findByRole("heading", { name: "Tasks" });

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    const dialogs = await screen.findAllByRole("dialog", { hidden: true });
    const mobileSidebar = dialogs.find((dialog) =>
      within(dialog).queryByText("Schools"),
    );

    expect(mobileSidebar).toBeDefined();
    expect(within(mobileSidebar!).getByText("Counselle")).toBeVisible();
    expect(within(mobileSidebar!).getByText("Schools")).toBeVisible();
  });

  it("closes the mobile sidebar sheet from the brand link", async () => {
    const user = userEvent.setup();
    window.innerWidth = 390;

    renderApp("/schools");
    await screen.findByRole("heading", { name: "Schools" });

    await user.click(screen.getByRole("button", { name: "Toggle Sidebar" }));
    const brandLinks = await screen.findAllByRole("link", {
      name: "Counselle",
    });
    await user.click(brandLinks[0]!);

    await waitFor(() => expect(window.location.pathname).toBe("/tasks"));
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { hidden: true }),
      ).not.toBeInTheDocument();
    });
  });
});
