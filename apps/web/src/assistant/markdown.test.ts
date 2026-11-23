import { describe, expect, it } from "vitest";
import { parseInline, parseMarkdown, plainText, type Block, type Inline } from "./markdown";

const text = (t: string): Inline => ({ type: "text", text: t });

describe("parseInline", () => {
  it.each<[string, Inline[]]>([
    ["**bold**", [{ type: "strong", children: [text("bold")] }]],
    ["*italic* and _also_", [{ type: "em", children: [text("italic")] }, text(" and "), { type: "em", children: [text("also")] }]],
    ["use `npm test` now", [text("use "), { type: "code", text: "npm test" }, text(" now")]],
    ["**bold with *em* inside**", [{ type: "strong", children: [text("bold with "), { type: "em", children: [text("em")] }, text(" inside")] }]],
    ["snake_case_name stays", [text("snake_case_name stays")]],
    ["2 * 3 * 4", [text("2 * 3 * 4")]],
    ["\\*not em\\*", [text("*not em*")]],
  ])("%s", (source, expected) => {
    expect(parseInline(source)).toEqual(expected);
  });

  it("shows HTML as text, never as markup", () => {
    for (const html of ['<img src=x onerror="alert(1)">', "<script>alert(1)</script>", "<b>bold</b>"]) {
      expect(parseInline(html)).toEqual([text(html)]);
    }
  });

  it("shows a link's text and address as plain text, and an image as typed", () => {
    expect(parseInline("see [the app](https://evil.example) now")).toEqual([text("see "), text("the app"), text(" (https://evil.example)"), text(" now")]);
    expect(parseInline("![alt](https://x/y.png)")).toEqual([text("![alt](https://x/y.png)")]);
  });

  it("shows unclosed markers as typed", () => {
    expect(parseInline("**Buitenkraan afsl")).toEqual([text("**Buitenkraan afsl")]);
    expect(parseInline("a `b")).toEqual([text("a `b")]);
    expect(parseInline("*")).toEqual([text("*")]);
  });
});

describe("parseMarkdown", () => {
  it("renders the owner's example as a paragraph and a list item with a bold first sentence", () => {
    const blocks = parseMarkdown(
      "A few things stand out:\n- **Buitenkraan afsluiten is in Q1.** It's late November and frost is coming, so I'd do this one first, today if you can.",
    );
    expect(blocks).toEqual<Block[]>([
      { type: "paragraph", lines: [[text("A few things stand out:")]] },
      {
        type: "list",
        ordered: false,
        start: 1,
        items: [
          {
            content: [
              [
                { type: "strong", children: [text("Buitenkraan afsluiten is in Q1.")] },
                text(" It's late November and frost is coming, so I'd do this one first, today if you can."),
              ],
            ],
          },
        ],
      },
    ]);
  });

  it("splits paragraphs on blank lines and keeps line breaks within one", () => {
    expect(parseMarkdown("one\ntwo\n\nthree")).toEqual([
      { type: "paragraph", lines: [[text("one")], [text("two")]] },
      { type: "paragraph", lines: [[text("three")]] },
    ]);
  });

  it("reads numbered lists with their start, one level of nesting, and continuation lines", () => {
    const [list] = parseMarkdown("3. first\n   more of the first\n4. second\n   - nested a\n   - nested b");
    expect(list).toEqual({
      type: "list",
      ordered: true,
      start: 3,
      items: [
        { content: [[text("first")], [text("more of the first")]] },
        {
          content: [[text("second")]],
          sublist: { type: "list", ordered: false, start: 1, items: [{ content: [[text("nested a")]] }, { content: [[text("nested b")]] }] },
        },
      ],
    });
  });

  it("reads a heading line, and a bullet only with a space after the marker", () => {
    expect(parseMarkdown("## This week")).toEqual([{ type: "heading", content: [text("This week")] }]);
    expect(parseMarkdown("**Bold start** of a paragraph")[0]).toMatchObject({ type: "paragraph" });
  });

  it("keeps a table as text", () => {
    expect(parseMarkdown("| a | b |\n|---|---|")).toEqual([
      { type: "paragraph", lines: [[text("| a | b |")], [text("|---|---|")]] },
    ]);
  });
});

describe("while an answer streams in", () => {
  const sample =
    "Here's your week:\n\n- **Pin the garden plan.** It is *Quadrant II*.\n- Run `5k` on _Saturday_\n  1. warm up\n\n1. Call **Mum**\n2. Done";
  /** The characters a reader sees, without markers and spacing. */
  const visible = (s: string) => s.replace(/^\s*([-*+]|\d+[.)])\s+/gm, "").replace(/[*_`\s]/g, "");

  it("never throws and never loses a character, at every cut point", () => {
    for (let cut = 0; cut <= sample.length; cut++) {
      const prefix = sample.slice(0, cut);
      expect(() => parseMarkdown(prefix), `cut ${cut}`).not.toThrow();
      expect(visible(plainText(prefix)), `cut ${cut}`).toBe(visible(prefix));
    }
  });
});

describe("plainText (the screen-reader announcement)", () => {
  it("drops the markers and keeps the words, one block per line", () => {
    expect(plainText("A few things:\n- **Frost** is coming\n- call `Mum`")).toBe("A few things:\nFrost is coming\ncall Mum");
  });
});
