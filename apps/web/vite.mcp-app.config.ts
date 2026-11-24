import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { viteSingleFile } from "vite-plugin-singlefile";

/**
 * The MCP App page (#118) as ONE self-contained HTML file: every script and
 * style inlined, so the MCP program can serve it as a `ui://` resource and the
 * host's sandbox needs no other request (vite-plugin-singlefile does the
 * inlining Vite cannot do alone). No PWA, no service worker.
 */
export default defineConfig({
  root: fileURLToPath(new URL("./mcp-app", import.meta.url)),
  plugins: [react(), tailwindcss(), viteSingleFile()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: fileURLToPath(new URL("./dist-mcp-app", import.meta.url)),
    emptyOutDir: true,
    target: "es2022",
  },
});
