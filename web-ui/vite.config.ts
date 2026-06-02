import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Static, read-only observability UI. `public/config.js` is copied verbatim to
// the build output and regenerated from env at container start, so the UI can be
// pointed at external Prometheus/Loki/Vault/control-plane WITHOUT a rebuild.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, host: true },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
