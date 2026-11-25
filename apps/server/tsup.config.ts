import { defineConfig } from "tsup";

export default defineConfig({
  // check-stored-days runs from the container's entrypoint, before the migrations (#137).
  entry: ["src/index.ts", "src/check-stored-days.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  target: "node20",
  // Bundle the workspace packages (they export TypeScript source) into the output so
  // the server image is self-contained. Keep node_modules deps external.
  noExternal: ["@clock-compass/core", "@clock-compass/assistant-catalog", "@clock-compass/mcp"],
  skipNodeModulesBundle: true,
});
