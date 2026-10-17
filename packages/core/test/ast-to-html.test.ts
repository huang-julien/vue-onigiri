import { describe, expect, it, vi } from "vitest";
import { type Component, type VNode } from "vue";
import { renderToString } from "@vue/server-renderer";
import { astToHtml, renderOnigiriWithMarkers } from "../src/runtime/ast-to-html";
import { renderOnigiri } from "../src/runtime/deserialize";
import { serializeComponent } from "../src/runtime/serialize";
import { VServerComponentType, type VServerComponent } from "@vue-onigiri/shared";
import ElementsOnly from "./fixtures/components/ElementsOnly.vue";
import IslandSlotChildren from "./fixtures/components/IslandSlotChildren.vue";
import LoadComponent from "./fixtures/components/LoadComponent.vue";
import SlotToCounter from "./fixtures/components/SlotToCounter.vue";
import WithSuspense from "./fixtures/components/WithSuspense.vue";

const T = VServerComponentType;

const AST_TO_HTML_CASES: {
  name: string;
  input: VServerComponent | VServerComponent[] | string | null | undefined;
  expected: string;
}[] = [
  {
    name: "class and style objects",
    input: [
      T.Element,
      "div",
      { class: ["one", { two: true, gone: false }], style: { color: "red", marginTop: "1px" } },
      "x",
    ],
    expected: `<div class="one two" style="color:red;margin-top:1px;">x</div>`,
  },
  {
    name: "boolean and unsafe attributes",
    input: [T.Element, "button", { disabled: true, checked: false, 'bad"name': "x" }, "x"],
    expected: `<button disabled>x</button>`,
  },
  {
    name: "key ref and listeners",
    input: [T.Element, "div", { id: "x", key: "k", ref: "r", onClick: "ignored" }, "body"],
    expected: `<div id="x">body</div>`,
  },
  {
    name: "void tag",
    input: [T.Element, "input", { disabled: true, value: "x" }, "ignored"],
    expected: `<input disabled value="x">`,
  },
  {
    name: "text escaping",
    input: [T.Element, "p", undefined, [[T.Text, "<>&\"'"]]],
    expected: `<p>&lt;&gt;&amp;&quot;&#39;</p>`,
  },
  {
    name: "comment escaping",
    input: [T.Comment, "a-->b--!>c"],
    expected: `<!--abc-->`,
  },
  {
    name: "static html",
    input: [T.StaticHtml, "<span>raw</span><!--raw-->", 2],
    expected: `<span>raw</span><!--raw-->`,
  },
  {
    name: "nested fragment",
    input: [
      T.Fragment,
      [
        [T.Text, "a"],
        [T.Fragment, [[T.Element, "b", undefined, "c"]]],
      ],
    ],
    expected: `a<b>c</b>`,
  },
  {
    name: "null child",
    input: [T.Element, "div", undefined, [null] as unknown as VServerComponent[]],
    expected: `<div><!----></div>`,
  },
  {
    name: "innerHTML prop",
    input: [T.Element, "div", { innerHTML: "<span>raw</span>" }, [[T.Text, "ignored"]]],
    expected: `<div><span>raw</span></div>`,
  },
  {
    name: "textContent prop",
    input: [T.Element, "div", { textContent: "<span>text</span>" }, [[T.Text, "ignored"]]],
    expected: `<div>&lt;span&gt;text&lt;/span&gt;</div>`,
  },
  {
    name: "textarea value",
    input: [T.Element, "textarea", { value: "<hello>" }, undefined],
    expected: `<textarea>&lt;hello&gt;</textarea>`,
  },
  {
    name: "string children",
    input: [T.Element, "p", undefined, "a < b"],
    expected: `<p>a &lt; b</p>`,
  },
  {
    name: "top-level null",
    input: null,
    expected: `<!---->`,
  },
  {
    name: "top-level undefined",
    input: undefined,
    expected: `<!---->`,
  },
  {
    name: "suspense without fallback",
    input: [T.Suspense, [[T.Text, "ready"]]],
    expected: `ready`,
  },
];

const AST_TO_HTML_ERROR_CASES: { name: string; input: VServerComponent }[] = [
  {
    name: "component",
    input: [T.Component, undefined, "/test/fixtures/components/Counter.vue"],
  },
  {
    name: "teleport",
    input: [T.Teleport, "#target", undefined, [[T.Text, "x"]]],
  },
  {
    name: "suspense fallback",
    input: [T.Suspense, [[T.Text, "ready"]], [[T.Text, "loading"]]],
  },
];

