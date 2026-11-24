import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/days-migrate.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  target: "node20",
  // Bundle the workspace packages (they export TypeScript source) into the output so
  // the server image is self-contained. Keep node_modules deps external.
  noExternal: ["@clock-compass/core", "@clock-compass/assistant-catalog"],
  skipNodeModulesBundle: true,
});
