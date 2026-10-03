import type { CaptureResult, PostHog } from "posthog-js";
import { SITE_HOST } from "./brand";
import type { Side, Source } from "./waitlist/contract";

/** The public project key; it ships in every visitor's bundle by design. */
const KEY = "phc_vpue7ekaVvNrv5kBtwFhDBJAeEKQ2YxyHpPThoNQzzcY";
/** The same-origin proxy (functions/ingest/[[path]].ts). */
const HOST = "/ingest";

/**
 * The named events the waitlist funnel is built on. Clicks, pageviews,
 * scroll depth, replays and errors come from the SDK; these are the steps
 * that must not move when the page's markup does. A join identifies the
 * visitor by email, so their earlier visits and replays carry their name.
 */
type Events = {
  waitlist_opened: { side: Side; source: Source; plan?: string };
  waitlist_joined: {
    side: Side;
    source: Source;
    plan?: string;
    email: string;
  };
  waitlist_details: {
    side: Side;
    source: Source;
    role?: string;
    class_of?: string;
  };
  waitlist_failed: {
    side: Side;
    source: Source;
    step: "join" | "details";
    /** `http` when the endpoint answered with `status`, `network` when nothing did. */
    kind: "http" | "network";
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
 * `?ref=` (Product Hunt adds `ref=producthunt`) stands in for a missing
 * utm_source, as it does for the signup stored in D1, so both count the same
 * channel.
 */
function withRefSource(event: CaptureResult | null): CaptureResult | null {
  const ref = new URLSearchParams(location.search).get("ref");
  if (event && ref && !event.properties.utm_source)
    event.properties.utm_source = ref;
  return event;
}

/** The standalone landing entry may be served by a deployment fallback. Never
 * start recording on an account route or a URL carrying an authentication token. */
function isPublicLandingLocation(): boolean {
  if (
    location.hostname !== SITE_HOST ||
    !["/", "/index.html", "/landing.html"].includes(location.pathname)
  )
    return false;
  const sensitiveKeys = new Set([
    "token",
    "code",
    "state",
    "password",
    "access_token",
    "id_token",
    "reset_token",
  ]);
  const params = new URLSearchParams(location.search);
  if ([...params.keys()].some((key) => sensitiveKeys.has(key.toLowerCase())))
    return false;
  return !/(?:token|code|password)=/i.test(location.hash);
}

/**
 * Only the production host reports, so previews, local builds and the dev
 * server never skew the funnel. Everything else is on: a first-party cookie
 * recognizes a returning visitor, every visitor gets a person profile, and
 * every visit is recorded, typed text, console and network included. The
 * privacy policy says so; keep the two in step.
 */
export function initAnalytics(): void {
  if (client || !isPublicLandingLocation()) return;
  client = afterLoadAndIdle()
    .then(() => import("posthog-js"))
    .then(({ default: posthog }) => {
      // Navigation can occur while the SDK waits for idle or downloads.
      if (!isPublicLandingLocation())
        throw new Error("Analytics location changed");
      posthog.init(KEY, {
        api_host: HOST,
        ui_host: "https://us.posthog.com",
        defaults: "2026-08-30",
        person_profiles: "always",
        persistence: "localStorage+cookie",
        session_recording: {
          maskAllInputs: false,
          recordBody: true,
          recordHeaders: true,
        },
        enable_recording_console_log: true,
        capture_exceptions: true,
        capture_heatmaps: true,
        capture_dead_clicks: true,
        capture_performance: { web_vitals: true, network_timing: true },
        disable_surveys: true,
        disable_product_tours: true,
        before_send: withRefSource,
      });
      return posthog;
    });
  // A chunk that fails to load drops analytics, never the page.
  client.catch(() => undefined);
}

/** Events whose properties also describe the person, not just the moment. */
const PERSON_EVENTS: ReadonlySet<keyof Events> = new Set([
  "waitlist_joined",
  "waitlist_details",
]);

function send<E extends keyof Events>(
  posthog: PostHog,
  event: E,
  properties: Events[E],
): void {
  if ("email" in properties)
    posthog.identify(properties.email, { email: properties.email });
  if (!PERSON_EVENTS.has(event)) {
    posthog.capture(event, properties);
    return;
  }
  const person = Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  );
  posthog.capture(event, properties, { $set: person });
}

export function track<E extends keyof Events>(
  event: E,
  properties: Events[E],
): void {
  void client
    ?.then((posthog) => send(posthog, event, properties))
    .catch(() => undefined);
}
