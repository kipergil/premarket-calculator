import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api/gemini": {
        target: "https://generativelanguage.googleapis.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gemini/, ""),
      },
      "/api/polygon": {
        target: "https://api.polygon.io",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/polygon/, ""),
      },
    },
  },
});