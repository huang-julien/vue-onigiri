// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import ElementsOnly from "virtual:vsc:./fixtures/components/ElementsOnly.vue";
import { defineComponent, h, nextTick, provide, Suspense } from "vue";
import { renderOnigiri } from "../src/runtime/deserialize";
import LoadComponent from "virtual:vsc:./fixtures/components/LoadComponent.vue";
import { serializeComponent } from "../src/runtime/serialize";
import AsyncComponent from "virtual:vsc:./fixtures/components/AsyncComponent.vue";
import WithAsyncComponent from "virtual:vsc:./fixtures/components/WithAsyncComponent.vue";
import SlotToCounter from "virtual:vsc:./fixtures/components/SlotToCounter.vue";
import WithSuspense from "virtual:vsc:./fixtures/components/WithSuspense.vue";
import { removeCommentsFromHtml } from "./utils";
import {
  VServerComponentType,
  type VServerComponent,
} from "../src/runtime/shared";
import { renderToString } from "@vue/server-renderer";

describe("serialize/deserialize", () => {
  it("expect to parse and render a component with only elements", async () => {
    const ast = await serializeComponent(ElementsOnly);
    const html = await renderToString(h(ElementsOnly));
    expect(html).toMatchInlineSnapshot(
      `"<div><div>1</div><div>2</div><div>0</div></div>"`,
    );

    expect(ast).toMatchInlineSnapshot(`
      [
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
      ]
    `);
    const clientSide = mount(
      defineComponent({
        setup() {
          return () => renderOnigiri(ast);
        },
      }),
    );
    const rebuiltHtml = clientSide.html().replaceAll(/\r?\n| /g, "");
    expect(rebuiltHtml).toMatchInlineSnapshot(
      `"<div><div>1</div><div>2</div><div>0</div></div>"`,
    );
    expect(rebuiltHtml).toEqual(html);
  });

  describe("load components", () => {
    it("should render a component with loadClientSide prop", async () => {
      const ast = await serializeComponent(LoadComponent);
      const html = await renderToString(h(LoadComponent));
      expect(removeCommentsFromHtml(html)).toMatchInlineSnapshot(
        `"<div><div>1</div><div>2</div><div loadclientside load:client> counter : 0 <button>Increment</button></div></div>"`,
      );

      expect(ast).toMatchInlineSnapshot(`
      [
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
            {
              "load:client": "",
              "loadClientSide": "",
            },
            "/test/fixtures/components/Counter.vue",
            {},
          ],
        ],
      ]
    `);
      const clientSide = mount(
        defineComponent({
          setup() {
            return () =>
              h(
                Suspense,
                {},
                {
                  default: () => renderOnigiri(ast),
                },
              );
          },
        }),
      );
      await flushPromises();
      await nextTick();
      const rebuiltHtml = removeCommentsFromHtml(
        clientSide.html().replaceAll(/\r?\n| |=""/g, ""),
      );
      expect(removeCommentsFromHtml(rebuiltHtml)).toMatchInlineSnapshot(
        `"<div><div>1</div><div>2</div><divloadclientsideload:client>counter:0<button>Increment</button></div></div>"`,
      );
      expect(rebuiltHtml).toEqual(
        removeCommentsFromHtml(html).replaceAll(/\r?\n| |=""/g, ""),
      );

      await clientSide.find("button").trigger("click");
      await flushPromises();
      await nextTick();
      expect(clientSide.html()).contain("1");
      expect(clientSide.html()).toMatchInlineSnapshot(`
        "<div>
          <div>1</div>
          <div>2</div>
          <div loadclientside="" load:client=""> counter : 1 <button>Increment</button></div>
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
      [
        0,
        "div",
        undefined,
        [
          [
            2,
            "Hello world ! some text",
          ],
        ],
      ]
    `);
    await flushPromises();
    await nextTick();
    expect(html).toMatchInlineSnapshot(`"<div>Hello world ! some text</div>"`);
    const rebuilt = mount({
      render: () => renderOnigiri(ast),
    });
    await flushPromises();
    expect(rebuilt.html()).toMatchInlineSnapshot(
      `"<div>Hello world ! some text</div>"`,
    );
    expect(rebuilt.html()).toBe(html);
  });

  it("handles nested async component", async () => {
    const ast = await serializeComponent(WithAsyncComponent, {});

    expect(ast).toMatchInlineSnapshot(`
      [
        0,
        "div",
        undefined,
        [
          [
            2,
            " component with suspense ",
          ],
          [
            3,
            [
              [
                2,
                "Hello world ! yolo",
              ],
            ],
          ],
        ],
      ]
    `);
  });

  it("handles nested async component with suspense", async () => {
    const ast = await serializeComponent(WithSuspense, {});

    expect(ast).toMatchInlineSnapshot(`
      [
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
                3,
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
      ]
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
      await flushPromises();
      await nextTick();
      const html = wrapper.html();
      expect(html).toMatchInlineSnapshot(`"<div>injection: Success !</div>"`);
    });
  });
});

describe("slots", () => {
  it("should send slots into Counter", async () => {
    const ast = await serializeComponent(SlotToCounter);

    expect(ast).toMatchInlineSnapshot(`
      [
        0,
        "div",
        undefined,
        [
          [
            1,
            {
              "load:client": "",
              "loadClientSide": "",
            },
            "/test/fixtures/components/Counter.vue",
            {},
          ],
        ],
      ]
    `);

    const html = await renderToString(h(SlotToCounter));
    expect(removeCommentsFromHtml(html)).toMatchInlineSnapshot(
      `"<div><div loadclientside load:client> counter : 0 <button>Increment</button><div><p>Slot to Counter: 0</p></div></div></div>"`,
    );
  });
});
