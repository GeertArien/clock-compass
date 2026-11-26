// @vitest-environment happy-dom
/**
 * The MCP App page is sized to its content by the host (#157): the page must
 * not inherit the app's full-screen `body { min-height: 100dvh }`, or it is
 * never shorter than the frame it started in and a small card gets an empty
 * area under it.
 *
 * happy-dom does no layout, so a frame's height cannot be measured here.
 * Instead this compiles the page's real stylesheet (page.css with the app's
 * app.css, through Tailwind, as the page build does) and checks:
 * - the body's computed min-height is 0 with that stylesheet;
 * - the cascade a browser applies: the app's 100dvh sits in a cascade layer
 *   and the page's rule is unlayered, so the page's rule wins.
 * The heights themselves were measured in Chromium (see the PR).
 */
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compile } from "tailwindcss";

const here = dirname(fileURLToPath(import.meta.url));
const modules = resolve(here, "../../node_modules");

/** The page's stylesheet as the build compiles it (no utility classes needed here). */
async function pageCss(): Promise<string> {
  const entry = resolve(here, "page.css");
  const compiler = await compile(await readFile(entry, "utf8"), {
    base: dirname(entry),
    async loadStylesheet(id, base) {
      const path =
        id === "tailwindcss"
          ? resolve(modules, "tailwindcss/index.css")
          : id === "tw-animate-css"
            ? resolve(modules, "tw-animate-css/dist/tw-animate.css")
            : resolve(base, id);
      return { path, base: dirname(path), content: await readFile(path, "utf8") };
    },
  });
  return compiler.build([]);
}

/** The unlayered top-level rules of a stylesheet (outside every @layer block). */
function unlayered(css: string): string {
  let depth = 0;
  let layered = 0;
  let out = "";
  for (let i = 0; i < css.length; i++) {
    if (layered === 0 && depth === 0 && css.startsWith("@layer", i)) {
      const brace = css.indexOf("{", i);
      const semi = css.indexOf(";", i);
      // `@layer a, b;` declares an order; only a block holds rules.
      if (semi !== -1 && semi < brace) continue;
      layered = 1;
      depth = 1;
      i = brace;
      continue;
    }
    const ch = css[i];
    if (layered) {
      if (ch === "{") depth++;
      if (ch === "}" && --depth === 0) layered = 0;
      continue;
    }
    out += ch;
  }
  return out;
}

describe("the MCP App page is as tall as its content (#157)", () => {
  it("does not keep the app's full-screen minimum height", async () => {
    const css = await pageCss();
    const style = document.createElement("style");
    style.textContent = css;
    document.head.append(style);
    expect(getComputedStyle(document.body).minHeight).toBe("0");
    style.remove();
  });

  it("wins over the app's 100dvh in a browser's cascade: that one is layered, the page's is not", async () => {
    const css = await pageCss();
    expect(css).toContain("min-height: 100dvh");
    const top = unlayered(css);
    expect(top).not.toContain("100dvh");
    expect(top).toMatch(/body\s*\{\s*min-height:\s*0;?\s*\}/);
  });
});
