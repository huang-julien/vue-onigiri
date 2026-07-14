// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementsOnly from "./fixtures/components/ElementsOnly.vue";
import { defineComponent, h, inject, nextTick, provide, Suspense } from "vue";
import { renderOnigiri } from "../src/runtime/deserialize";
import LoadComponent from "./fixtures/components/LoadComponent.vue";
import { serializeComponent } from "../src/runtime/serialize";
import AsyncComponent from "./fixtures/components/AsyncComponent.vue";
import WithAsyncComponent from "./fixtures/components/WithAsyncComponent.vue";
import SlotToCounter from "./fixtures/components/SlotToCounter.vue";
import WithSuspense from "./fixtures/components/WithSuspense.vue";
import ForVariants from "./fixtures/components/ForVariants.vue";
import DisplayValues from "./fixtures/components/DisplayValues.vue";
import AliasLoad from "./fixtures/components/AliasLoad.vue";
import { removeCommentsFromHtml } from "./utils";
import { VServerComponentType, type VServerComponent } from "../src/runtime/shared";
import { renderToString } from "@vue/server-renderer";

describe("serialize/deserialize", () => {
  it("expect to parse and render a component with only elements", async () => {
    const ast = await serializeComponent(ElementsOnly);
    const html = await renderToString(h(ElementsOnly));
    expect(html).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><div>0</div></div>"`);

    expect(ast).toMatchInlineSnapshot(`
      {
        "ast": [
          0,
          "div",
          undefined,
          [
            [
              0,
              "div",
              undefined,
              [
                [
                  2,
                  "1",
                ],
              ],
            ],
            [
              0,
              "div",
              undefined,
              [
                [
                  2,
                  "2",
                ],
              ],
            ],
            [
              0,
              "div",
              undefined,
              [
                [
                  2,
                  "0",
                ],
              ],
            ],
          ],
        ],
        "v": 1,
      }
    `);
    const clientSide = mount(
      defineComponent({
        setup() {
          return () => renderOnigiri(ast);
        },
      }),
    );
    const rebuiltHtml = clientSide.html().replaceAll(/\r?\n| /g, "");
    expect(rebuiltHtml).toMatchInlineSnapshot(`"<div><div>1</div><div>2</div><div>0</div></div>"`);
    expect(rebuiltHtml).toEqual(html);
  });

  describe("load components", () => {
    it("should render a component with loadClientSide prop", async () => {
      const ast = await serializeComponent(LoadComponent);
      const html = await renderToString(h(LoadComponent));
      expect(removeCommentsFromHtml(html)).toMatchInlineSnapshot(
        `"<div><div>1</div><div>2</div><div> counter : 0 <button>Increment</button></div></div>"`,
      );

      const { promise, resolve } = Promise.withResolvers();

      expect(ast).toMatchInlineSnapshot(`
        {
          "ast": [
            0,
            "div",
            undefined,
            [
              [
                0,
                "div",
                undefined,
                [
                  [
                    2,
                    "1",
                  ],
                ],
              ],
              [
                0,
                "div",
                undefined,
                [
                  [
                    2,
                    "2",
                  ],
                ],
              ],
              [
                1,
                undefined,
                "/test/fixtures/components/Counter.vue",
                "default",
                undefined,
              ],
            ],
          ],
          "v": 1,
        }
      `);
      const clientSide = mount(
        defineComponent({
          setup() {
            return () =>
              h(
                Suspense,
                {
                  onResolve: () => resolve(true),
                },
                {
                  default: () => renderOnigiri(ast),
                },
              );
          },
        }),
      );
      await promise;
      await flushPromises();
      await nextTick();
      const rebuiltHtml = removeCommentsFromHtml(clientSide.html().replaceAll(/\r?\n| |=""/g, ""));
      expect(removeCommentsFromHtml(rebuiltHtml)).toMatchInlineSnapshot(
        `"<div><div>1</div><div>2</div><div>counter:0<button>Increment</button></div></div>"`,
      );
      expect(rebuiltHtml).toEqual(removeCommentsFromHtml(html).replaceAll(/\r?\n| |=""/g, ""));

      await clientSide.find("button").trigger("click");
      await flushPromises();
      await nextTick();
      expect(clientSide.html()).contain("1");
      expect(clientSide.html()).toMatchInlineSnapshot(`
        "<div>
          <div>1</div>
          <div>2</div>
          <div> counter : 1 <button>Increment</button></div>
        </div>"
      `);
    });
  });
});

