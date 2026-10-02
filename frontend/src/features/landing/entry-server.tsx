import { renderToString } from "react-dom/server";
import { LandingPage } from "./LandingPage";

/** The page as HTML, and /llms.txt, for scripts/prerender-landing.mjs. */
export const render = () => renderToString(<LandingPage />);
export { llmsText } from "./llms";
