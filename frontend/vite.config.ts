import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  // In Docker, the frontend container talks to the API container via service name.
  const apiUrl = env.VITE_API_URL ?? "http://localhost:3001";

  return {
    plugins: [react()],
    server: {
      host: "0.0.0.0",
      port: 5173,
      proxy: {
        "/api": { target: apiUrl, changeOrigin: true },
        "/health": { target: apiUrl, changeOrigin: true },
      },
    },
    build: {
      outDir: "dist",
      sourcemap: true,
    },
    test: {
      globals: true,
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
