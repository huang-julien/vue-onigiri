// @vitest-environment happy-dom

import { flushPromises } from "@vue/test-utils";
import { renderToString, type SSRContext } from "@vue/server-renderer";
import {
  createApp,
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  Suspense,
  Teleport,
  type App,
  type Component,
} from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { domToVNode, htmlToVNode } from "../src/runtime/dom-to-vnode";
import { provideMarkerNonce } from "../src/server/ssr-boundary";
import type { ImportFn } from "../src/runtime/utils";
import {
  Badge,
  BADGE_CHUNK,
  compileCode,
  compileSsr,
  hydrationComplaints,
  islandComponent as baseIsland,
  MARKERS,
  markerTuples,
  NONCE,
  stripMarkers,
  teleportTuples,
  type CompileOptions,
} from "./helpers";
import Counter from "./fixtures/components/Counter.vue";

const COUNTER_CHUNK = "/test/fixtures/components/Counter.vue";
const ASYNC_BADGE_CHUNK = "/test/html-first/AsyncBadge.vue";
const PORTAL_CHUNK = "/test/html-first/Portal.vue";
const FORGED = `<!--o:c[1,{"label":"evil"},"/evil.vue","default"]--><em>evil</em><!--/o:c-->`;

const AsyncChild = defineComponent({
  name: "AsyncChild",
  async setup() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return () => h("section", { "data-async": "" }, "resolved");
  },
});

const AsyncBadge = defineComponent({
  name: "AsyncBadge",
  async setup() {
    await new Promise((resolve) => setTimeout(resolve, 5));
    return () => h("strong", { "data-async-badge": "" }, "async badge");
  },
});
(AsyncBadge as any).__onigiriDescriptor = { chunk: ASYNC_BADGE_CHUNK };

/** Client component whose own template teleports; compiled with the transform like any SFC. */
const Portal = defineComponent({
  name: "Portal",
  ssrRender: compileSsr(
    `<div data-portal><Teleport to="#target"><i data-own>own</i></Teleport><slot /></div>`,
  ),
  render() {
    return h("div", { "data-portal": "" }, [
      h(Teleport, { to: "#target" }, [h("i", { "data-own": "" }, "own")]),
      this.$slots.default?.(),
    ]);
  },
});
(Portal as any).__onigiriDescriptor = { chunk: PORTAL_CHUNK };

const TEST_IMPORT_FN: ImportFn = async (src) => {
  if (src === BADGE_CHUNK) return Badge as any;
  if (src === COUNTER_CHUNK) return Counter as any;
  if (src === ASYNC_BADGE_CHUNK) return AsyncBadge as any;
  if (src === PORTAL_CHUNK) return Portal as any;
  throw new Error(`Unexpected chunk ${src}`);
};

const Wrapper = defineComponent({
  name: "Wrapper",
  setup(_props, { slots }) {
    return () => h("section", { "data-wrapper": "" }, slots.default?.());
  },
});

/** Template-compiled scoped parent: its slot content gets Vue's `_scopeId` (`data-v-wrap-s`). */
const ScopedWrap = defineComponent({
  name: "ScopedWrap",
  __scopeId: "data-v-wrap",
  ssrRender: compileSsr(`<section class="w"><slot /></section>`, {
    plain: true,
    scoped: true,
    id: "wrap",
  }),
});

const COMPONENTS = { AsyncBadge, AsyncChild, Badge, Counter, Portal, ScopedWrap, Wrapper };

function islandComponent(
  template: string,
  state: () => Record<string, unknown>,
  options: CompileOptions = {},
): Component {
  return baseIsland(template, state, COMPONENTS, options);
}

