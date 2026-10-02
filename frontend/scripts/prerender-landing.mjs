// Renders the landing page to HTML inside the landing-only build, so every
// crawler gets the full page in the first response (plans/landing-seo-plan.md §4).
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist-landing");
const ssrOut = path.join(root, "node_modules/.prerender-landing");
const ROOT_DIV = '<div id="root"></div>';
const STYLESHEET =
  /<link rel="stylesheet"[^>]*href="(\/assets\/[^"]+\.css)"[^>]*>/g;
/** The face the H1 needs; the others load when their text renders. */
const PRELOAD_FONTS = [/^inter-latin-wght-normal-.*\.woff2$/];

function fail(message) {
  console.error(`prerender-landing: ${message}`);
  process.exit(1);
}

/**
 * The page's one stylesheet goes inline: it is the only render-blocking
 * request, so the first paint no longer waits on a second round trip.
 */
async function inlineStylesheet(html) {
  const links = [...html.matchAll(STYLESHEET)];
  if (links.length !== 1)
    fail(`expected one stylesheet, found ${links.length}`);
  const [tag, href] = links[0];
  const css = await readFile(path.join(dist, href), "utf8");
  await rm(path.join(dist, href));
  return html.replace(tag, () => `<style>${css}</style>`);
}

await build({
  configFile: path.join(root, "vite.landing.config.ts"),
  logLevel: "warn",
  build: {
    ssr: "src/features/landing/entry-server.tsx",
    outDir: ssrOut,
    emptyOutDir: true,
    copyPublicDir: false,
  },
});
const { render, llmsText } = await import(
  pathToFileURL(path.join(ssrOut, "entry-server.js")).href
);

const template = await readFile(path.join(dist, "landing.html"), "utf8");
if (!template.includes(ROOT_DIV)) fail(`landing.html has no ${ROOT_DIV}`);

const assets = await readdir(path.join(dist, "assets"));
const preloads = PRELOAD_FONTS.map((pattern) => {
  const file = assets.find((name) => pattern.test(name));
  if (!file) fail(`no font in dist-landing/assets matches ${pattern}`);
  return `<link rel="preload" href="/assets/${file}" as="font" type="font/woff2" crossorigin />`;
});

// React hints every eager <img> as a preload; the browser finds them in the
// HTML anyway, and they would compete with the fonts the H1 needs.
const page = render().replace(/<link rel="preload" as="image"[^>]*\/>/g, "");
const html = (await inlineStylesheet(template))
  .replace("</title>", `</title>\n    ${preloads.join("\n    ")}`)
  .replace(ROOT_DIV, `<div id="root">${page}</div>`);

const missing = [...html.matchAll(/\/assets\/[^"'\s)]+/g)]
  .map(([url]) => url)
  .filter((url) => !existsSync(path.join(dist, url)));
if (missing.length) fail(`missing assets:\n  ${missing.join("\n  ")}`);

await writeFile(path.join(dist, "index.html"), html);
await writeFile(path.join(dist, "llms.txt"), llmsText());

await rm(path.join(dist, "landing.html"));
await rm(ssrOut, { recursive: true, force: true });
console.log("prerender-landing: wrote dist-landing/index.html and llms.txt");
