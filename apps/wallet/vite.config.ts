import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const eercSdkPath = fileURLToPath(new URL("./node_modules/@avalabs/eerc-sdk/dist/index.js", import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { global: "globalThis" },
  resolve: {
    alias: {
      "@avalabs/eerc-sdk": eercSdkPath,
    },
  },
  server: { port: 5175, proxy: { "/api": "http://localhost:8791" } },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: "./src/test/setup.ts",
    server: { deps: { inline: ["@avalabs/eerc-sdk"] } },
  },
});
