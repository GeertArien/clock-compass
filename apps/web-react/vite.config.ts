import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// Mirrors apps/web/vite.config.ts (same Vite major, same PWA setup and manifest)
// so the two builds compare like for like (issue #64).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // Custom service worker (precache + fonts + push) lives in src/sw.ts.
      strategies: "injectManifest",
      srcDir: "src",
      filename: "sw.ts",
      registerType: "autoUpdate",
      injectManifest: {
        globPatterns: ["**/*.{js,css,html,png,svg,webmanifest}"],
      },
      manifest: {
        name: "Clock & Compass",
        short_name: "Clock & Compass",
        description: "Put your big rocks in first — a 7 Habits productivity app.",
        start_url: "/",
        display: "standalone",
        background_color: "#f5f1e8",
        theme_color: "#f5f1e8",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    // In dev, proxy API calls to the Fastify backend.
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
