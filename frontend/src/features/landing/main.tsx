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
// The production page arrives prerendered, so it paints before hydration takes
// the main thread; the dev server serves an empty root.
if (root.hasChildNodes())
  requestAnimationFrame(() => setTimeout(() => hydrateRoot(root, page)));
else createRoot(root).render(page);

// In the app build, a signed-in visitor at the root goes straight to the app.
// The landing-only build has no API to ask, and /landing.html is the explicit
// preview, so neither checks.
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
