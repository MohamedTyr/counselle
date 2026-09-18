import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  cacheDir: process.env.SCHOOL_CHANCES_FIXTURE_CACHE_DIR,
  build: {
    rolldownOptions: {
      input: {
        app: path.resolve(__dirname, "index.html"),
        landing: path.resolve(__dirname, "landing.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    warmup: {
      clientFiles: [
        path.resolve(
          __dirname,
          "src/features/dev-school-chances/SchoolChancesGalleryPage.tsx",
        ),
      ],
    },
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
    proxy: {
      "/v1": process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    exclude: ["**/node_modules/**", "**/dist/**", "**/e2e/**"],
    maxWorkers: 4,
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
});
