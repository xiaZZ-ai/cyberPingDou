import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5432,
    strictPort: true
  },
  preview: {
    port: 5432,
    strictPort: true
  }
});
