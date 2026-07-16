import path from "path"
import tailwindcss from "@tailwindcss/vite"
import react from "@vitejs/plugin-react"
import { defineConfig } from "vitest/config"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    port: Number(process.env.VITE_DEV_PORT ?? 5173),
    fs: {
      allow: [path.resolve(__dirname, "..")],
    },
    proxy: {
      "/v1": process.env.VITE_API_PROXY_TARGET ?? "http://localhost:8000",
    },
  },
  test: {
    environment: "jsdom",
    maxWorkers: 4,
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
  },
})
