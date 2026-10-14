import { describe, expect, it } from "vitest";
import { compileOnigiri, type OnigiriCompilerOptions } from "../../src/template-compiler";

describe("static subtree compilation", () => {
  it.each<{ name: string; input: string; expected: string; options?: OnigiriCompilerOptions }>([
    {
      name: "fully static root with nested elements",
      input: "<div><span>x</span></div>",
      expected: '[5, "<div><span>x</span></div>", 1]',
    },
    {
      name: "mixed runs count top-level text and elements",
      input: 'before<span>x</span>after<p :id="id">dynamic</p><b>end</b><i>!</i>',
      expected:
        '[3, [[5, "before<span>x</span>after", 3], [0, "p", {"id": _ctx.id}, "dynamic"], [5, "<b>end</b><i>!</i>", 2]]]',
    },
    {
      name: "text-only run stays a Text tuple",
      input: 'hello<p :id="id">world</p>',
      expected: '[3, [[2, "hello"], [0, "p", {"id": _ctx.id}, "world"]]]',
    },
    { name: "lone text", input: "hello", expected: '[2, "hello"]' },
    {
      name: "text separated by dropped comments counts as one DOM node",
      input: "a<!-- middle -->b<span>x</span>",
      expected: '[3, [[5, "ab<span>x</span>", 2]]]',
    },
    {
      name: "static key bails",
      input: '<div key="x">x</div>',
      expected: '[0, "div", {"key": "x"}, "x"]',
    },
    {
      name: "static ref bails",
      input: '<div ref="x">x</div>',
      expected: '[0, "div", {"ref": "x"}, "x"]',
    },
    {
      name: "custom elements bail",
      input: "<my-widget>x</my-widget>",
      options: { isCustomElement: (tag) => tag === "my-widget" },
      expected: '[0, "my-widget", undefined, "x"]',
    },
    {
      name: "scope ID reaches every static element",
      input: "<div><span>x</span></div>",
      options: { scopeId: "data-v-abc" },
      expected: '[5, "<div data-v-abc><span data-v-abc>x</span></div>", 1]',
    },
    {
      name: "scope ID reaches dynamic element tuples",
      input: '<div :id="id"><span :title="title">x</span></div>',
      options: { scopeId: "data-v-abc" },
      expected:
        '[0, "div", {"data-v-abc": "", "id": _ctx.id}, [[0, "span", {"data-v-abc": "", "title": _ctx.title}, "x"]]]',
    },
    {
      name: "comments inside static elements disappear",
      input: "<div><!-- first --><span>x</span><!-- last --></div>",
      expected: '[5, "<div><span>x</span></div>", 1]',
    },
    {
      name: "comments between static siblings do not count",
      input: "<b>a</b><!-- middle --><i>b</i>",
      expected: '[3, [[5, "<b>a</b><i>b</i>", 2]]]',
    },
    {
      name: "v-pre interpolation stays literal",
      input: "<div v-pre>{{ literal }}</div>",
      expected: '[5, "<div>{{ literal }}</div>", 1]',
    },
    {
      name: "v-pre directive-looking attributes bail",
      input: '<div v-pre :foo="bar">{{ literal }}</div>',
      expected: '[0, "div", {":foo": "bar"}, "{{ literal }}"]',
    },
    {
      name: "nested interpolation keeps ancestors dynamic",
      input: "<div><span>{{ value }}</span></div>",
      expected: '[0, "div", undefined, [[0, "span", undefined, _toDisplayString(_ctx.value)]]]',
    },
    {
      name: "custom directive keeps all descendants as tuples",
      input: '<div v-tip="tip"><section><b>x</b><i>y</i></section></div>',
      expected:
        '__withDirective("tip", [0, "div", undefined, [[0, "section", undefined, [[0, "b", undefined, "x"], [0, "i", undefined, "y"]]]]], {"value": _ctx.tip}, __instance)',
    },
    {
      name: "nested directives restore static generation for following siblings",
      input: "<div v-tip><section v-tip><b>x</b></section><i>y</i></div><footer>end</footer>",
      expected:
        '[3, [__withDirective("tip", [0, "div", undefined, [__withDirective("tip", [0, "section", undefined, [[0, "b", undefined, "x"]]], {}, __instance), [0, "i", undefined, "y"]]], {}, __instance), [5, "<footer>end</footer>", 1]]]',
    },
    {
      name: "select v-model preserves option tuples",
      input:
        '<select v-model="value"><option value="a">A</option><optgroup label="more"><option>B</option></optgroup></select>',
      expected:
        '__withDirective("model", [0, "select", undefined, [[0, "option", {"value": "a"}, "A"], [0, "optgroup", {"label": "more"}, [[0, "option", undefined, "B"]]]]], {"value": _ctx.value}, __instance)',
    },
    {
      name: "unknown attributes bail",
      input: '<div unknown="x">x</div>',
      expected: '[0, "div", {"unknown": "x"}, "x"]',
    },
    {
      name: "table parts bail",
      input: "<table><tr><td>x</td></tr></table>",
      expected: '[0, "table", undefined, [[0, "tr", undefined, [[0, "td", undefined, "x"]]]]]',
    },
    {
      name: "void elements omit closing tags",
      input: '<div><br><img src="/image.png"></div>',
      expected: '[5, "<div><br><img src=\\"/image.png\\"></div>", 1]',
    },
    {
      name: "text and attributes are escaped",
      input: '<p title="&lt;&amp;&quot;">&lt;&amp;&quot;</p>',
      expected: '[5, "<p title=\\"&lt;&amp;&quot;\\">&lt;&amp;&quot;</p>", 1]',
    },
    {
      name: "pre whitespace is preserved",
      input: "<pre>one\n  two</pre>",
      expected: '[5, "<pre>one\\n  two</pre>", 1]',
    },
    {
      name: "static SVG uses SVG attributes",
      input: '<svg viewBox="0 0 10 10"><path d="M0 0" stroke-width="2" /></svg>',
      expected:
        '[5, "<svg viewBox=\\"0 0 10 10\\"><path d=\\"M0 0\\" stroke-width=\\"2\\"></path></svg>", 1]',
    },
    {
      name: "static MathML uses MathML attributes",
      input: '<math><mi mathvariant="bold">x</mi></math>',
      expected: '[5, "<math><mi mathvariant=\\"bold\\">x</mi></math>", 1]',
    },
  ])("$name", ({ input, expected, options }) => {
    expect(compileOnigiri(input, options).code).toContain(`return ${expected};`);
  });
});
