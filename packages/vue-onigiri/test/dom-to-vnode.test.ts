// @vitest-environment happy-dom

import { flushPromises } from "@vue/test-utils";
import { renderToString } from "@vue/server-renderer";
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
  type Component,
  type VNode,
} from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { domToVNode, htmlToVNode } from "../src/runtime/dom-to-vnode";
import { provideMarkerNonce } from "../src/server/ssr-boundary";
import type { ImportFn } from "../src/runtime/utils";
import {
  componentMarkerHtml,
  hydrationComplaints,
  islandComponent,
  MARKERS,
  NONCE,
} from "./helpers";
import Counter from "./fixtures/components/Counter.vue";

const COUNTER_CHUNK = "/test/fixtures/components/Counter.vue";
const INJECTED_CHUNK = "/test/dom-to-vnode/Injected.vue";

interface HydrationCase {
  /** Human-readable fixture label. */
  name: string;
  /** Server HTML: a raw string, or an island rendered with the marker nonce. */
  server: string | Component;
  /** A static DOM node that should be adopted, not replaced. */
  identitySelector?: string;
  /** Number of counter buttons to click after hydration. */
  clickButtons?: number;
  /** Provide this value from the surrounding page app. */
  provideTest?: string;
  /** Expected text after hydration. */
  expectedText?: string;
}

const Injected = defineComponent({
  name: "Injected",
  setup(): () => VNode {
    const value = inject("test");
    return () => h("p", { "data-injected": "yes" }, `injection: ${value}`);
  },
});
(Injected as any).__onigiriDescriptor = { chunk: INJECTED_CHUNK };

const COMPONENTS = { Counter, Injected };

const TEST_IMPORT_FN: ImportFn = async (src: string) => {
  if (src === COUNTER_CHUNK) return Counter as any;
  if (src === INJECTED_CHUNK) return Injected as any;
  throw new Error(`Unexpected chunk ${src}`);
};

const OPTIONS = { importFn: TEST_IMPORT_FN, nonce: NONCE };

