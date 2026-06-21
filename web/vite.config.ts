import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev: proxy /api to the admin server. Build: emit to web/dist (served by src/server.ts).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:8788" },
  },
  build: { outDir: "dist" },
});
