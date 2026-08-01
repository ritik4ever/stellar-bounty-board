/// <reference types="vitest" />
/// <reference types="vite-plugin-pwa/client" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
export default defineConfig({
    plugins: [
        react(),
        VitePWA({
            registerType: "autoUpdate",
            workbox: {
                globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
                runtimeCaching: [
                    {
                        urlPattern: /^\/api\/bounties/,
                        handler: "StaleWhileRevalidate",
                        options: {
                            cacheName: "bounties-cache",
                            expiration: {
                                maxEntries: 50,
                                maxAgeSeconds: 60 * 60 * 24,
                            },
                        },
                    },
                ],
            },
            manifest: {
                name: "Stellar Bounty Board",
                short_name: "Bounty Board",
                description: "Fund GitHub issues with on-chain escrow",
                theme_color: "#1e8f6f",
                background_color: "#f6efe3",
                display: "standalone",
                start_url: "/",
                id: "/",
                icons: [
                    {
                        src: "/icons/icon-192x192.svg",
                        sizes: "192x192",
                        type: "image/svg+xml",
                    },
                    {
                        src: "/icons/icon-512x512.svg",
                        sizes: "512x512",
                        type: "image/svg+xml",
                    },
                    {
                        src: "/icons/icon-192x192.svg",
                        sizes: "192x192",
                        type: "image/svg+xml",
                        purpose: "maskable",
                    },
                    {
                        src: "/icons/icon-512x512.svg",
                        sizes: "512x512",
                        type: "image/svg+xml",
                        purpose: "maskable",
                    },
                ],
            },
        }),
    ],
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
});