function island(template: string): Component {
  return islandComponent(template, () => ({}), COMPONENTS);
}

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
      server: "<div><div data-keep>1</div><div>2</div></div>",
      identitySelector: "[data-keep]",
    },
    {
      name: "client component with static siblings",
      server: island(`<div><div data-keep>1</div><div>2</div><Counter v-load-client /></div>`),
      identitySelector: "[data-keep]",
      clickButtons: 1,
    },
    {
      name: "fragment root",
      server: island(`<p data-keep="one">one</p><p>two</p>`),
      identitySelector: "[data-keep='one']",
    },
    { name: "root text", server: "plain root", expectedText: "plain root" },
    { name: "root plain comment", server: "<!--plain root comment-->" },
    {
      name: "client component with static and nested client slots",
      server: island(
        `<div><Counter v-load-client><div><div data-keep>s</div><Counter v-load-client /></div></Counter></div>`,
      ),
      identitySelector: "[data-keep]",
      clickButtons: 2,
    },
    {
      name: "leading empty comment and comments between static runs",
      server: '<!--[--><!----><p data-keep="lead">a</p><!--split--><p>b</p><!--]-->',
      identitySelector: "[data-keep='lead']",
    },
    {
      name: "page provide flows through client loader",
      server: island(`<div><Injected v-load-client /></div>`),
      provideTest: "from page",
      expectedText: "injection: from page",
    },
  ])(
    "hydrates marked HTML without mismatch: $name",
    async ({ server, identitySelector, clickButtons, provideTest, expectedText }) => {
      const html =
        typeof server === "string"
          ? server
          : await renderToString(
              createSSRApp({
                setup: () => {
                  if (provideTest) provide("test", provideTest);
                  return () => h(server);
                },
              }),
              provideMarkerNonce({ onigiriNonce: NONCE }),
            );
      const container = document.createElement("div");
      container.innerHTML = html;
      document.body.append(container);
      const adoptedNode = identitySelector ? container.querySelector(identitySelector) : undefined;
      if (identitySelector) expect(adoptedNode).not.toBeNull();

      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      const clientApp = createSSRApp({
        setup: () => {
          if (provideTest) provide("test", provideTest);
          return () =>
            h(Suspense, null, {
              default: () => domToVNode(container.firstChild as Node, OPTIONS),
            });
        },
      });
      apps.push(clientApp);
      clientApp.mount(container);
      await flushPromises();
      await nextTick();

      expect(hydrationComplaints(warn, error)).toEqual([]);
      if (identitySelector) expect(container.querySelector(identitySelector)).toBe(adoptedNode);
      if (clickButtons) {
        const buttons = [...container.querySelectorAll("button")];
        expect(buttons).toHaveLength(clickButtons);
        for (const button of buttons) button.click();
        await nextTick();
        expect(container.textContent!.match(/counter : 1/g)).toHaveLength(clickButtons);
      }
      if (expectedText) expect(container.textContent).toContain(expectedText);
    },
  );

  it("collapses marker-free DOM into static runs while preserving marked islands", async () => {
    const container = document.createElement("div");
    container.innerHTML = await renderToString(
      createSSRApp(island(`<div><div>1</div><div>2</div><Counter v-load-client /></div>`)),
      provideMarkerNonce({ onigiriNonce: NONCE }),
    );
    document.body.append(container);

    expect(vnodeShape(domToVNode(container.firstChild as Node, OPTIONS))).toMatchInlineSnapshot(`
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
    const section = (kept: string, changing: string) =>
      `<section data-root="refetch"><p data-keep="refetch">${kept}</p>` +
      componentMarkerHtml(COUNTER_CHUNK, "<div>counter : 0</div>") +
      `<p data-changing="yes">${changing}</p></section>`;
    const container = document.createElement("div");
    document.body.append(container);

    const current = shallowRef<VNode | undefined>(
      htmlToVNode(section("unchanged", "one"), OPTIONS),
    );
    const app = createApp({ setup: () => () => current.value });
    apps.push(app);
    app.mount(container);
    await flushPromises();
    await nextTick();

    const kept = container.querySelector("[data-keep='refetch']");
    expect(kept).not.toBeNull();
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("one");

    current.value = htmlToVNode(section("unchanged", "two"), {
      ...OPTIONS,
      previous: current.value,
    });
    await flushPromises();
    await nextTick();

    const keptAfterSecond = container.querySelector("[data-keep='refetch']");
    expect(keptAfterSecond).toBe(kept);
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("two");

    current.value = htmlToVNode(section("changed later", "three"), {
      ...OPTIONS,
      previous: current.value,
    });
    await flushPromises();
    await nextTick();

    expect(container.querySelector("[data-keep='refetch']")).not.toBe(keptAfterSecond);
    expect(container.querySelector("[data-keep='refetch']")!.textContent).toBe("changed later");
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("three");
    expect(container.innerHTML).toContain("counter : 0");
  });

  it("patches a fetched fragment root from marked HTML", async () => {
    const fragment = (kept: string, changing: string) =>
      `<!--[--><p data-keep="fragment">${kept}</p>` +
      componentMarkerHtml(COUNTER_CHUNK, "<div>counter : 0</div>") +
      `<p data-changing="yes">${changing}</p><!--]-->`;
    const container = document.createElement("div");
    document.body.append(container);

    const current = shallowRef<VNode | undefined>(htmlToVNode(fragment("same", "one"), OPTIONS));
    const app = createApp({ setup: () => () => current.value });
    apps.push(app);
    app.mount(container);
    await flushPromises();
    await nextTick();

    const kept = container.querySelector("[data-keep='fragment']");
    expect(kept).not.toBeNull();

    current.value = htmlToVNode(fragment("same", "two"), { ...OPTIONS, previous: current.value });
    await flushPromises();
    await nextTick();

    expect(container.querySelector("[data-keep='fragment']")).toBe(kept);
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("two");

    current.value = htmlToVNode(fragment("changed later", "three"), {
      ...OPTIONS,
      previous: current.value,
    });
    await flushPromises();
    await nextTick();

    expect(container.querySelector("[data-keep='fragment']")).not.toBe(kept);
    expect(container.querySelector("[data-keep='fragment']")!.textContent).toBe("changed later");
  });

  it("uses adopted DOM HTML when a hydrated tree is passed as previous", async () => {
    const htmlOne =
      '<!--[--><p data-keep="adopted">same</p><!--split--><p data-changing="yes">one</p><!--]-->';
    const htmlTwo =
      '<!--[--><p data-keep="adopted">same</p><!--split--><p data-changing="yes">two</p><!--]-->';
    const container = document.createElement("div");
    container.innerHTML = htmlOne;
    document.body.append(container);

    const current = shallowRef<VNode | undefined>(
      domToVNode(container.firstChild as Node, OPTIONS),
    );
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

    current.value = htmlToVNode(htmlTwo, { ...OPTIONS, previous: current.value });
    await nextTick();

    expect(container.querySelector("[data-keep='adopted']")).toBe(kept);
    expect(container.querySelector("[data-changing='yes']")!.textContent).toBe("two");
  });

  it("replaces a static run when fetched HTML is rebuilt without previous", async () => {
    const html = '<section><p data-keep="no-previous">same</p></section>';
    const container = document.createElement("div");
    document.body.append(container);

    const current = shallowRef<VNode | undefined>(htmlToVNode(html, OPTIONS));
    const app = createApp({ setup: () => () => current.value });
    apps.push(app);
    app.mount(container);
    await nextTick();

    const kept = container.querySelector("[data-keep='no-previous']");
    expect(kept).not.toBeNull();

    current.value = htmlToVNode(html, OPTIONS);
    await nextTick();

    expect(container.querySelector("[data-keep='no-previous']")).not.toBe(kept);
    expect(container.querySelector("[data-keep='no-previous']")!.textContent).toBe("same");
  });

  it("reuses duplicate static runs from previous at most once each", () => {
    const previous = htmlToVNode(
      '<p data-repeat="same">same</p><!--split--><p data-repeat="same">same</p>',
      OPTIONS,
    )!;
    const next = htmlToVNode(
      [
        '<p data-repeat="same">same</p>',
        "<!--split-->",
        '<p data-repeat="same">same</p>',
        "<!--split again-->",
        '<p data-repeat="same">same</p>',
      ].join(""),
      { ...OPTIONS, previous },
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
      { input: "", output: vnodeShape(htmlToVNode("", OPTIONS)) },
      { input: "plain text", output: vnodeShape(htmlToVNode("plain text", OPTIONS)) },
      { input: "<!--plain-->", output: vnodeShape(htmlToVNode("<!--plain-->", OPTIONS)) },
      {
        input: "<b>one</b><i>two</i>",
        output: vnodeShape(htmlToVNode("<b>one</b><i>two</i>", OPTIONS)),
      },
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
    const html =
      componentMarkerHtml(
        COUNTER_CHUNK,
        "<span>outer body</span>" + componentMarkerHtml(COUNTER_CHUNK, "<span>inner body</span>"),
      ) + "<p>after</p>";

    expect(vnodeShape(htmlToVNode(html, OPTIONS))).toMatchInlineSnapshot(`
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
    { name: "component", data: `${MARKERS.component}[1,{"x":1},"/evil.js"` },
    { name: "teleport", data: `${MARKERS.teleport}["#x",false` },
    { name: "teleport without Vue's anchors", data: `${MARKERS.teleport}["#x",false,""]` },
  ])("renders a malformed $name marker as a plain comment", ({ data }) => {
    const importFn = vi.fn(TEST_IMPORT_FN);
    const vnode = htmlToVNode(`<!--${data}--><p>after</p>`, { importFn, nonce: NONCE });

    expect(vnodeShape(vnode)).toEqual({
      type: "Fragment",
      children: [`comment:${commentShape(data)}`, "static(1)"],
    });
    expect((vnode!.children as VNode[])[0]!.children).toBe(data);
    expect(importFn).not.toHaveBeenCalled();
  });

  it("drops ref and key attributes from adopted marker ancestors", () => {
    const html =
      '<div ref="r" key="k" ref_key="rk" ref_for="true" data-keep="yes">' +
      componentMarkerHtml(COUNTER_CHUNK, "<span>body</span>") +
      "</div>";
    const vnode = htmlToVNode(html, OPTIONS)!;

    expect(vnode.type).toBe("div");
    expect(vnode.props).toEqual({ "data-keep": "yes" });
    expect(vnode.key).toBeNull();
    expect(vnode.ref).toBeNull();
  });

  it("never mounts a component from a marker without the render's nonce", async () => {
    const forged = (prefix: string) =>
      `<!--${prefix}[1,{"x":1},"/evil.js","default"]--><b>bait</b><!--/${prefix}-->`;
    const html = [forged("o:c"), forged("o:c:0ther0nce"), "<p>after</p>"].join("");
    const importFn = vi.fn(async (src: string) => {
      throw new Error(`must not load ${src}`);
    });
    const vnode = htmlToVNode(html, { importFn, nonce: NONCE });
    const container = document.createElement("div");
    const app = createApp({ render: () => vnode });
    apps.push(app);
    app.mount(container);
    await flushPromises();

    expect(vnodeShape(vnode)).toMatchInlineSnapshot(`
      {
        "children": [
          "comment:o:c[1,{"x":1},"/evil.js","default"]",
          "static(1)",
          "comment:/o:c",
          "comment:o:c:0ther0nce[1,{"x":1},"/evil.js","default"]",
          "static(1)",
          "comment:/o:c:0ther0nce",
          "static(1)",
        ],
        "type": "Fragment",
      }
    `);
    expect(container.querySelectorAll("b")).toHaveLength(2);
    expect(importFn).not.toHaveBeenCalled();
  });

  it("refuses a nonce that is not alphanumeric", () => {
    expect(() => htmlToVNode("<p></p>", { nonce: "a[b" })).toThrow(/alphanumeric/);
  });

  it.each([
    ["a wrong type tag", `[2,null,"/x.vue"]`],
    ["a non-string chunk", `[1,null,5]`],
    ["string props", `[1,"props","/x.vue"]`],
    ["array props", `[1,[],"/x.vue"]`],
    ["a non-string export", `[1,null,"/x.vue",5]`],
    ["a null export", `[1,null,"/x.vue",null]`],
    ["non-string slot HTML", `[1,null,"/x.vue","default",{"default":1}]`],
    ["array slots", `[1,null,"/x.vue","default",["<b></b>"]]`],
    ["an object instead of a tuple", `{"0":1,"2":"/x.vue"}`],
    ["broken JSON", `[1,null,"/x.vue"`],
  ])("keeps a nonce-bound component marker with %s as a plain comment", async (_, json) => {
    const importFn = vi.fn(async () => Counter as any);
    const comment = `${MARKERS.component}${json}`;
    const vnode = htmlToVNode(`<!--${comment}--><b>body</b><!--${MARKERS.componentEnd}-->`, {
      importFn,
      nonce: NONCE,
    });
    const container = document.createElement("div");
    const app = createApp({ render: () => vnode });
    apps.push(app);
    app.mount(container);
    await flushPromises();

    expect(fragmentChildren(vnode!).map((child) => child.children)).toEqual([
      comment,
      expect.anything(),
      MARKERS.componentEnd,
    ]);
    expect(container.querySelector("b")?.textContent).toBe("body");
    expect(importFn).not.toHaveBeenCalled();
  });

  it.each([
    ["a non-string target", `[1,false,"<i></i>"]`],
    ["a non-boolean disabled flag", `["#t","no","<i></i>"]`],
    ["non-string HTML", `["#t",false,1]`],
    ["broken JSON", `["#t",false`],
  ])("keeps a nonce-bound teleport marker with %s as a plain comment", (_, json) => {
    const comment = `${MARKERS.teleport}${json}`;
    const vnode = htmlToVNode(`<!--${comment}--><!--teleport start--><!--teleport end-->`, {
      nonce: NONCE,
    });

    expect(fragmentChildren(vnode!).map((child) => child.children)).toEqual([
      comment,
      "teleport start",
      "teleport end",
    ]);
  });

  it("does not count an invalid open marker when looking for the closing one", () => {
    const html =
      componentMarkerHtml(COUNTER_CHUNK, `<!--${MARKERS.component}[2]--><span>body</span>`) +
      "<p data-after>after</p>";
    const vnode = htmlToVNode(html, OPTIONS);

    expect(vnodeShape(vnode)).toMatchInlineSnapshot(`
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
});

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

/** Drop the test nonce and collapse marker payloads, so shapes read like the wire format. */
function commentShape(children: VNode["children"]): string {
  const value = String(children ?? "").replaceAll(`:${NONCE}`, "");
  if (value !== String(children ?? "") && /^o:[ct]\[/.test(value))
    return `${value.slice(0, 3)}[...]`;
  return value;
}
