import path from "path";
import { defineConfig } from "vite";
import base from "./vite.config";

/**
 * The public landing-only site: the page, Privacy and Terms, and the private
 * waitlist admin at /admin/ (behind Cloudflare Access), with its own public
 * directory. `input` is set outright because mergeConfig would keep
 * the app entry and ship its bundle.
 */
export default defineConfig({
  ...base,
  define: { "import.meta.env.VITE_LANDING_ONLY": JSON.stringify("true") },
  publicDir: "public-landing",
  build: {
    ...base.build,
    outDir: "dist-landing",
    // Raster art stays a cacheable file: inlined, the marquee's four passes
    // would copy each logo into the HTML four times.
    assetsInlineLimit: (file) => (file.endsWith(".svg") ? undefined : false),
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        landing: path.resolve(__dirname, "landing.html"),
        privacy: path.resolve(__dirname, "privacy.html"),
        terms: path.resolve(__dirname, "terms.html"),
        admin: path.resolve(__dirname, "admin/index.html"),
      },
    },
  },
});
