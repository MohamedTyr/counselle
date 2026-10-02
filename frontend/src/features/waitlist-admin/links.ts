// The admin page can't import the landing's analytics module (no analytics
// here), and nothing else needs the project id, so it lives here.
const POSTHOG_PROJECT_ID = 634848;

/** A join calls identify(email), so the email is the person's distinct id. */
export function posthogPersonUrl(email: string): string {
  return `https://us.posthog.com/project/${POSTHOG_PROJECT_ID}/person/${encodeURIComponent(email)}`;
}
