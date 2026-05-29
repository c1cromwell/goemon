import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase 5A scaffold. Backend runs on :3001 (CORS_ORIGIN defaults to this origin).
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
