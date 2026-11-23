import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "./Markdown";

const html = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown renders each construct as its element", () => {
  it.each([
    ["**bold**", /<strong[^>]*>bold<\/strong>/],
    ["*italic*", /<em>italic<\/em>/],
    ["`code`", /<code[^>]*>code<\/code>/],
    ["- a\n- b", /<ul[^>]*><li[^>]*>a<\/li><li[^>]*>b<\/li><\/ul>/],
    ["2. a\n3. b", /<ol start="2"[^>]*><li[^>]*>a<\/li><li[^>]*>b<\/li><\/ol>/],
    ["one\ntwo\n\nthree", /<p>one<br\/>two<\/p><p>three<\/p>/],
    ["# Title", /<p class="font-semibold">Title<\/p>/],
  ])("%j", (source, pattern) => {
    expect(html(source)).toMatch(pattern);
  });

  it("renders the owner's example: a list item with a bold first sentence", () => {
    expect(html("A few things stand out:\n- **Buitenkraan afsluiten is in Q1.** Frost is coming.")).toMatch(
      /<p>A few things stand out:<\/p><ul[^>]*><li[^>]*><strong[^>]*>Buitenkraan afsluiten is in Q1\.<\/strong> Frost is coming\.<\/li><\/ul>/,
    );
  });

  it("shows HTML as text: no element from the model is ever created", () => {
    const out = html('<img src=x onerror="alert(1)"> and <script>alert(1)</script>');
    expect(out).not.toMatch(/<img|<script/);
    expect(out).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(out).toContain("&lt;script&gt;");
  });

  it("does not make a link clickable", () => {
    const out = html("see [the app](https://evil.example)");
    expect(out).not.toContain("<a");
    expect(out).toContain("the app (https://evil.example)");
  });
});
