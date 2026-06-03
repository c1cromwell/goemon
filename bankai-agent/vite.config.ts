import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// External agent app. Runs on :5174 (must be in the backend CORS_ORIGIN allowlist).
export default defineConfig({
  plugins: [react()],
  server: { port: 5174 },
});