describe("Async components", () => {
  it("should serialize async component", async () => {
    const ast = await serializeComponent(AsyncComponent, { v: "some text" });
    const html = await renderToString(
      h(AsyncComponent, {
        v: "some text",
      }),
    );
    expect(ast).toMatchInlineSnapshot(`
      {
        "ast": [
          0,
          "div",
          undefined,
          [
            [
              2,
              "Hello world ! some text",
            ],
          ],
        ],
        "v": 1,
      }
    `);
    await flushPromises();
    await nextTick();
    expect(html).toMatchInlineSnapshot(`"<div>Hello world ! some text</div>"`);
    const rebuilt = mount({
      render: () => renderOnigiri(ast),
    });
    await flushPromises();
    expect(rebuilt.html()).toMatchInlineSnapshot(`"<div>Hello world ! some text</div>"`);
    expect(rebuilt.html()).toBe(html);
  });

  it("handles nested async component", async () => {
    const ast = await serializeComponent(WithAsyncComponent, {});

    expect(ast).toMatchInlineSnapshot(`
      {
        "ast": [
          0,
          "div",
          undefined,
          [
            [
              2,
              " component with suspense ",
            ],
            [
              0,
              "div",
              undefined,
              [
                [
                  2,
                  "Hello world ! yolo",
                ],
              ],
            ],
          ],
        ],
        "v": 1,
      }
    `);
  });

  it("handles nested async component with suspense", async () => {
    const ast = await serializeComponent(WithSuspense, {});

    expect(ast).toMatchInlineSnapshot(`
      {
        "ast": [
          0,
          "div",
          undefined,
          [
            [
              2,
              " component with suspense ",
            ],
            [
              4,
              [
                [
                  0,
                  "div",
                  undefined,
                  [
                    [
                      2,
                      "Hello world ! yolo",
                    ],
                  ],
                ],
              ],
            ],
          ],
        ],
        "v": 1,
      }
    `);
  });
});

describe("revive", () => {
  describe("injection", () => {
    it("should injection be working when reviving", async () => {
      const key = "test";

      const { promise, resolve } = Promise.withResolvers();

      const ast: VServerComponent = [
        VServerComponentType.Component,
        undefined,
        "/test/fixtures/components/Injection.vue",
        undefined,
      ];

      const wrapper = mount({
        setup() {
          provide(key, "Success !");
          return () =>
            h(
              Suspense,
              { onResolve: () => resolve(true) },
              {
                default: () => renderOnigiri(ast),
              },
            );
        },
      });
      await promise;
      // Inner Suspense (in the Loader) needs its async load to settle
      // after the outer Suspense resolves. Poll until the rendered HTML
      // contains the expected content rather than guessing tick counts.
      for (let i = 0; i < 20 && !wrapper.html().includes("Success"); i++) {
        await flushPromises();
        await nextTick();
        await new Promise((r) => setTimeout(r, 10));
      }
      const html = wrapper.html();
      expect(html).toMatchInlineSnapshot(`"<div>injection: Success !</div>"`);
    });
  });
});

describe("slots", () => {
  it("should send slots into Counter", async () => {
    const ast = await serializeComponent(SlotToCounter);

    expect(ast).toMatchInlineSnapshot(`
      {
        "ast": [
          0,
          "div",
          undefined,
          [
            [
              1,
              undefined,
              "/test/fixtures/components/Counter.vue",
              "default",
              {
                "default": [
                  0,
                  "div",
                  undefined,
                  [
                    [
                      0,
                      "p",
                      undefined,
                      [
                        [
                          2,
                          "Slot content (static)",
                        ],
                      ],
                    ],
                  ],
                ],
              },
            ],
          ],
        ],
        "v": 1,
      }
    `);
    // The loader's `async setup` awaits `importFn` inside a `<Suspense>`
    // boundary, so SSR fully renders Counter (and its slot) — same code
    // path as client hydration. No more SSR↔CSR divergence dance.
    const astHtml = await renderToString(h(Suspense, null, { default: () => renderOnigiri(ast) }));
    expect(removeCommentsFromHtml(astHtml)).toMatchInlineSnapshot(
      `"<div><div> counter : 0 <button>Increment</button><div><p>Slot content (static)</p></div></div></div>"`,
    );
    // Direct render of the SFC matches: same Counter + slot output.
    const html = await renderToString(h(SlotToCounter));
    expect(removeCommentsFromHtml(html)).toMatchInlineSnapshot(
      `"<div><div> counter : 0 <button>Increment</button><div><p>Slot content (static)</p></div></div></div>"`,
    );
  });
});

describe("payload versioning", () => {
  it("serialize entry points wrap the AST in a versioned envelope", async () => {
    const payload = await serializeComponent(ElementsOnly);
    expect(payload.v).toBe(1);
    expect(Array.isArray(payload.ast)).toBe(true);
  });

  it("renderOnigiri rejects payloads from a different format version", () => {
    expect(() =>
      renderOnigiri({ v: 999, ast: [VServerComponentType.Text, "x"] }),
    ).toThrow("[vue-onigiri] Unsupported payload version: 999");
  });

  it("renderOnigiri still accepts bare tuple arrays", () => {
    const wrapper = mount(
      defineComponent({
        setup: () => () => renderOnigiri([VServerComponentType.Text, "legacy"]),
      }),
    );
    expect(wrapper.html()).toContain("legacy");
  });
});

