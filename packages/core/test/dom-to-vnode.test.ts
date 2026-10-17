// @vitest-environment happy-dom

import { flushPromises } from "@vue/test-utils";
import { renderToString, type SSRContext } from "@vue/server-renderer";
import {
  createApp,
  createSSRApp,
  defineComponent,
  h,
  inject,
  nextTick,
  provide,
  shallowRef,
  Suspense,
  type App,
  type VNode,
} from "vue";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { renderOnigiriWithMarkers } from "../src/runtime/ast-to-html";
import { domToVNode, htmlToVNode } from "../src/runtime/dom-to-vnode";
import { serializeComponent } from "../src/runtime/serialize";
import {
  encodeMarker,
  MARKER_COMPONENT,
  MARKER_COMPONENT_END,
  MARKER_SUSPENSE,
  MARKER_TELEPORT,
  VServerComponentType,
  type OnigiriPayload,
  type VServerComponent,
} from "@vue-onigiri/shared";
import type { ImportFn } from "../src/runtime/utils";
import Counter from "./fixtures/components/Counter.vue";
import ElementsOnly from "./fixtures/components/ElementsOnly.vue";
import IslandSlotChildren from "./fixtures/components/IslandSlotChildren.vue";
import LoadComponent from "./fixtures/components/LoadComponent.vue";

const COUNTER_CHUNK = "/test/dom-to-vnode/Counter.vue";
const INJECTED_CHUNK = "/test/dom-to-vnode/Injected.vue";

type IslandInput = VServerComponent | OnigiriPayload | undefined;

interface HydrationCase {
  /** Human-readable fixture label. */
  name: string;
  /** Serialized payload or hand-authored AST rendered by the server side. */
  input: () => Promise<IslandInput> | IslandInput;
  /** A static DOM node that should be adopted, not replaced. */
  identitySelector?: string;
  /** Number of counter buttons to click after hydration. */
  clickButtons?: number;
  /** Install a real target and SSR teleport payload before hydrating. */
  teleportTarget?: string;
  /** Provide this value from the surrounding page app. */
  provideTest?: string;
  /** Expected text after hydration. */
  expectedText?: string;
  /** Resolve hand-authored component chunks. */
  importFn?: ImportFn;
}

const Injected = defineComponent({
  name: "Injected",
  setup(): () => VNode {
    const value = inject("test");
    return () => h("p", { "data-injected": "yes" }, `injection: ${value}`);
  },
});

const TEST_IMPORT_FN: ImportFn = async (src: string) => {
  if (src === COUNTER_CHUNK) return Counter as any;
  if (src === INJECTED_CHUNK) return Injected as any;
  throw new Error(`Unexpected chunk ${src}`);
};