const RUN_CASES: { name: string; input: VServerComponent; expected: unknown }[] = [
  {
    name: "adjacent text tuples and empty text collapse to one DOM text node",
    input: [
      T.Fragment,
      [
        [T.Text, "a"],
        [T.Text, ""],
        [T.Text, "b"],
      ],
    ],
    expected: [{ html: "ab", staticCount: 1 }],
  },
  {
    name: "text adjacent to StaticHtml uses parsed root count",
    input: [
      T.Fragment,
      [
        [T.Text, "a"],
        [T.StaticHtml, "b<b>c</b>", 2],
      ],
    ],
    expected: [{ html: "ab<b>c</b>", staticCount: 2 }],
  },
  {
    name: "StaticHtml adjacent to text uses parsed root count",
    input: [
      T.Fragment,
      [
        [T.StaticHtml, "<b>a</b>b", 2],
        [T.Text, "c"],
      ],
    ],
    expected: [{ html: "<b>a</b>bc", staticCount: 2 }],
  },
  {
    name: "leading and trailing root comments in StaticHtml split from static runs",
    input: [T.Fragment, [[T.StaticHtml, "<!--lead--><span>x</span><!--tail-->", 3]]],
    expected: [
      { comment: "lead" },
      { html: "<span>x</span>", staticCount: 1 },
      { comment: "tail" },
    ],
  },
  {
    name: "root comments between StaticHtml runs split from static runs",
    input: [T.Fragment, [[T.StaticHtml, "<i>a</i><!--mid--><b>b</b>", 3]]],
    expected: [
      { html: "<i>a</i>", staticCount: 1 },
      { comment: "mid" },
      { html: "<b>b</b>", staticCount: 1 },
    ],
  },
  {
    name: "comments split static runs",
    input: [
      T.Fragment,
      [
        [T.Text, "a"],
        [T.Comment, "split"],
        [T.Text, "b"],
      ],
    ],
    expected: [{ html: "a", staticCount: 1 }, { comment: "split" }, { html: "b", staticCount: 1 }],
  },
  {
    name: "null children split static runs as empty comments",
    input: [T.Fragment, [[T.Text, "a"], null, [T.Text, "b"]] as unknown as VServerComponent[]],
    expected: [{ html: "a", staticCount: 1 }, { comment: "" }, { html: "b", staticCount: 1 }],
  },
];

const PARITY_CASES: { name: string; component: Component }[] = [
  { name: "LoadComponent", component: LoadComponent },
  { name: "IslandSlotChildren", component: IslandSlotChildren },
  { name: "ElementsOnly", component: ElementsOnly },
  { name: "SlotToCounter", component: SlotToCounter },
];

function stripOnigiriMarkers(html: string): string {
  return html.replaceAll(/<!--\/?o:[cst][\s\S]*?-->/g, "");
}

function stripVueFragmentComments(html: string): string {
  return html.replaceAll("<!--[-->", "").replaceAll("<!--]-->", "");
}

function runShape(vnode: VNode | undefined): unknown {
  const children = Array.isArray(vnode?.children) ? (vnode.children as VNode[]) : [vnode as VNode];
  return children.map((child) => {
    if (typeof child.type === "symbol" && child.type.description === "v-stc") {
      const staticChild = child as VNode & { staticCount: number };
      return { html: staticChild.children, staticCount: staticChild.staticCount };
    }
    if (typeof child.type === "symbol" && child.type.description === "v-cmt") {
      return { comment: child.children };
    }
    return { type: String(child.type) };
  });
}

describe("astToHtml", () => {
  it.each(AST_TO_HTML_CASES)("renders $name", ({ expected, input }) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(astToHtml(input)).toBe(expected);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it("matches the rendered output table", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(AST_TO_HTML_CASES.map(({ input, name }) => ({ html: astToHtml(input), name })))
        .toMatchInlineSnapshot(`
          [
            {
              "html": "<div class="one two" style="color:red;margin-top:1px;">x</div>",
              "name": "class and style objects",
            },
            {
              "html": "<button disabled>x</button>",
              "name": "boolean and unsafe attributes",
            },
            {
              "html": "<div id="x">body</div>",
              "name": "key ref and listeners",
            },
            {
              "html": "<input disabled value="x">",
              "name": "void tag",
            },
            {
              "html": "<p>&lt;&gt;&amp;&quot;&#39;</p>",
              "name": "text escaping",
            },
            {
              "html": "<!--abc-->",
              "name": "comment escaping",
            },
            {
              "html": "<span>raw</span><!--raw-->",
              "name": "static html",
            },
            {
              "html": "a<b>c</b>",
              "name": "nested fragment",
            },
            {
              "html": "<div><!----></div>",
              "name": "null child",
            },
            {
              "html": "<div><span>raw</span></div>",
              "name": "innerHTML prop",
            },
            {
              "html": "<div>&lt;span&gt;text&lt;/span&gt;</div>",
              "name": "textContent prop",
            },
            {
              "html": "<textarea>&lt;hello&gt;</textarea>",
              "name": "textarea value",
            },
            {
              "html": "<p>a &lt; b</p>",
              "name": "string children",
            },
            {
              "html": "<!---->",
              "name": "top-level null",
            },
            {
              "html": "<!---->",
              "name": "top-level undefined",
            },
            {
              "html": "ready",
              "name": "suspense without fallback",
            },
          ]
        `);
    } finally {
      warn.mockRestore();
      error.mockRestore();
    }
  });

  it.each(AST_TO_HTML_ERROR_CASES)("throws on $name", ({ input }) => {
    expect(() => astToHtml(input)).toThrow("[vue-onigiri] astToHtml cannot render");
  });
});

