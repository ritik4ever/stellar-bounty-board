/// <reference types="vitest" />

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { visualizer } from "rollup-plugin-visualizer";

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Only generate the bundle report when running `npm run build:analyze`
    ...(mode === "analyze"
      ? [
          visualizer({
            filename: "dist/bundle-report.html",
            open: true,
            gzipSize: true,
            brotliSize: true,
            template: "treemap",
          }),
        ]
      : []),
  ],
  build: {
    rollupOptions: {
      output: {
        /**
         * Manual chunk strategy:
         *
         * 1. react-vendor  — react + react-dom are the heaviest runtime deps and
         *    change rarely, so they get a long-lived cached chunk.
         * 2. ui-vendor     — lucide-react icons + sonner toast library. Both are
         *    UI-only and update independently from app logic.
         * 3. Everything else falls into the default app chunk(s).
         */
        manualChunks(id) {
          if (id.includes("node_modules/react/") || id.includes("node_modules/react-dom/")) {
            return "react-vendor";
          }
          if (id.includes("node_modules/lucide-react/") || id.includes("node_modules/sonner/")) {
            return "ui-vendor";
          }
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: "./src/setupTests.ts",
    globals: true,
  },
  server: {
    port: 3000,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
    },
  },
}));
