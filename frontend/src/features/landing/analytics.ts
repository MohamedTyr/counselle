import type { PostHog } from "posthog-js";
import { SITE_HOST } from "./brand";
import type { Side, Source } from "./waitlist/contract";

/** The public project key; it ships in every visitor's bundle by design. */
const KEY = "phc_vpue7ekaVvNrv5kBtwFhDBJAeEKQ2YxyHpPThoNQzzcY";
/** The same-origin proxy (functions/ingest/[[path]].ts). */
const HOST = "/ingest";

/**
 * The named events the waitlist funnel is built on. Clicks, pageviews and
 * scroll depth come from autocapture; these are the steps that must not move
 * when the page's markup does. None of them ever carries the email.
 */
type Events = {
  waitlist_opened: { side: Side; source: Source; plan?: string };
  waitlist_joined: { side: Side; source: Source; plan?: string };
  waitlist_details: { role?: string; class_of?: string };
  waitlist_failed: {
    side: Side;
    source: Source;
    step: "join" | "details";
    status?: number;
  };
};

/** Upper bound on waiting for an idle moment after the page has loaded. */
const IDLE_TIMEOUT_MS = 3000;

/** Loaded once the page is loaded and idle, so the SDK never competes with it. */
let client: Promise<PostHog> | null = null;

/** Resolves once the page has loaded and the main thread is idle. */
export function afterLoadAndIdle(): Promise<void> {
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

/**
 * Only the production host reports, so previews, local builds and the dev
 * server never skew the funnel. Nothing is stored on the device and nothing
 * is recorded, whatever the dashboard says: the privacy policy depends on it.
 */
export function initAnalytics(): void {
  if (client || location.hostname !== SITE_HOST) return;
  client = afterLoadAndIdle()
    .then(() => import("posthog-js"))
    .then(({ default: posthog }) => {
      posthog.init(KEY, {
        api_host: HOST,
        ui_host: "https://us.posthog.com",
        defaults: "2026-08-30",
        person_profiles: "identified_only",
        persistence: "memory",
        disable_session_recording: true,
        // Should replay ever be turned on, it still never records the
        // waitlist POST, whose body is the email.
        session_recording: { recordBody: false, recordHeaders: false },
        disable_surveys: true,
        disable_product_tours: true,
      });
      return posthog;
    });
  // A chunk that fails to load drops analytics, never the page.
  client.catch(() => undefined);
}

export function track<E extends keyof Events>(
  event: E,
  properties: Events[E],
): void {
  void client
    ?.then((posthog) => posthog.capture(event, properties))
    .catch(() => undefined);
}
