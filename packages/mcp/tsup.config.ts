import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node20",
  sourcemap: true,
  clean: true,
  // Bundle the workspace packages (they export TypeScript source), as the
  // server does, so `node packages/mcp/dist/index.js` runs in the image (#118).
  noExternal: ["@clock-compass/core", "@clock-compass/assistant-catalog"],
  skipNodeModulesBundle: true,
});
