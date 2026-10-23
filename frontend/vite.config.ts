import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// /api is proxied to Express so the session cookie is first-party and no CORS is needed in dev.
const backend = process.env.VITE_API_PROXY ?? "http://localhost:4000";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: backend, changeOrigin: false },
      // Bull Board (live queue dashboard)
      "/admin": { target: backend, changeOrigin: false },
    },
  },
});
