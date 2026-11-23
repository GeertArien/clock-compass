import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown, MarkdownInline } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);
/** What a reader sees: the markup's text, entities decoded. */
const textOf = (markup: string) =>
  markup
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&");

describe("Markdown renders each construct as its element", () => {
  it.each([
    ["**bold**", /<strong[^>]*>bold<\/strong>/],
    ["*italic* and _also_", /<em>italic<\/em> and <em>also<\/em>/],
    ["`code`", /<code[^>]*>code<\/code>/],
    ["- a\n- b", /<ul[^>]*>\s*<li[^>]*>a<\/li>\s*<li[^>]*>b<\/li>\s*<\/ul>/],
    ["2. a\n3. b", /<ol start="2"[^>]*>\s*<li[^>]*>a<\/li>\s*<li[^>]*>b<\/li>\s*<\/ol>/],
    ["one  \ntwo\n\nthree", /<p>one<br\/>\s*two<\/p>\s*<p>three<\/p>/],
    ["## Title", /<p class="font-semibold">Title<\/p>/],
  ])("%j", (source, pattern) => {
    expect(html(source)).toMatch(pattern);
  });

  it("renders the owner's example: a list item with a bold first sentence", () => {
    expect(
      html(
        "A few things stand out:\n- **Buitenkraan afsluiten is in Q1.** It's late November and frost is coming, so I'd do this one first, today if you can.",
      ),
    ).toMatch(/<p>A few things stand out:<\/p>\s*<ul[^>]*>\s*<li[^>]*><strong[^>]*>Buitenkraan afsluiten is in Q1\.<\/strong> It(&#x27;|')s late November/);
  });

  it("shows HTML as text: no element from the model is ever created", () => {
    for (const source of ['x <img src=x onerror="alert(1)"> y', "<script>alert(1)</script>", "a <b>not html</b> z"]) {
      const out = html(source);
      expect(out, source).not.toMatch(/<(img|script|b)[\s>]/);
      expect(textOf(out), source).toContain(source.trim());
    }
  });

  it("never makes a link clickable, and never loads an image", () => {
    const link = html("see [the app](https://evil.example)");
    expect(link).not.toContain("<a");
    expect(textOf(link)).toContain("see the app (https://evil.example)");
    const image = html("![a chart](https://tracker.example/pixel.png)");
    expect(image).not.toMatch(/<img|<link|tracker\.example/);
    expect(textOf(image)).toContain("a chart");
  });

  it("keeps a table as text (no GFM)", () => {
    expect(html("| a | b |\n|---|---|")).not.toContain("<table");
  });

  it("renders a heading's inline Markdown without a paragraph around it", () => {
    expect(renderToStaticMarkup(<MarkdownInline text="Your **big** week" />)).toBe('Your <strong class="font-semibold">big</strong> week');
  });
});

describe("while an answer streams in", () => {
  const sample =
    "Here's your week:\n\n- **Pin the garden plan.** It is *Quadrant II*.\n- Run `5k` on _Saturday_\n\n1. Call **Mum**\n2. Done";
  /** The characters a reader sees, without markers and spacing. */
  const visible = (s: string) => s.replace(/^\s*([-*+]|\d+[.)])(\s+|$)/gm, "").replace(/[*_`\s]/g, "");

  it("never throws and never loses a character, at every cut point", () => {
    for (let cut = 0; cut <= sample.length; cut++) {
      const prefix = sample.slice(0, cut);
      let out = "";
      expect(() => (out = html(prefix)), `cut ${cut}`).not.toThrow();
      expect(visible(textOf(out)), `cut ${cut}: ${JSON.stringify(prefix)}`).toBe(visible(prefix));
    }
  });

  it("shows an unclosed ** as typed until it closes", () => {
    expect(textOf(html("**Buitenkraan afsl"))).toBe("**Buitenkraan afsl");
  });
});