describe("v-load-client via alias import", () => {
  it("resolves the aliased import to a root-relative chunk path", async () => {
    const ast = await serializeComponent(AliasLoad);
    expect(JSON.stringify(ast)).toContain('"/test/fixtures/components/Counter.vue"');
  });
});

describe("suspense fallback", () => {
  it("deserializes the fallback tuple as the Suspense fallback slot", () => {
    const ast: VServerComponent = [
      VServerComponentType.Suspense,
      [[VServerComponentType.Text, "content"]],
      [[VServerComponentType.Text, "loading"]],
    ];
    const wrapper = mount(
      defineComponent({
        setup: () => () => renderOnigiri(ast),
      }),
    );
    expect(wrapper.html()).toContain("content");
    expect(wrapper.html()).not.toContain("loading");
  });

  it("serializes an authored fallback from the vnode fallback walk", async () => {
    const WithFallback = defineComponent({
      setup: () => () =>
        h(
          Suspense,
          {},
          {
            default: () => h("div", null, "real content"),
            fallback: () => h("p", null, "loading"),
          },
        ),
    });
    const ast = ((await serializeComponent(WithFallback)) as any).ast;
    const json = JSON.stringify(ast);
    expect(json).toContain("real content");
    expect(json).toContain("loading");

    const suspense = ast[0] === VServerComponentType.Suspense ? ast : ast[1];
    expect(suspense[2]).toBeDefined();
  });
});

describe("interpolation display semantics", () => {
  it("renders null/undefined as empty text and objects as JSON, like Vue", async () => {
    const ast = ((await serializeComponent(DisplayValues)) as any).ast;
    const spanTexts = (ast[3] as any[])
      .filter((child) => child[0] === VServerComponentType.Element)
      .map((span) => span[3][0][1]);

    expect(spanTexts[0]).toBe("");
    expect(spanTexts[1]).toBe("");
    expect(spanTexts[2]).toBe(JSON.stringify({ a: 1 }, null, 2));
    expect(spanTexts[3]).toBe("0");
  });
});

describe("v-for over non-array sources", () => {
  it("serializes object and numeric-range sources and matches Vue SSR output", async () => {
    const ast = await serializeComponent(ForVariants);
    const json = JSON.stringify(ast);
    expect(json).toContain("a=1");
    expect(json).toContain("b=2");

    const html = await renderToString(h(ForVariants));
    const clientSide = mount(
      defineComponent({
        setup: () => () => renderOnigiri(ast),
      }),
    );
    const rebuilt = removeCommentsFromHtml(clientSide.html().replaceAll(/\r?\n| /g, ""));
    expect(rebuilt).toEqual(removeCommentsFromHtml(html));
  });
});

// Non-onigiri components (no __onigiriRender) go through the vnode
// fallback walk in renderComponent. The async-setup/serverPrefetch
// branch must produce the same output as the sync branch.
describe("fallback walk (non-onigiri components)", () => {
  const wrapperRender = () => h("div", { class: "wrapper" }, [h("span", null, "hi")]);
  const SyncChild = defineComponent({
    setup() {
      return wrapperRender;
    },
  });
  const AsyncChild = defineComponent({
    async setup() {
      await Promise.resolve();
      return wrapperRender;
    },
  });
  const makeParent = (Child: ReturnType<typeof defineComponent>) =>
    defineComponent({
      setup: () => () => h("section", null, [h(Child)]),
    });

  it("preserves the root element of an async-setup child", async () => {
    const astSync = await serializeComponent(makeParent(SyncChild));
    const astAsync = await serializeComponent(makeParent(AsyncChild));
    expect(JSON.stringify(astAsync)).toContain("\"wrapper\"");
    expect(astAsync).toEqual(astSync);
  });

  it("preserves the root element of a serverPrefetch child", async () => {
    const PrefetchChild = defineComponent({
      serverPrefetch: () => Promise.resolve(),
      setup() {
        return wrapperRender;
      },
    });
    const ast = await serializeComponent(makeParent(PrefetchChild));
    expect(ast).toEqual(await serializeComponent(makeParent(SyncChild)));
  });

  it("keeps provide() from an async component visible to its descendants", async () => {
    const Inner = defineComponent({
      setup() {
        const v = inject("onigiri-fallback-key", "missing");
        return () => h("span", null, String(v));
      },
    });
    const AsyncProvider = defineComponent({
      async setup() {
        provide("onigiri-fallback-key", "provided");
        await Promise.resolve();
        return () => h(Inner);
      },
    });
    const Root = defineComponent({
      setup: () => () => h(AsyncProvider),
    });
    const ast = await serializeComponent(Root);
    expect(JSON.stringify(ast)).toContain("provided");
    expect(JSON.stringify(ast)).not.toContain("missing");
  });
});
