import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initAnalytics } from "./analytics";
import { LandingPage } from "./LandingPage";

initAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <LandingPage />
  </StrictMode>,
);

// The explicit preview stays available to signed-in users. The public root
// retains its existing redirect into the authenticated application.
if (window.location.pathname !== "/landing.html") {
  void fetch("/v1/me", { credentials: "same-origin" })
    .then((response) => {
      if (response.ok) window.location.replace("/app/ai");
    })
    .catch(() => {
      /* Keep the public landing available when the API is unreachable. */
    });
}