/** The same template as plain Vue sees it, directive removed. */
function plainTemplate(template: string): string {
  return template.replace(/ v-load-client(?:="[^"]*")?/g, "");
}

describe("html-first SSR markers", () => {
  const apps: App[] = [];

  afterEach(() => {
    for (const app of apps.splice(0)) app.unmount();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  /** Render with a nonce, place teleports in `#target` like a host page would, then hydrate. */
  async function renderAndHydrate(island: Component) {
    const context: SSRContext = provideMarkerNonce({ onigiriNonce: NONCE });
    const html = await renderToString(createSSRApp(island), context);
    const container = document.createElement("div");
    container.innerHTML = html;
    const target = document.createElement("div");
    target.id = "target";
    target.innerHTML = context.teleports?.["#target"] ?? "";
    document.body.append(container, target);
    const importFn = vi.fn(TEST_IMPORT_FN);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createSSRApp({
      render: () =>
        h(Suspense, null, {
          default: () => domToVNode(container.firstChild as Node, { importFn, nonce: NONCE }),
        }),
    });
    apps.push(app);
    app.mount(container);
    await flushPromises();
    await vi.waitFor(() => expect(importFn.mock.results.length).toBe(importFn.mock.calls.length));
    await new Promise((resolve) => setTimeout(resolve, 20));
    await flushPromises();
    await nextTick();
    return {
      html,
      context,
      container,
      target,
      importFn,
      complaints: hydrationComplaints(warn, error),
    };
  }

  it("marks a client component with its props and keeps listeners out of the marker", async () => {
    const island = islandComponent(
      `<div><p data-keep>static</p><Badge v-load-client label="hi" :count="two" @click="noop" /></div>`,
      () => ({ two: 2, noop: () => {} }),
    );
    const before = await renderToString(createSSRApp(island), { onigiriNonce: NONCE });
    const keep = () => document.querySelector("[data-keep]");

    const { html, container, complaints } = await renderAndHydrate(island);
    const adopted = keep();
    expect(html).toBe(before);
    expect(markerTuples(html)).toEqual([[1, { label: "hi", count: 2 }, BADGE_CHUNK, "default"]]);
    expect(html).toContain(`<!--${MARKERS.componentEnd}-->`);
    expect(html).not.toContain("<!--o:c[");
    expect(complaints).toEqual([]);

    container.querySelector("button")!.click();
    await nextTick();
    expect(container.textContent).toContain("hi:3");
    expect(keep()).toBe(adopted);
  });

  it("reads the chunk from the descriptor the Vite plugin attached to the SFC", async () => {
    expect((Counter as any).__onigiriDescriptor).toEqual({
      chunk: COUNTER_CHUNK,
      export: "default",
    });
    const island = islandComponent(`<div><Counter v-load-client /></div>`, () => ({}));
    const html = await renderToString(createSSRApp(island), { onigiriNonce: NONCE });
    expect(markerTuples(html)).toEqual([[1, null, COUNTER_CHUNK, "default"]]);
  });

  it("throws for a v-load-client component without a descriptor", async () => {
    const Bare = defineComponent({ name: "Bare", render: () => h("p") });
    const island = baseIsland(`<div><Bare v-load-client /></div>`, () => ({}), { Bare });
    await expect(renderToString(createSSRApp(island), { onigiriNonce: NONCE })).rejects.toThrow(
      /no __onigiriDescriptor attached/,
    );
  });

  it("carries a default slot as pre-rendered HTML and hydrates it", async () => {
    const island = islandComponent(
      `<div><Counter v-load-client><b data-slot>slotted {{ label }}</b></Counter></div>`,
      () => ({ label: "text" }),
    );
    const { html, container, complaints } = await renderAndHydrate(island);
    const [tuple] = markerTuples(html);
    expect(tuple![4]).toEqual({ default: "<b data-slot>slotted text</b>" });
    // The slot renders inline once, inside Vue's own slot anchors, plus once in the marker.
    expect(html.replace(/<!--[^]*?-->/g, "").match(/data-slot/g)).toHaveLength(1);
    expect(html).toContain("<!--[--><b data-slot>slotted text</b><!--]-->");
    expect(complaints).toEqual([]);

    const slotted = container.querySelector("[data-slot]");
    container.querySelector("button")!.click();
    await nextTick();
    expect(container.textContent).toContain("counter : 1");
    expect(container.querySelector("[data-slot]")).toBe(slotted);
  });

  it("nests client components two levels deep through slot HTML", async () => {
    const island = islandComponent(
      `<div><Counter v-load-client><Counter v-load-client><i data-deep>deep</i></Counter></Counter></div>`,
      () => ({}),
    );
    const { html, container, importFn, complaints } = await renderAndHydrate(island);
    const [outer] = markerTuples(html);
    expect(String(outer![4]!.default)).toContain(`<!--${MARKERS.component}[`);
    expect(String(outer![4]!.default)).toContain("<i data-deep>deep</i>");
    expect(complaints).toEqual([]);
    expect(importFn).toHaveBeenCalledTimes(2);

    const deep = container.querySelector("[data-deep]");
    const buttons = [...container.querySelectorAll("button")];
    expect(buttons).toHaveLength(2);
    for (const button of buttons) button.click();
    await nextTick();
    expect(container.textContent!.match(/counter : 1/g)).toHaveLength(2);
    expect(container.querySelector("[data-deep]")).toBe(deep);
  });

  it("treats a forged marker inside v-html as a plain comment", async () => {
    const island = islandComponent(
      `<div><div data-raw v-html="forged"></div><Badge v-load-client label="real" /></div>`,
      () => ({ forged: FORGED }),
    );
    const { html, container, importFn, complaints } = await renderAndHydrate(island);
    expect(html).toContain(FORGED);
    expect(markerTuples(html)).toEqual([[1, { label: "real" }, BADGE_CHUNK, "default"]]);
    expect(complaints).toEqual([]);
    expect(importFn).toHaveBeenCalledTimes(1);
    expect(importFn).not.toHaveBeenCalledWith("/evil.vue", expect.anything());
    expect(container.querySelector("[data-raw]")!.innerHTML).toBe(FORGED);
    expect(container.querySelector("[data-badge='real']")).not.toBeNull();
  });

  it("renders inline without markers when the binding is false", async () => {
    const island = islandComponent(
      `<div><Badge v-load-client="false" label="inline" /></div>`,
      () => ({}),
    );
    const html = await renderToString(createSSRApp(island), { onigiriNonce: NONCE });
    expect(html).not.toContain("<!--o:c");
    expect(html).toContain('data-badge="inline"');
  });

  it("compiles a dynamic component to the statement twin, not a wrapper", () => {
    const ssr = compileCode(
      `<component :is="which" v-load-client="flag" label="x"><b>s</b></component>`,
    );
    expect(ssr).toContain(
      "_onigiriRenderClientVNode(_push, _resolveDynamicComponent(_ctx.which), ",
    );
    expect(ssr).toContain(", _parent, _ctx.flag)");
    expect(ssr).not.toContain("_createVNode(_onigiriClientBoundary");
  });

  it("keeps Vue's slot scope id as the last argument, after an always-present when", () => {
    const ssr = compileCode(
      `<ScopedWrap><Badge v-load-client label="x" /><component :is="which" v-load-client /></ScopedWrap>`,
      { scoped: true },
    );
    expect(ssr).toContain(
      '_push(_onigiriRenderClient(_component_Badge, { label: "x" }, null, _parent, undefined, _scopeId))',
    );
    expect(ssr).toContain(
      "_onigiriRenderClientVNode(_push, _resolveDynamicComponent(_ctx.which), null, null, _parent, undefined, _scopeId)",
    );
  });

  it("rewrites SSR compiles and only drops the directive in client compiles", () => {
    const source = `<Badge v-load-client="flag" label="x" />`;
    const ssr = compileCode(source);
    const client = compileCode(source, { ssr: false });
    expect(ssr).toContain("from 'vue-onigiri/server'");
    expect(ssr).toContain(
      '_onigiriRenderClient(_component_Badge, _mergeProps({ label: "x" }, _attrs), null, _parent, _ctx.flag)',
    );
    expect(ssr).not.toContain("load-client");
    expect(client).not.toContain("load-client");
    expect(client).not.toContain("vue-onigiri/server");
    expect(client).toContain('_createBlock(_component_Badge, { label: "x" })');
  });

  describe("teleport", () => {
    it("rewrites Vue's teleport call to the marking twin", () => {
      const ssr = compileCode(
        `<div><Teleport to="#target" :disabled="off"><b>t</b></Teleport></div>`,
      );
      expect(ssr).toContain("_onigiriRenderTeleport(_push, (_push) => {");
      expect(ssr).toContain('}, "#target", _ctx.off, _parent)');
      expect(ssr).not.toContain("_ssrRenderTeleport(_push");
    });

    it("writes the target and the content HTML, then hydrates the teleported client component", async () => {
      const island = islandComponent(
        `<div><p data-keep>main</p><Teleport to="#target"><span data-teleported>moved</span><Badge v-load-client label="tp" /></Teleport></div>`,
        () => ({}),
      );
      const { html, context, target, importFn, complaints } = await renderAndHydrate(island);
      const [tuple] = teleportTuples(html);
      expect(tuple![0]).toBe("#target");
      expect(tuple![1]).toBe(false);
      expect(tuple![2]).toContain("<span data-teleported>moved</span>");
      expect(tuple![2]).toContain(`<!--${MARKERS.component}[`);
      // Vue still fills the SSR context, so a host placing teleports keeps working.
      expect(context.teleports?.["#target"]).toContain("data-teleported");
      expect(html).toContain(`<!--${MARKERS.teleport}`);
      expect(complaints).toEqual([]);
      expect(importFn).toHaveBeenCalledWith(BADGE_CHUNK, "default");

      const teleported = target.querySelector("[data-teleported]");
      target.querySelector("button")!.click();
      await nextTick();
      expect(target.textContent).toContain("tp:1");
      expect(target.querySelector("[data-teleported]")).toBe(teleported);
    });

    it("leaves disabled content inline and adopts it", async () => {
      const island = islandComponent(
        `<div><Teleport to="#target" disabled><span data-inline>inline</span></Teleport></div>`,
        () => ({}),
      );
      const { html, container, target, complaints } = await renderAndHydrate(island);
      expect(teleportTuples(html)).toEqual([["#target", true]]);
      expect(complaints).toEqual([]);
      expect(container.querySelector("[data-inline]")).not.toBeNull();
      expect(target.querySelector("[data-inline]")).toBeNull();
    });

    it("mounts teleport content from the marker when the HTML is refetched", async () => {
      const island = islandComponent(
        `<div><Teleport to="#target"><span data-teleported>moved</span><Badge v-load-client label="re" /></Teleport></div>`,
        () => ({}),
      );
      const html = await renderToString(createSSRApp(island), { onigiriNonce: NONCE });
      const container = document.createElement("div");
      const target = document.createElement("div");
      target.id = "target";
      document.body.append(container, target);
      const vnode = htmlToVNode(html, { importFn: TEST_IMPORT_FN, nonce: NONCE });
      const app = createApp({ render: () => h(Suspense, null, { default: () => vnode }) });
      apps.push(app);
      app.mount(container);
      await vi.waitFor(() => expect(target.querySelector("button")).not.toBeNull());

      expect(target.querySelector("[data-teleported]")!.textContent).toBe("moved");
      expect(target.querySelector("[data-badge='re']")).not.toBeNull();
    });

    it("writes no marker for a teleport in a client component's own template", async () => {
      const island = islandComponent(
        `<div><Portal v-load-client><Teleport to="#target"><b data-slotted>slotted</b></Teleport></Portal></div>`,
        () => ({}),
      );
      const { html, target, complaints } = await renderAndHydrate(island);
      const [component] = markerTuples(html);
      // Only the island's own teleport, passed as slot content, is marked.
      expect(teleportTuples(html)).toHaveLength(1);
      expect(component![4]!.default).toContain(`<!--${MARKERS.teleport}`);
      expect(complaints).toEqual([]);
      expect(target.querySelector("[data-own]")).not.toBeNull();
      expect(target.querySelector("[data-slotted]")).not.toBeNull();
    });
  });

  describe("suspense", () => {
    it("needs no marker: the island HTML only ever holds resolved content", async () => {
      const island = islandComponent(
        `<div><Suspense><AsyncChild /><template #fallback><p data-fallback>loading</p></template></Suspense><Badge v-load-client label="after" /></div>`,
        () => ({}),
      );
      const { html, container, complaints } = await renderAndHydrate(island);
      expect(html).toContain("<section data-async>resolved</section>");
      expect(html).not.toContain("loading");
      expect(html).not.toMatch(/o:s/);
      expect(complaints).toEqual([]);
      expect(container.querySelector("[data-async]")!.textContent).toBe("resolved");
      expect(container.querySelector("[data-badge='after']")).not.toBeNull();
    });

    it("waits for an async client component before writing its marker", async () => {
      const island = islandComponent(
        `<div><Suspense><AsyncBadge v-load-client /><template #fallback><p>loading</p></template></Suspense></div>`,
        () => ({}),
      );
      const { html, container, complaints } = await renderAndHydrate(island);
      expect(markerTuples(html)).toEqual([[1, null, ASYNC_BADGE_CHUNK, "default"]]);
      expect(html).toContain(
        `-->${"<strong data-async-badge>async badge</strong>"}<!--${MARKERS.componentEnd}-->`,
      );
      expect(html).not.toContain("loading");
      expect(complaints).toEqual([]);
      expect(container.querySelector("[data-async-badge]")!.textContent).toBe("async badge");
    });
  });
});

/** Each case covers one codegen path the transform rewrites; `Wrapper` forces Vue's vnode slot branch. */
const PARITY_CASES: [name: string, template: string, markers: number][] = [
  ["static component", `<div><Badge v-load-client label="x" :count="two" /></div>`, 1],
  [
    "dynamic component with a slot",
    `<div><component :is="which" v-load-client><b>slot {{ label }}</b></component></div>`,
    1,
  ],
  [
    "component in a render-function child's slot",
    `<div><Wrapper><Badge v-load-client label="in-slot" /></Wrapper></div>`,
    1,
  ],
  [
    "dynamic component in a render-function child's slot",
    `<div><Wrapper><component :is="which" v-load-client><i>deep</i></component></Wrapper></div>`,
    1,
  ],
  [
    "component in a scoped compiled parent's slot",
    `<div><ScopedWrap><Badge v-load-client label="x" /></ScopedWrap></div>`,
    1,
  ],
  [
    "dynamic component in a scoped compiled parent's slot",
    `<div><ScopedWrap><component :is="which" v-load-client><i>deep</i></component></ScopedWrap></div>`,
    1,
  ],
  ["teleport", `<div><Teleport to="#target"><b>{{ label }}</b></Teleport></div>`, 1],
];

const PARITY_STATE = () => ({ two: 2, which: Counter, label: "text" });

describe.each(PARITY_CASES)("parity with plain Vue SSR: %s", (_name, template, markers) => {
  for (const scoped of [false, true]) {
    const suffix = scoped ? " (scoped)" : "";

    it(`is Vue's own output without a nonce${suffix}`, async () => {
      const island = islandComponent(template, PARITY_STATE, { scoped });
      const plain = islandComponent(plainTemplate(template), PARITY_STATE, { scoped, plain: true });
      const html = await renderToString(createSSRApp(island), {});
      expect(html).toBe(await renderToString(createSSRApp(plain), {}));
      expect(html).not.toMatch(/<!--o:[ct]/);
      if (scoped) expect(html).toContain("data-v-island");
    });

    it(`is Vue's own output plus markers with a nonce${suffix}`, async () => {
      const island = islandComponent(template, PARITY_STATE, { scoped });
      const plain = islandComponent(plainTemplate(template), PARITY_STATE, { scoped, plain: true });
      const html = await renderToString(
        createSSRApp(island),
        provideMarkerNonce({ onigiriNonce: NONCE }),
      );
      expect(markerTuples(html).length + teleportTuples(html).length).toBe(markers);
      // Scope ids are a rendering detail; the marker describes the component's props only.
      const [tuple] = markerTuples(html);
      if (tuple) expect(JSON.stringify(tuple[1] ?? {})).not.toContain("data-v-");
      expect(stripMarkers(html)).toBe(await renderToString(createSSRApp(plain), {}));
    });
  }
});