describe("domToVNode", () => {
  const apps: App[] = [];

  afterEach(() => {
    for (const app of apps.splice(0)) app.unmount();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it.each<HydrationCase>([
    {
      name: "single element root",
      input: () => serializeComponent(ElementsOnly),
      identitySelector: "div > div:first-child",
    },
    {
      name: "client component with static siblings",
      input: () => serializeComponent(LoadComponent),
      identitySelector: "div > div:first-child",
      clickButtons: 1,
    },
    {
      name: "fragment root",
      input: () => [
        VServerComponentType.Fragment,
        [
          [
            VServerComponentType.Element,
            "p",
            { "data-keep": "one" },
            [[VServerComponentType.Text, "one"]],
          ],
          [VServerComponentType.Element, "p", undefined, [[VServerComponentType.Text, "two"]]],
        ],
      ],
      identitySelector: "[data-keep='one']",
    },
    {
      name: "empty island",
      input: () => undefined,
    },
    {
      name: "root text",
      input: () => [VServerComponentType.Text, "plain root"],
      expectedText: "plain root",
    },
    {
      name: "root plain comment",
      input: () => [VServerComponentType.Comment, "plain root comment"],
    },
    {
      name: "empty fragment root",
      input: () => [VServerComponentType.Fragment, []],
    },
    {
      name: "client component with static and nested client slots",
      input: () => serializeComponent(IslandSlotChildren),
      identitySelector: "div div div:first-child",
      clickButtons: 2,
    },
    {
      name: "leading empty comment and comments between static runs",
      input: () => [
        VServerComponentType.Fragment,
        [
          [VServerComponentType.Comment, ""],
          [
            VServerComponentType.Element,
            "p",
            { "data-keep": "after-leading-comment" },
            [[VServerComponentType.Text, "after leading comment"]],
          ],
          [VServerComponentType.Comment, "split"],
          [
            VServerComponentType.Element,
            "p",
            undefined,
            [[VServerComponentType.Text, "after split"]],
          ],
        ],
      ],
      identitySelector: "[data-keep='after-leading-comment']",
    },
    {
      name: "raw static HTML starts with a comment",
      input: () => [
        VServerComponentType.Fragment,
        [[VServerComponentType.StaticHtml, '<!--lead--><span data-keep="static">static</span>', 2]],
      ],
      identitySelector: "[data-keep='static']",
    },
    {
      name: "root raw static HTML with two elements",
      input: () => [
        VServerComponentType.StaticHtml,
        '<span data-keep="root-static-one">one</span><span>two</span>',
        2,
      ],
      identitySelector: "[data-keep='root-static-one']",
    },
    {
      name: "root raw static HTML starts with a comment",
      input: () => [
        VServerComponentType.StaticHtml,
        '<!--root-lead--><span data-keep="root-static-comment">static</span>',
        2,
      ],
      identitySelector: "[data-keep='root-static-comment']",
    },
    {
      name: "raw multi-root static HTML adjacent to text",
      input: () => [
        VServerComponentType.Fragment,
        [
          [VServerComponentType.Text, "before"],
          [VServerComponentType.StaticHtml, '<b data-keep="adjacent">bold</b><i>italic</i>', 2],
          [VServerComponentType.Text, "after"],
        ],
      ],
      identitySelector: "[data-keep='adjacent']",
    },
    {
      name: "teleport",
      input: () => [
        VServerComponentType.Fragment,
        [
          [
            VServerComponentType.Element,
            "p",
            { "data-keep": "main" },
            [[VServerComponentType.Text, "main"]],
          ],
          [
            VServerComponentType.Teleport,
            "#target",
            false,
            [
              [
                VServerComponentType.Element,
                "span",
                { "data-teleported": "yes" },
                [[VServerComponentType.Text, "teleported"]],
              ],
            ],
          ],
        ],
      ],
      identitySelector: "[data-keep='main']",
      teleportTarget: "#target",
    },
    {
      name: "suspense with fallback",
      input: () => [
        VServerComponentType.Suspense,
        [
          [
            VServerComponentType.Element,
            "section",
            { "data-keep": "suspense-default" },
            [[VServerComponentType.Text, "resolved"]],
          ],
        ],
        [
          [
            VServerComponentType.Element,
            "p",
            { "data-fallback": "yes" },
            [[VServerComponentType.Text, "loading"]],
          ],
        ],
      ],
      identitySelector: "[data-keep='suspense-default']",
    },
    {
      name: "suspense with fallback containing client component",
      input: () => [
        VServerComponentType.Suspense,
        [[VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"]],
        [
          [
            VServerComponentType.Element,
            "p",
            { "data-fallback": "yes" },
            [[VServerComponentType.Text, "loading counter"]],
          ],
        ],
      ],
      clickButtons: 1,
      importFn: TEST_IMPORT_FN,
    },
    {
      name: "page provide flows through client loader",
      input: () => [VServerComponentType.Component, undefined, INJECTED_CHUNK, "default"],
      provideTest: "from page",
      expectedText: "injection: from page",
      importFn: TEST_IMPORT_FN,
    },
  ])(
    "hydrates marked HTML without mismatch: $name",
    async ({
      input,
      identitySelector,
      clickButtons,
      teleportTarget,
      provideTest,
      expectedText,
      importFn,
    }) => {
      const resolved = await input();
      const serverApp = createSSRApp({
        setup: () => {
          if (provideTest) provide("test", provideTest);
          return () =>
            h(Suspense, null, {
              default: () => renderOnigiriWithMarkers(resolved, { importFn }),
            });
        },
      });
      const context: SSRContext = {};
      const html = await renderToString(serverApp, context);
      const container = document.createElement("div");
      container.innerHTML = html;
      document.body.append(container);
      if (teleportTarget) {
        const target = document.createElement("div");
        target.id = teleportTarget.slice(1);
        target.innerHTML = context.teleports?.[teleportTarget] ?? "";
        document.body.append(target);
      }
      const adoptedNode = identitySelector ? container.querySelector(identitySelector) : undefined;
      if (identitySelector) expect(adoptedNode).not.toBeNull();
      const target = teleportTarget ? document.querySelector(teleportTarget) : null;

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const clientApp = createSSRApp({
        setup: () => {
          if (provideTest) provide("test", provideTest);
          return () =>
            h(Suspense, null, {
              default: () => domToVNode(container.firstChild as Node, { importFn }),
            });
        },
      });
      apps.push(clientApp);
      clientApp.mount(container);
      await flushPromises();
      await nextTick();

      expect(expectHydrationComplaints(warn, error)).toEqual([]);
      if (identitySelector) expect(container.querySelector(identitySelector)).toBe(adoptedNode);
      if (clickButtons) {
        const buttons = [...container.querySelectorAll("button")];
        expect(buttons).toHaveLength(clickButtons);
        for (const button of buttons) button.click();
        await nextTick();
        expect(container.textContent!.match(/counter : 1/g)).toHaveLength(clickButtons);
      }
      if (teleportTarget) {
        expect(target).not.toBeNull();
        expect(target!.innerHTML).toContain('data-teleported="yes"');
        expect(target!.textContent).toContain("teleported");
      }
      if (expectedText) expect(container.textContent).toContain(expectedText);
    },
  );

  it("collapses marker-free DOM into static runs while preserving marked islands", async () => {
    const payload = await serializeComponent(LoadComponent);
    const serverApp = createSSRApp({
      setup: () => () =>
        h(Suspense, null, {
          default: () => renderOnigiriWithMarkers(payload),
        }),
    });
    const container = document.createElement("div");
    container.innerHTML = await renderToString(serverApp);
    document.body.append(container);

    expect(vnodeShape(domToVNode(container.firstChild as Node))).toMatchInlineSnapshot(`
      {
        "children": [
          "static(2)",
          "comment:o:c[...]",
          "Suspense",
          "comment:/o:c",
        ],
        "type": "div",
      }
    `);
  });

  it("converts fetched marked HTML and patches without replacing untouched static runs", async () => {
    const htmlOne = await renderToString(
      renderOnigiriWithMarkers(
        [
          VServerComponentType.Element,
          "section",
          { "data-root": "refetch" },
          [
            [
              VServerComponentType.Element,
              "p",
              { "data-keep": "refetch" },
              [[VServerComponentType.Text, "unchanged"]],
            ],
            [VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"],
            [
              VServerComponentType.Element,
              "p",
              { "data-changing": "yes" },
              [[VServerComponentType.Text, "one"]],
            ],
          ],
        ],
        { importFn: TEST_IMPORT_FN },
      )!,
    );
    const htmlTwo = await renderToString(
      renderOnigiriWithMarkers(
        [
          VServerComponentType.Element,
          "section",
          { "data-root": "refetch" },
          [
            [
              VServerComponentType.Element,
              "p",
              { "data-keep": "refetch" },
              [[VServerComponentType.Text, "unchanged"]],
            ],
            [VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"],
            [
              VServerComponentType.Element,
              "p",
              { "data-changing": "yes" },
              [[VServerComponentType.Text, "two"]],
            ],
          ],
        ],
        { importFn: TEST_IMPORT_FN },
      )!,
    );
    const htmlThree = await renderToString(
      renderOnigiriWithMarkers(
        [
          VServerComponentType.Element,
          "section",
          { "data-root": "refetch" },
          [
            [
              VServerComponentType.Element,
              "p",
              { "data-keep": "refetch" },
              [[VServerComponentType.Text, "changed later"]],
            ],
            [VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"],
            [
              VServerComponentType.Element,
              "p",
              { "data-changing": "yes" },
              [[VServerComponentType.Text, "three"]],
            ],
          ],
        ],
        { importFn: TEST_IMPORT_FN },
      )!,
    );
    const container = document.createElement("div");
    document.body.append(container);

    const current = shallowRef<VNode | undefined>(
      htmlToVNode(htmlOne, { importFn: TEST_IMPORT_FN }),
    );
    const app = createApp({ setup: () => () => current.value });
    apps.push(app);
    app.mount(container);
    await flushPromises();
    await nextTick();

    const kept = container.querySelector("[data-keep='refetch']");
    expect(kept).not.toBeNull();
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("one");

    const firstVNode = current.value;
    current.value = htmlToVNode(htmlTwo, { importFn: TEST_IMPORT_FN, previous: firstVNode });
    await flushPromises();
    await nextTick();

    const keptAfterSecond = container.querySelector("[data-keep='refetch']");
    expect(keptAfterSecond).toBe(kept);
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("two");

    const secondVNode = current.value;
    current.value = htmlToVNode(htmlThree, { importFn: TEST_IMPORT_FN, previous: secondVNode });
    await flushPromises();
    await nextTick();

    expect(container.querySelector("[data-keep='refetch']")).not.toBe(keptAfterSecond);
    expect(container.querySelector("[data-keep='refetch']")!.textContent).toBe("changed later");
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("three");
    expect(container.innerHTML).toContain("counter : 0");
  });

  it("patches a fetched fragment root from marked HTML", async () => {
    const htmlOne = await renderToString(
      renderOnigiriWithMarkers(
        [
          VServerComponentType.Fragment,
          [
            [VServerComponentType.Element, "p", { "data-keep": "fragment" }, "same"],
            [VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"],
            [VServerComponentType.Element, "p", { "data-changing": "yes" }, "one"],
          ],
        ],
        { importFn: TEST_IMPORT_FN },
      )!,
    );
    const htmlTwo = await renderToString(
      renderOnigiriWithMarkers(
        [
          VServerComponentType.Fragment,
          [
            [VServerComponentType.Element, "p", { "data-keep": "fragment" }, "same"],
            [VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"],
            [VServerComponentType.Element, "p", { "data-changing": "yes" }, "two"],
          ],
        ],
        { importFn: TEST_IMPORT_FN },
      )!,
    );
    const htmlThree = await renderToString(
      renderOnigiriWithMarkers(
        [
          VServerComponentType.Fragment,
          [
            [VServerComponentType.Element, "p", { "data-keep": "fragment" }, "changed later"],
            [VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"],
            [VServerComponentType.Element, "p", { "data-changing": "yes" }, "three"],
          ],
        ],
        { importFn: TEST_IMPORT_FN },
      )!,
    );
    const container = document.createElement("div");
    document.body.append(container);

    const current = shallowRef<VNode | undefined>(
      htmlToVNode(htmlOne, { importFn: TEST_IMPORT_FN }),
    );
    const app = createApp({ setup: () => () => current.value });
    apps.push(app);
    app.mount(container);
    await flushPromises();
    await nextTick();

    const kept = container.querySelector("[data-keep='fragment']");
    expect(kept).not.toBeNull();
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("one");

    const firstVNode = current.value;
    current.value = htmlToVNode(htmlTwo, { importFn: TEST_IMPORT_FN, previous: firstVNode });
    await flushPromises();
    await nextTick();

    const keptAfterSecond = container.querySelector("[data-keep='fragment']");
    expect(keptAfterSecond).toBe(kept);
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("two");

    const secondVNode = current.value;
    current.value = htmlToVNode(htmlThree, { importFn: TEST_IMPORT_FN, previous: secondVNode });
    await flushPromises();
    await nextTick();

    expect(container.querySelector("[data-keep='fragment']")).not.toBe(keptAfterSecond);
    expect(container.querySelector("[data-keep='fragment']")!.textContent).toBe("changed later");
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("three");
  });

  it("uses adopted DOM HTML when a hydrated tree is passed as previous", async () => {
    const htmlOne = await renderToString(
      renderOnigiriWithMarkers([
        VServerComponentType.Fragment,
        [
          [VServerComponentType.Element, "p", { "data-keep": "adopted" }, "same"],
          [VServerComponentType.Comment, "split"],
          [VServerComponentType.Element, "p", { "data-changing": "yes" }, "one"],
        ],
      ])!,
    );
    const htmlTwo = await renderToString(
      renderOnigiriWithMarkers([
        VServerComponentType.Fragment,
        [
          [VServerComponentType.Element, "p", { "data-keep": "adopted" }, "same"],
          [VServerComponentType.Comment, "split"],
          [VServerComponentType.Element, "p", { "data-changing": "yes" }, "two"],
        ],
      ])!,
    );
    const container = document.createElement("div");
    container.innerHTML = htmlOne;
    document.body.append(container);

    const current = shallowRef<VNode | undefined>(domToVNode(container.firstChild as Node));
    const app = createSSRApp({ setup: () => () => current.value });
    apps.push(app);
    app.mount(container);
    await nextTick();

    const kept = container.querySelector("[data-keep='adopted']");
    expect(kept).not.toBeNull();
    expect(vnodeShape(current.value)).toMatchInlineSnapshot(`
      {
        "children": [
          "static(1)",
          "comment:split",
          "static(1)",
        ],
        "type": "Fragment",
      }
    `);
    expect(adoptedStaticHtml(current.value)).toEqual([
      '<p data-keep="adopted">same</p>',
      '<p data-changing="yes">one</p>',
    ]);

    current.value = htmlToVNode(htmlTwo, { previous: current.value });
    await nextTick();

    expect(container.querySelector("[data-keep='adopted']")).toBe(kept);
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("two");
  });

  it("replaces a static run when fetched HTML is rebuilt without previous", async () => {
    const html = await renderToString(
      renderOnigiriWithMarkers(
        [
          VServerComponentType.Element,
          "section",
          undefined,
          [[VServerComponentType.Element, "p", { "data-keep": "no-previous" }, "same"]],
        ],
        { importFn: TEST_IMPORT_FN },
      )!,
    );
    const container = document.createElement("div");
    document.body.append(container);

    const current = shallowRef<VNode | undefined>(htmlToVNode(html, { importFn: TEST_IMPORT_FN }));
    const app = createApp({ setup: () => () => current.value });
    apps.push(app);
    app.mount(container);
    await nextTick();

    const kept = container.querySelector("[data-keep='no-previous']");
    expect(kept).not.toBeNull();

    current.value = htmlToVNode(html, { importFn: TEST_IMPORT_FN });
    await nextTick();

    expect(container.querySelector("[data-keep='no-previous']")).not.toBe(kept);
    expect(container.querySelector("[data-keep='no-previous']")!.textContent).toBe("same");
  });

  it("reuses duplicate static runs from previous at most once each", () => {
    const previous = htmlToVNode(
      '<p data-repeat="same">same</p><!--split--><p data-repeat="same">same</p>',
      { importFn: TEST_IMPORT_FN },
    )!;
    const next = htmlToVNode(
      [
        '<p data-repeat="same">same</p>',
        "<!--split-->",
        '<p data-repeat="same">same</p>',
        "<!--split again-->",
        '<p data-repeat="same">same</p>',
      ].join(""),
      { importFn: TEST_IMPORT_FN, previous },
    )!;
    const previousChildren = fragmentChildren(previous);
    const nextChildren = fragmentChildren(next);

    expect({
      first: nextChildren[0] === previousChildren[0],
      second: nextChildren[2] === previousChildren[2],
      thirdIsFresh:
        nextChildren[4] !== previousChildren[0] && nextChildren[4] !== previousChildren[2],
      shape: vnodeShape(next),
    }).toMatchInlineSnapshot(`
      {
        "first": true,
        "second": true,
        "shape": {
          "children": [
            "static(1)",
            "comment:split",
            "static(1)",
            "comment:split again",
            "static(1)",
          ],
          "type": "Fragment",
        },
        "thirdIsFresh": true,
      }
    `);
  });

  it("builds detached vnode shapes for marker-free fetched HTML", () => {
    expect([
      { input: "", output: vnodeShape(htmlToVNode("")) },
      { input: "plain text", output: vnodeShape(htmlToVNode("plain text")) },
      { input: "<!--plain-->", output: vnodeShape(htmlToVNode("<!--plain-->")) },
      { input: "<b>one</b><i>two</i>", output: vnodeShape(htmlToVNode("<b>one</b><i>two</i>")) },
    ]).toMatchInlineSnapshot(`
      [
        {
          "input": "",
          "output": "undefined",
        },
        {
          "input": "plain text",
          "output": "static(1)",
        },
        {
          "input": "<!--plain-->",
          "output": "comment:plain",
        },
        {
          "input": "<b>one</b><i>two</i>",
          "output": {
            "children": [
              "static(2)",
            ],
            "type": "Fragment",
          },
        },
      ]
    `);
  });

  it("skips through nested component marker comments while walking siblings", () => {
    const outer = [VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"] as const;
    const inner = [VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"] as const;
    const host = document.createElement("div");
    host.innerHTML = [
      `<!--${MARKER_COMPONENT}${encodeMarker(outer)}-->`,
      "<span>outer fallback body</span>",
      `<!--${MARKER_COMPONENT}${encodeMarker(inner)}-->`,
      "<span>inner fallback body</span>",
      `<!--${MARKER_COMPONENT_END}-->`,
      `<!--${MARKER_COMPONENT_END}-->`,
      "<p>after</p>",
    ].join("");

    expect(vnodeShape(htmlToVNode(host.innerHTML, { importFn: TEST_IMPORT_FN })))
      .toMatchInlineSnapshot(`
        {
          "children": [
            "comment:o:c[...]",
            "Suspense",
            "comment:/o:c",
            "static(1)",
          ],
          "type": "Fragment",
        }
      `);
  });

  it.each([
    { name: "component", data: `${MARKER_COMPONENT}[1,{"x":1},"/evil.js"` },
    { name: "teleport", data: `${MARKER_TELEPORT}[7,"#x"` },
    { name: "suspense", data: `${MARKER_SUSPENSE}[4,null` },
  ])("renders a malformed $name marker as a plain comment", ({ data }) => {
    const importFn = vi.fn(TEST_IMPORT_FN);
    const vnode = htmlToVNode(`<!--${data}--><p>after</p>`, { importFn });

    expect(vnodeShape(vnode)).toEqual({
      type: "Fragment",
      children: [`comment:${commentShape(data)}`, "static(1)"],
    });
    expect((vnode!.children as VNode[])[0]!.children).toBe(data);
    expect(importFn).not.toHaveBeenCalled();
  });

  it("drops ref and key attributes from adopted marker ancestors", () => {
    const inner = [VServerComponentType.Component, undefined, COUNTER_CHUNK, "default"] as const;
    const html = [
      '<div ref="r" key="k" ref_key="rk" ref_for="true" data-keep="yes">',
      `<!--${MARKER_COMPONENT}${encodeMarker(inner)}-->`,
      "<span>body</span>",
      `<!--${MARKER_COMPONENT_END}-->`,
      "</div>",
    ].join("");
    const vnode = htmlToVNode(html, { importFn: TEST_IMPORT_FN })!;

    expect(vnode.type).toBe("div");
    expect(vnode.props).toEqual({ "data-keep": "yes" });
    expect(vnode.key).toBeNull();
    expect(vnode.ref).toBeNull();
  });

  it("never mounts a component from a marker smuggled through raw server HTML", async () => {
    const evil = [VServerComponentType.Component, { x: 1 }, "/evil.js", "default"] as const;
    const smuggled = `<!--${MARKER_COMPONENT}${encodeMarker(evil)}--><b>bait</b><!--${MARKER_COMPONENT_END}-->`;
    const input: VServerComponent = [
      VServerComponentType.Fragment,
      [
        [VServerComponentType.StaticHtml, smuggled, 3],
        [
          VServerComponentType.Element,
          "div",
          undefined,
          [[VServerComponentType.StaticHtml, `<p>${smuggled}</p>`, 1]],
        ],
        [VServerComponentType.Comment, `${MARKER_COMPONENT}[1,{},"/evil.js"]`],
      ],
    ];
    const html = await renderToString(renderOnigiriWithMarkers(input)!);
    const importFn = vi.fn(async (src: string) => {
      throw new Error(`must not load ${src}`);
    });
    const vnode = htmlToVNode(html, { importFn });
    const container = document.createElement("div");
    const app = createApp({ render: () => vnode });
    apps.push(app);
    app.mount(container);
    await flushPromises();

    expect(html).not.toContain(`<!--${MARKER_COMPONENT}[`);
    expect(vnodeShape(vnode)).toMatchInlineSnapshot(`
      {
        "children": [
          "comment: o:c[1,{"x":1},"/evil.js","default"]",
          "static(1)",
          "comment: /o:c",
          "static(1)",
          "comment: o:c[1,{},"/evil.js"]",
        ],
        "type": "Fragment",
      }
    `);
    expect(container.querySelectorAll("b")).toHaveLength(2);
    expect(importFn).not.toHaveBeenCalled();
  });

  it("never mounts a component from a bogus comment marker in raw server HTML", async () => {
    // Browsers also parse `</[>` as a comment, but happy-dom drops it.
    const smuggled = '<!o:c[1,{"x":1},"/evil.js","default"]><b>bait</b><!/o:c><![><!]>';
    const input: VServerComponent = [
      VServerComponentType.Element,
      "div",
      { innerHTML: smuggled },
      undefined,
    ];
    const html = await renderToString(renderOnigiriWithMarkers(input)!);
    const importFn = vi.fn(async (src: string) => {
      throw new Error(`must not load ${src}`);
    });
    const vnode = htmlToVNode(html, { importFn });
    const container = document.createElement("div");
    const app = createApp({ render: () => vnode });
    apps.push(app);
    app.mount(container);
    await flushPromises();

    expect(html).toBe(
      '<div><! o:c[1,{"x":1},"/evil.js","default"]><b>bait</b><! /o:c><! [><! ]></div>',
    );
    expect(vnodeShape(vnode)).toBe("static(1)");
    expect(container.querySelectorAll("b")).toHaveLength(1);
    expect(importFn).not.toHaveBeenCalled();
  });
});

function expectHydrationComplaints(warn: MockInstance, error: MockInstance): string[] {
  return [...warn.mock.calls, ...error.mock.calls]
    .map((call) => String(call[0]))
    .filter((message) => /hydrat|mismatch/i.test(message));
}

function fragmentChildren(vnode: VNode): VNode[] {
  expect(String(vnode.type)).toBe("Symbol(v-fgt)");
  expect(Array.isArray(vnode.children)).toBe(true);
  return vnode.children as VNode[];
}

function adoptedStaticHtml(vnode: VNode | undefined): string[] {
  if (!vnode) return [];
  if (String(vnode.type) === "Symbol(v-stc)") return [String(vnode.children)];
  if (
    (String(vnode.type) === "Symbol(v-fgt)" || typeof vnode.type === "string") &&
    Array.isArray(vnode.children)
  ) {
    return vnode.children.flatMap((child) => adoptedStaticHtml(child as VNode));
  }
  return [];
}

function vnodeShape(vnode: VNode | undefined): unknown {
  if (!vnode) return "undefined";
  if (String(vnode.type) === "Symbol(v-stc)") {
    const staticVNode = vnode as VNode & { staticCount: number };
    return `static(${staticVNode.staticCount})`;
  }
  if (String(vnode.type) === "Symbol(v-cmt)") return `comment:${commentShape(vnode.children)}`;
  if (String(vnode.type) === "Symbol(v-fgt)")
    return {
      type: "Fragment",
      children: childrenShape(vnode.children),
    };
  if (vnode.type === Suspense) return "Suspense";
  if (typeof vnode.type === "string")
    return {
      type: vnode.type,
      children: childrenShape(vnode.children),
    };
  return String(vnode.type);
}

function childrenShape(children: VNode["children"]): unknown[] | string | null {
  if (Array.isArray(children)) return children.map((child) => vnodeShape(child as VNode));
  return typeof children === "string" ? children : null;
}

function commentShape(children: VNode["children"]): string {
  const value = String(children ?? "");
  if (value.startsWith("o:c[")) return "o:c[...]";
  if (value.startsWith("o:t[")) return "o:t[...]";
  if (value.startsWith("o:s[")) return "o:s[...]";
  return value;
}
