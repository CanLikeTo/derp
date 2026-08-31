import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const proxy = {
  "/ws": {
    target: "ws://127.0.0.1:3001",
    ws: true,
    changeOrigin: true,
    rewriteWsOrigin: false,
  },
};
export default defineConfig({
  root,
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    cors: false,
    allowedHosts: [],
    proxy,
  },
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    cors: false,
    allowedHosts: [],
    proxy,
  },
  build: { outDir: "../../dist/client", emptyOutDir: true },
});
