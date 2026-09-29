import { StrictMode } from "react";
import { createRoot, hydrateRoot } from "react-dom/client";
import { initAnalytics } from "./analytics";
import { LandingPage } from "./LandingPage";

initAnalytics();

const root = document.getElementById("root")!;
const page = (
  <StrictMode>
    <LandingPage />
  </StrictMode>
);
// The production page arrives prerendered; the dev server serves an empty root.
if (root.hasChildNodes()) hydrateRoot(root, page);
else createRoot(root).render(page);

// The explicit preview stays available to signed-in users. The public root
// retains its existing redirect into the authenticated application, except on
// the landing-only site, which has no API behind it.
if (
  !import.meta.env.VITE_LANDING_ONLY &&
  window.location.pathname !== "/landing.html"
) {
  void fetch("/v1/me", { credentials: "same-origin" })
    .then((response) => {
      if (response.ok) window.location.replace("/app/ai");
    })
    .catch(() => {
      /* Keep the public landing available when the API is unreachable. */
    });
}
