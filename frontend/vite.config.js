import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The backend (FastAPI) runs on :8000 and has permissive CORS, so the frontend
// talks to it directly via VITE_API_BASE (see src/api.js). No proxy required,
// which keeps the MJPEG <img> stream simple.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
