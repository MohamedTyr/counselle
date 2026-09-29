import {
  emailShape,
  UTM_KEYS,
  type ClassYear,
  type PlanId,
  type Role,
  type Side,
  type Source,
} from "./contract";

export type WaitlistEntry = {
  email: string;
  side: Side;
  source: Source;
  plan?: PlanId;
  role?: Role;
  classOf?: ClassYear;
};

/** The Pages Function beside the static build (functions/api/waitlist.ts). */
const ENDPOINT = "/api/waitlist";
/** The Google Calendar appointment schedule schools book a call on. */
const BOOKING_SCHEDULE =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ3CuTfYKkcfSXuMbpnXSDvFzTnoP8hAfkmCdBBYIo94_h1tkUJVNjfqD50h9FFZal7dEyetD3wP";
/** `gv` is Google's own embed switch; without it the page refuses a frame. */
export const BOOKING_EMBED_URL = `${BOOKING_SCHEDULE}?gv=true`;
export const BOOKING_PAGE_URL = "https://calendar.app.google/9Aaj4ivuMh1LSWWJ9";
export { CONTACT_EMAIL } from "../brand";

const PREVIEW_DELAY_MS = 700;

/** A signup the endpoint refused, with its HTTP status (403, 429, 503...). */
export class WaitlistError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Waitlist responded ${status}`);
    this.status = status;
  }
}

/** The HTTP status of a failed signup, when the endpoint answered at all. */
export function failureStatus(error: unknown): number | undefined {
  return error instanceof WaitlistError ? error.status : undefined;
}

export function emailProblem(value: string): string | null {
  if (!value) return "Enter your email address.";
  if (!emailShape(value)) return "That email doesn't look right.";
  return null;
}

/**
 * The campaign tags the visitor arrived with; the page never navigates.
 * `?ref=` (Product Hunt adds `ref=producthunt`) stands in for a missing
 * utm_source.
 */
function campaignTags(): Record<string, string> {
  const params = new URLSearchParams(location.search);
  const tags = Object.fromEntries(
    UTM_KEYS.flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value]] : [];
    }),
  );
  const ref = params.get("ref");
  return ref && !tags.utm_source ? { ...tags, utm_source: ref } : tags;
}

/** Posts one entry to the list. A repeat of the same email is an update. */
export async function submitWaitlist(entry: WaitlistEntry): Promise<void> {
  if (import.meta.env.DEV) {
    // The Vite dev server runs no Functions, so there is no list behind it.
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS));
    return;
  }
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...entry, ...campaignTags() }),
  });
  if (!response.ok) throw new WaitlistError(response.status);
}
