import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Until cutover (issue #64) a few files in this app are copies of their
 * apps/web originals: the theme tokens, the service worker, the public assets
 * and the web-app manifest. This test fails as soon as a copy drifts, so a fix
 * on one side can't silently miss the other.
 */
const here = (p: string) => fileURLToPath(new URL(`../${p}`, import.meta.url));
const svelte = (p: string) => fileURLToPath(new URL(`../../web/${p}`, import.meta.url));
const text = (path: string) => readFileSync(path, "utf8");

/** app.css minus its leading "kept identical to apps/web" comment. */
function withoutHeader(css: string): string {
  return css.replace(/^\/\*[\s\S]*?\*\/\n/, "");
}

/** The `manifest: { … }` object literal from a vite.config.ts, by brace matching. */
function manifestBlock(config: string): string {
  const start = config.indexOf("manifest: {");
  if (start < 0) throw new Error("no manifest block");
  let depth = 0;
  for (let i = config.indexOf("{", start); i < config.length; i++) {
    if (config[i] === "{") depth++;
    else if (config[i] === "}" && --depth === 0) return config.slice(start, i + 1);
  }
  throw new Error("unterminated manifest block");
}

describe("copies of apps/web files stay identical", () => {
  it("theme tokens (src/app.css)", () => {
    expect(withoutHeader(text(here("src/app.css")))).toBe(text(svelte("src/app.css")));
  });

  it("service worker (src/sw.ts)", () => {
    expect(text(here("src/sw.ts"))).toBe(text(svelte("src/sw.ts")));
  });

  it("public assets", () => {
    const names = readdirSync(svelte("public")).sort();
    expect(readdirSync(here("public")).sort()).toEqual(names);
    for (const name of names) {
      expect(readFileSync(here(`public/${name}`)).equals(readFileSync(svelte(`public/${name}`))), name).toBe(true);
    }
  });

  it("web-app manifest in vite.config.ts", () => {
    expect(manifestBlock(text(here("vite.config.ts")))).toBe(
      manifestBlock(text(svelte("vite.config.ts"))),
    );
  });
});
