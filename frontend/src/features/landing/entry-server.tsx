import { renderToString } from "react-dom/server";
import { LandingPage } from "./LandingPage";

/** The page as HTML, for scripts/prerender-landing.mjs. */
export const render = () => renderToString(<LandingPage />);
