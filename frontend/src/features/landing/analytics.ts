import type { PostHog } from "posthog-js";

const KEY: string | undefined = import.meta.env.VITE_POSTHOG_KEY;
/** Point this at a same-origin proxy path once the host has one. */
const HOST: string =
  import.meta.env.VITE_POSTHOG_HOST ?? "https://us.i.posthog.com";

/**
 * The named events the waitlist funnel is built on. Clicks, pageviews and
 * scroll depth come from autocapture; these are the steps that must not move
 * when the page's markup does. None of them ever carries the email.
 */
type Events = {
  waitlist_opened: { side: string; source: string; plan?: string };
  waitlist_joined: { side: string; source: string; plan?: string };
  waitlist_details: { role?: string; class_of?: string };
};

/** Upper bound on waiting for an idle moment after the page has loaded. */
const IDLE_TIMEOUT_MS = 3000;

/** Loaded once the page is loaded and idle, so the SDK never competes with it. */
let client: Promise<PostHog> | null = null;

function afterLoadAndIdle(): Promise<void> {
  return new Promise((resolve) => {
    const idle = () => {
      if ("requestIdleCallback" in window)
        requestIdleCallback(() => resolve(), { timeout: IDLE_TIMEOUT_MS });
      else setTimeout(resolve, 0);
    };
    if (document.readyState === "complete") idle();
    else window.addEventListener("load", idle, { once: true });
  });
}

/** The dev server never reports, so local clicking never skews the funnel. */
export function initAnalytics(): void {
  if (!KEY || import.meta.env.DEV || client) return;
  const key = KEY;
  client = afterLoadAndIdle()
    .then(() => import("posthog-js"))
    .then(({ default: posthog }) => {
      posthog.init(key, {
        api_host: HOST,
        ui_host: "https://us.posthog.com",
        defaults: "2026-08-30",
        person_profiles: "identified_only",
      });
      return posthog;
    });
}

export function track<E extends keyof Events>(
  event: E,
  properties: Events[E],
): void {
  void client?.then((posthog) => posthog.capture(event, properties));
}
