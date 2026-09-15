import { spawn } from "node:child_process";
import path from "node:path";

const host = "127.0.0.1";
const port = process.env.SCHOOL_CHANCES_FIXTURE_PORT ?? "4175";
const origin = `http://${host}:${port}`;
const routeUrl = `${origin}/dev/school-chances`;
const lazyModuleUrl =
  `${origin}/src/features/dev-school-chances/SchoolChancesGalleryPage.tsx`;
const viteBin = path.resolve("node_modules/vite/bin/vite.js");
const readinessTimeoutMs = 120_000;

const child = spawn(
  process.execPath,
  [viteBin, "--host", host, "--port", port],
  {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  },
);

let childExit;
let childError;
const childExited = new Promise((resolve) => {
  child.once("error", (error) => {
    childError = error;
  });
  child.once("exit", (code, signal) => {
    childExit = { code, signal };
    resolve(childExit);
  });
});

let stopping = false;
function stopChild(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  if (!child.killed) child.kill(signal);
}

process.once("SIGINT", () => stopChild("SIGINT"));
process.once("SIGTERM", () => stopChild("SIGTERM"));

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url, description, validate) {
  const deadline = Date.now() + readinessTimeoutMs;
  let delayMs = 25;
  let lastFailure = "no response";

  while (Date.now() < deadline) {
    if (childExit || childError) {
      throw new Error(
        `${description} cannot become ready because Vite exited` +
          (childError ? `: ${childError.message}` : "."),
      );
    }

    let response;
    try {
      response = await Promise.race([
        fetch(url, { signal: AbortSignal.timeout(1_000) }),
        childExited.then(() => null),
      ]);
    } catch (error) {
      lastFailure = error instanceof Error ? error.message : String(error);
      await wait(delayMs);
      delayMs = Math.min(delayMs * 2, 250);
      continue;
    }

    if (response === null) {
      throw new Error(
        `${description} cannot become ready because Vite exited` +
          (childError ? `: ${childError.message}` : "."),
      );
    }

    if (response.ok) {
      const body = await response.text();
      if (validate(body, response)) return;
      lastFailure = `HTTP ${response.status} returned an unexpected response`;
    } else {
      lastFailure = `HTTP ${response.status}`;
      await response.body?.cancel();
    }

    await wait(delayMs);
    delayMs = Math.min(delayMs * 2, 250);
  }

  throw new Error(`${description} timed out (${lastFailure}): ${url}`);
}

async function main() {
  try {
    await waitForHttp(routeUrl, "the chances fixture route", (body, response) =>
      response.headers.get("content-type")?.includes("text/html") &&
      body.includes("<title>"),
    );
    await waitForHttp(
      lazyModuleUrl,
      "the SchoolChancesGalleryPage lazy module",
      (body, response) =>
        response.headers.get("content-type")?.includes("javascript") &&
        body.includes("SchoolChancesGalleryPage"),
    );
  } catch (error) {
    console.error(
      `[school-chances-fixture] ${error instanceof Error ? error.message : error}`,
    );
    stopChild();
    await childExited;
    process.exitCode = 1;
    return;
  }

  await childExited;
}

await main();
