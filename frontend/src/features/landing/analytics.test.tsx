import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

// Analytics is off on every host but production, so these are the only
// pre-merge evidence of what it sends.
const posthog = vi.hoisted(() => ({ init: vi.fn(), capture: vi.fn() }));
vi.mock("posthog-js", () => ({ default: posthog }));

function onHost(hostname: string) {
  vi.stubGlobal("location", { ...window.location, hostname, search: "" });
}

async function loadAnalytics() {
  const analytics = await import("./analytics");
  analytics.initAnalytics();
  return analytics;
}

async function submitFooter(email: string) {
  const { Footer } = await import("./sections/Footer");
  render(<Footer />);
  fireEvent.change(screen.getByPlaceholderText("Your email address"), {
    target: { value: email },
  });
  fireEvent.click(screen.getByRole("button", { name: "Join the waitlist" }));
}

beforeEach(() => {
  vi.resetModules();
  posthog.init.mockClear();
  posthog.capture.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

it.each(["localhost", "acceptra.pages.dev"])(
  "never starts on %s",
  async (hostname) => {
    onHost(hostname);
    await loadAnalytics();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(posthog.init).not.toHaveBeenCalled();
  },
);

it("starts on acceptra.ai through the proxy, storing and recording nothing", async () => {
  onHost("acceptra.ai");
  await loadAnalytics();
  await waitFor(() => expect(posthog.init).toHaveBeenCalledOnce());
  expect(posthog.init.mock.calls[0][1]).toMatchObject({
    api_host: "/ingest",
    persistence: "memory",
    disable_session_recording: true,
  });
});

it("tracks a footer signup", async () => {
  onHost("acceptra.ai");
  await loadAnalytics();
  await submitFooter("a@b.co");
  await waitFor(() =>
    expect(posthog.capture).toHaveBeenCalledWith("waitlist_joined", {
      side: "me",
      source: "footer",
    }),
  );
});

it("reports a failed signup with its status and never the email", async () => {
  onHost("acceptra.ai");
  vi.stubEnv("DEV", false);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 503 })),
  );
  await loadAnalytics();
  await submitFooter("a@b.co");
  await waitFor(() =>
    expect(posthog.capture).toHaveBeenCalledWith("waitlist_failed", {
      side: "me",
      source: "footer",
      step: "join",
      kind: "http",
      status: 503,
    }),
  );
  for (const [, properties] of posthog.capture.mock.calls)
    expect(properties).not.toHaveProperty("email");
});