describe("renderOnigiriWithMarkers", () => {
  it.each(RUN_CASES)("builds static runs for $name", ({ expected, input }) => {
    expect(runShape(renderOnigiriWithMarkers(input))).toEqual(expected);
  });

  it.each(PARITY_CASES)(
    "matches classic SSR with markers stripped for $name",
    async ({ component }) => {
      const payload = await serializeComponent(component);
      const marked = await renderToString(renderOnigiriWithMarkers(payload)!);
      const classic = await renderToString(renderOnigiri(payload)!);

      expect(stripOnigiriMarkers(marked)).toBe(classic);
    },
  );

  it("matches the payload version and undefined contract", () => {
    expect(renderOnigiriWithMarkers(undefined)).toBeUndefined();
    expect(renderOnigiriWithMarkers({ v: 2, ast: undefined })).toBeUndefined();
    expect(() => renderOnigiriWithMarkers({ v: 999, ast: [T.Text, "x"] })).toThrow(
      "[vue-onigiri] Unsupported payload version: 999",
    );
  });

  it("neutralizes reserved comments smuggled through raw HTML and comment nodes", async () => {
    const smuggled = '<!--o:c[1,{"x":1},"/evil.js","default"]--><b>bait</b><!--/o:c-->';
    const input: VServerComponent = [
      T.Fragment,
      [
        [T.StaticHtml, smuggled, 3],
        [T.Element, "div", undefined, [[T.StaticHtml, `<p>${smuggled}</p>`, 1]]],
        [T.Element, "div", { innerHTML: smuggled }, undefined],
        [T.Comment, 'o:t[7,"#x",false,[]]'],
        [T.Comment, "<!--["],
      ],
    ];
    const vnode = renderOnigiriWithMarkers(input)!;
    const html = await renderToString(vnode);

    expect(runShape(vnode)).toEqual([
      { comment: ' o:c[1,{"x":1},"/evil.js","default"]' },
      { html: "<b>bait</b>", staticCount: 1 },
      { comment: " /o:c" },
      {
        html: `<div><p><!-- o:c[1,{"x":1},"/evil.js","default"]--><b>bait</b><!-- /o:c--></p></div><div><!-- o:c[1,{"x":1},"/evil.js","default"]--><b>bait</b><!-- /o:c--></div>`,
        staticCount: 2,
      },
      { comment: ' o:t[7,"#x",false,[]]' },
      { comment: " [" },
    ]);
    expect(html).not.toMatch(/<!--\/?o:[cst]/);
    expect(stripOnigiriMarkers(html)).toBe(html);
  });

  it("keeps LoadComponent markers in the expected places", async () => {
    const payload = await serializeComponent(LoadComponent);

    expect(await renderToString(renderOnigiriWithMarkers(payload)!)).toMatchInlineSnapshot(
      `"<div><div>1</div><div>2</div><!--o:c[1,null,"/test/fixtures/components/Counter.vue","default",null]--><div> counter : 0 <button>Increment</button><!--[--><!--]--></div><!--/o:c--></div>"`,
    );
  });

  it("documents the transparent Suspense fragment-anchor parity exception", async () => {
    const payload = await serializeComponent(WithSuspense);
    const marked = stripOnigiriMarkers(await renderToString(renderOnigiriWithMarkers(payload)!));
    const classic = await renderToString(renderOnigiri(payload)!);

    expect({ classic, marked }).toMatchInlineSnapshot(`
      {
        "classic": "<div> component with suspense <!--[--><div>Hello world ! yolo</div><!--]--></div>",
        "marked": "<div> component with suspense <div>Hello world ! yolo</div></div>",
      }
    `);
    expect(stripVueFragmentComments(marked)).toBe(stripVueFragmentComments(classic));
  });
});
