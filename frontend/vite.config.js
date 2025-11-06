import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173, // Default Vite port
    // If you want to proxy API requests to the backend during development:
    proxy: {
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
      },
    },
  },
});
