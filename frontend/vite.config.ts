import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [tailwindcss(), react()],
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

