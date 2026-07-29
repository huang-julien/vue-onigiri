// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { vHtml } from "../src/runtime/with-directive";
import { VServerComponentType } from "../src/runtime/shared";

/** Count via the public vHtml transform: it emits [StaticHtml, html, count]. */
const count = (html: string): number => {
  const node = (vHtml.transformOnigiri as any)(
    [VServerComponentType.Element, "div", undefined, undefined],
    { value: html, modifiers: {} },
  );
  return node[3][0][2];
};

/** What the browser's fragment parse actually produces. */
const domCount = (html: string): number => {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div.childNodes.length;
};

const CASES: string[] = [
  "<p>a</p><p>b</p>",
  "<p>a</p> <p>b</p>",
  "<p>a</p>\n",
  "  <p>a</p>",
  "text only",
  "a<b>c</b>",
  "<ul><li>x</li><li>y</li></ul>",
  "<br><img src=\"x\">",
  "<div data-x=\"a>b\">in</div>after",
  "<style>a>b{color:red}</style>",
  // NOT in this list: "<script>if(a<b){}</script><p>x</p>" — happy-dom mis-parses
  // it to a single empty <script> where real browsers produce [script, p].
  "<textarea><p>not a tag</p></textarea>",
  "<!-- c --><p>x</p>",
  "<h1>title</h1>text<h2>sub</h2>",
];

describe("countHtmlRootNodes (via vHtml)", () => {
  it.each(CASES)("matches the DOM parse for %j", (html) => {
    expect(count(html)).toBe(domCount(html));
  });

  it("counts whitespace between root elements as a text node", () => {
    expect(count("<p>a</p> <p>b</p>")).toBe(3);
  });

  it("is not fooled by > inside quoted attributes", () => {
    expect(count("<div data-x=\"a>b\">in</div>after")).toBe(2);
  });

  it("treats rawtext content as text, not markup (per spec; happy-dom diverges here)", () => {
    expect(count("<script>if(a<b){}</script><p>x</p>")).toBe(2);
  });

  it("handles self-closing foreign elements", () => {
    expect(count("<svg><circle/></svg><p>x</p>")).toBe(2);
  });

  it("survives unterminated markup without hanging", () => {
    expect(count("<div class=\"x")).toBe(1);
    expect(count("<!-- never closed")).toBe(1);
  });
});
