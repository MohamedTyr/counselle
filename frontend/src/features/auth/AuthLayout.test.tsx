import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { jsonResponse, renderApp } from "@/test/render-app";

// This notice's whole audience is signed out (plan §5.6), so every fixture
// here answers `/v1/me` as anonymous rather than falling back to the
// default authenticated fetch, which would redirect a guest route away.
function withPublicConfig(dbResetNoticeDate: string | null) {
  return (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/v1/config/public")) {
      return jsonResponse({ db_reset_notice_date: dbResetNoticeDate });
    }
    if (url.endsWith("/v1/me")) {
      return jsonResponse({ detail: "Unauthorized" }, { status: 401 });
    }
    return jsonResponse({});
  };
}

describe("AuthLayout sign-in reset notice", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows the dated notice, naming every workspace surface D9 drops, when set", async () => {
    renderApp("/login", { fetchHandler: withPublicConfig("2026-09-01") });

    const notice = await screen.findByText(
      /Counselle.s database was rebuilt on September 1, 2026\./,
    );
    expect(notice).toBeInTheDocument();
    expect(notice.textContent).toContain(
      "accounts, chats, college lists, essays, tasks, activities, honors, " +
        "student profiles and uploaded documents are all gone",
    );
    expect(notice.textContent).toContain(
      "If you had an account before then, please sign up again.",
    );
  });

  it("renders the same notice on /register (the guaranteed no-account audience)", async () => {
    renderApp("/register", { fetchHandler: withPublicConfig("2026-09-01") });

    expect(
      await screen.findByText(/Counselle.s database was rebuilt/),
    ).toBeInTheDocument();
  });

  it("renders no notice when the config carries no reset date", async () => {
    renderApp("/login", { fetchHandler: withPublicConfig(null) });

    await screen.findByLabelText("Email");
    expect(
      screen.queryByText(/Counselle.s database was rebuilt/),
    ).not.toBeInTheDocument();
  });

  it("dismisses per-browser and stays dismissed across a remount for that date", async () => {
    const user = userEvent.setup();
    const fetchHandler = withPublicConfig("2026-09-01");
    const { unmount } = renderApp("/login", { fetchHandler });

    await screen.findByText(/Counselle.s database was rebuilt/);
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(
      screen.queryByText(/Counselle.s database was rebuilt/),
    ).not.toBeInTheDocument();

    unmount();
    renderApp("/login", { fetchHandler });
    await screen.findByLabelText("Email");
    expect(
      screen.queryByText(/Counselle.s database was rebuilt/),
    ).not.toBeInTheDocument();
  });
});
