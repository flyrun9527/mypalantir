import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/domains": "http://localhost:18000",
      "/d": "http://localhost:18000",
      "/schema": "http://localhost:18000",
      "/query": "http://localhost:18000",
      "/function": "http://localhost:18000",
      "/agent": "http://localhost:18000",
      "/audit": "http://localhost:18000",
      "/prompts": "http://localhost:18000"
    }
  }
});
