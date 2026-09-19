import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "react",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./.upstream/src"),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["fake-indexeddb/auto"],
    include: ["generate.*.spec.ts"],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
