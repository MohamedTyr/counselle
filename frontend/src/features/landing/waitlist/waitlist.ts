export type Side = "me" | "school";
export type Role = "student" | "parent" | "counselor";

export type WaitlistEntry = {
  email: string;
  side: Side;
  /** The button that opened the dialog: hero, nav, plan, footer or link. */
  source: string;
  plan?: string;
  role?: Role;
  classOf?: string;
};

const ENDPOINT: string | undefined = import.meta.env.VITE_WAITLIST_ENDPOINT;
/** The Google Calendar appointment schedule schools book a call on. */
const BOOKING_SCHEDULE =
  "https://calendar.google.com/calendar/appointments/schedules/AcZssZ3CuTfYKkcfSXuMbpnXSDvFzTnoP8hAfkmCdBBYIo94_h1tkUJVNjfqD50h9FFZal7dEyetD3wP";
/** `gv` is Google's own embed switch; without it the page refuses a frame. */
export const BOOKING_EMBED_URL = `${BOOKING_SCHEDULE}?gv=true`;
export const BOOKING_PAGE_URL = "https://calendar.app.google/9Aaj4ivuMh1LSWWJ9";
export { CONTACT_EMAIL } from "../brand";

const PREVIEW_DELAY_MS = 700;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign"];
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailProblem(value: string): string | null {
  if (!value) return "Enter your email address.";
  if (!EMAIL_SHAPE.test(value)) return "That email doesn't look right.";
  return null;
}

/** The campaign tags the visitor arrived with; the page never navigates. */
function campaignTags(): Record<string, string> {
  const params = new URLSearchParams(location.search);
  return Object.fromEntries(
    UTM_KEYS.flatMap((key) => {
      const value = params.get(key);
      return value ? [[key, value]] : [];
    }),
  );
}

/** Posts one entry to the list. A repeat of the same email is an update. */
export async function submitWaitlist(entry: WaitlistEntry): Promise<void> {
  if (!ENDPOINT) {
    // The dev server has no list behind it; production must be configured.
    if (!import.meta.env.DEV) throw new Error("Waitlist endpoint is not set");
    await new Promise((resolve) => setTimeout(resolve, PREVIEW_DELAY_MS));
    return;
  }
  const response = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...entry, ...campaignTags() }),
  });
  if (!response.ok) throw new Error(`Waitlist responded ${response.status}`);
}
