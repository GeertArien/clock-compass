import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
const entry = process.env.ENTRY!;
export default defineConfig({
  plugins: [svelte(), tailwindcss(), {
    name: "sizes",
    generateBundle(_o, bundle) {
      const by: Record<string, number> = {};
      for (const c of Object.values(bundle)) if (c.type === "chunk") for (const [id, m] of Object.entries(c.modules)) {
        const mm = id.match(/node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)(\/src\/[^/]+)?/);
        const key = mm ? mm[1] + (mm[1] === "@a2ui/web_core" ? (mm[2] ?? "") : "") : "app";
        by[key] = (by[key] ?? 0) + m.renderedLength;
      }
      console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${(v / 1024).toFixed(0).padStart(5)} kB  ${k}`).join("\n"));
    },
  }],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  build: { outDir: `dist-size/${entry}`, emptyOutDir: true, rollupOptions: { input: `src/spike/size/${entry}.ts`, output: { inlineDynamicImports: true, entryFileNames: "out.js" } } },
});
