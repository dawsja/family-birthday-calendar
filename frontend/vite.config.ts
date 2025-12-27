import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    tailwindcss(),
    react(),
    VitePWA({
      // Auto-inject SW registration (no app code changes needed).
      injectRegister: "auto",
      registerType: "autoUpdate",
      includeAssets: [
        "pwa/icon.svg",
        "pwa/maskable.svg",
        "pwa/apple-touch-icon.svg",
        "pwa/favicon.svg"
      ],
      manifest: {
        name: "Family Birthday Calendar",
        short_name: "Birthdays",
        description: "Family birthday calendar",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        orientation: "portrait",
        icons: [
          {
            src: "/pwa/icon.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "any"
          },
          {
            src: "/pwa/maskable.svg",
            sizes: "any",
            type: "image/svg+xml",
            purpose: "maskable"
          }
        ]
      },
      workbox: {
        // Ensure SPA routes work offline (app-shell style).
        navigateFallback: "/index.html",
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webmanifest}"]
      }
    })
  ],
  preview: {
    // Allow access when running "vite preview" behind a reverse proxy.
    host: true,
    allowedHosts: ["life.domingz.com"],
    port: 5173,
    strictPort: true
  },
  server: {
    // Allow access from other devices (e.g., over Tailscale).
    host: true,
    allowedHosts: ["life.domingz.com"],
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true
      }
    }
  }
});

