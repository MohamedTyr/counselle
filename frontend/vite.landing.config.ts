import path from "path";
import { defineConfig } from "vite";
import base from "./vite.config";

/**
 * The public landing-only site: the page, Privacy and Terms, with its own
 * public directory. `input` is set outright because mergeConfig would keep
 * the app entry and ship its bundle.
 */
export default defineConfig({
  ...base,
  define: { "import.meta.env.VITE_LANDING_ONLY": JSON.stringify("true") },
  publicDir: "public-landing",
  build: {
    ...base.build,
    outDir: "dist-landing",
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        landing: path.resolve(__dirname, "landing.html"),
        privacy: path.resolve(__dirname, "privacy.html"),
        terms: path.resolve(__dirname, "terms.html"),
      },
    },
  },
});
