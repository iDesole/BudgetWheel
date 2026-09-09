import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig(({ mode }) => ({
  plugins:
    mode === "android"
      ? []
      : [
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      includeAssets: [
        "favicon.png",
        "icons/icon-192.png",
        "icons/icon-512.png",
        "widget-manifest.webmanifest",
        "fonts/outfit-400.woff2",
        "fonts/outfit-500.woff2",
        "fonts/outfit-600.woff2",
        "fonts/outfit-700.woff2",
        "fonts/outfit-800.woff2",
      ],
      workbox: {
        navigateFallback: "index.html",
      },
      manifest: {
        name: "Budget Wheel",
        short_name: "Budget Wheel",
        description: "See where every dollar goes.",
        theme_color: "#0D0C10",
        background_color: "#0D0C10",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        id: "/",
        shortcuts: [
          {
            name: "Add a purchase",
            short_name: "I purchased",
            description: "See the wheel and log a purchase without opening the full app.",
            url: "/widget",
            icons: [
              {
                src: "icons/icon-192.png",
                sizes: "192x192",
                type: "image/png",
              },
            ],
          },
        ],
        icons: [
          {
            src: "icons/icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  base: "/",
  build: {
    target: "chrome63",
    cssTarget: "chrome63",
    cssMinify: false,
    modulePreload: { polyfill: true },
  },
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    host: true,
    port: 4173,
  },
}));
