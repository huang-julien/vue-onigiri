// @vitest-environment happy-dom

import { compileTemplate } from "@vue/compiler-sfc";
import { flushPromises } from "@vue/test-utils";
import { renderToString } from "@vue/server-renderer";
import * as serverRenderer from "@vue/server-renderer";
import * as Vue from "vue";
import {
  createSSRApp,
  defineComponent,
  h,
  nextTick,
  ref,
  Suspense,
  type App,
  type Component,
} from "vue";
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { domToVNode } from "../src/runtime/dom-to-vnode";
import { createMarkerSet, decodeMarker, type VServerComponentComponent } from "@vue-onigiri/shared";
import * as boundaryModule from "../src/runtime/ssr-boundary";
import { provideMarkerNonce } from "../src/runtime/ssr-boundary";
import { ssrLoadClientTransform } from "../src/vite/compiler/ssr-load-client";
import type { ImportFn } from "../src/runtime/utils";
import Counter from "./fixtures/components/Counter.vue";

const NONCE = "f00d1234abcd";
const BADGE_CHUNK = "/test/html-first/Badge.vue";
const COUNTER_CHUNK = "/test/fixtures/components/Counter.vue";
const FORGED = `<!--o:c[1,{"label":"evil"},"/evil.vue","default"]--><em>evil</em><!--/o:c-->`;

const Badge = defineComponent({
  name: "Badge",
  props: { label: { type: String, required: true }, count: { type: Number, default: 0 } },
  setup(props) {
    const clicks = ref(props.count);
    return () =>
      h("button", { "data-badge": props.label, onClick: () => clicks.value++ }, [
        `${props.label}:${clicks.value}`,
      ]);
  },
});
(Badge as any).__onigiriASTDescriptor = { chunk: BADGE_CHUNK };

const TEST_IMPORT_FN: ImportFn = async (src) => {
  if (src === BADGE_CHUNK) return Badge as any;
  if (src === COUNTER_CHUNK) return Counter as any;
  throw new Error(`Unexpected chunk ${src}`);
};

const Wrapper = defineComponent({
  name: "Wrapper",
  setup(_props, { slots }) {
    return () => h("section", { "data-wrapper": "" }, slots.default?.());
  },
});

interface CompileOptions {
  /** Compile without the onigiri transform, as plain Vue would. */
  plain?: boolean;
  scoped?: boolean;
  /** Scope id suffix, `data-v-<id>` when scoped. */
  id?: string;
  /** @default true */
  ssr?: boolean;
}

/** Compile a template with Vue's SFC compiler, with the onigiri transform unless `plain`. */
function compileCode(source: string, options: CompileOptions = {}): string {
  const { code, errors } = compileTemplate({
    source,
    filename: "Island.vue",
    id: options.id ?? "island",
    ssr: options.ssr ?? true,
    scoped: options.scoped,
    compilerOptions: { nodeTransforms: options.plain ? [] : [ssrLoadClientTransform] },
  });
  expect(errors).toEqual([]);
  return code;
}

/** Compile a template as Vue SSR and evaluate it against local deps. */
function compileSsr(source: string, options: CompileOptions = {}): (...args: any[]) => void {
  const code = compileCode(source, options);
  const deps: Record<string, unknown> = {
    vue: Vue,
    "vue/server-renderer": serverRenderer,
    "@vue-onigiri/core/runtime/ssr-boundary": boundaryModule,
  };
  const body = code
    .replace(/import \{([^}]*)\} from ["']([^"']+)["']/g, (_, names: string, path: string) => {
      return `const {${names.replaceAll(" as ", ": ")}} = __deps[${JSON.stringify(path)}]`;
    })
    .replace("export function ssrRender", "return function ssrRender");
  return new Function("__deps", body)(deps);
}

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

function islandComponent(
  template: string,
  state: () => Record<string, unknown>,
  options: CompileOptions = {},
): Component {
  return defineComponent({
    __scopeId: options.scoped ? "data-v-island" : undefined,
    components: { Badge, Counter, Wrapper, ScopedWrap },
    setup: state,
    ssrRender: compileSsr(template, options),
  });
}

/** The same template as plain Vue sees it, directive removed. */
function plainTemplate(template: string): string {
  return template.replace(/ v-load-client(?:="[^"]*")?/g, "");
}

function stripMarkers(html: string): string {
  return html.replace(new RegExp(`<!--/?o:[cts]:${NONCE}[\\s\\S]*?-->`, "g"), "");
}

function markerTuples(html: string): VServerComponentComponent[] {
  const prefix = `<!--${createMarkerSet(NONCE).component}`;
  const tuples: VServerComponentComponent[] = [];
  for (let at = html.indexOf(prefix); at !== -1; at = html.indexOf(prefix, at + 1)) {
    const end = html.indexOf("-->", at);
    tuples.push(decodeMarker(html.slice(at + prefix.length, end)));
  }
  return tuples;
}

function hydrationComplaints(warn: MockInstance, error: MockInstance): string[] {
  return [...warn.mock.calls, ...error.mock.calls]
    .map((call) => String(call[0]))
    .filter((message) => /hydrat|mismatch/i.test(message));
}

describe("html-first SSR markers", () => {
  const apps: App[] = [];

  afterEach(() => {
    for (const app of apps.splice(0)) app.unmount();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  async function renderAndHydrate(island: Component) {
    const context = provideMarkerNonce({ onigiriNonce: NONCE });
    const html = await renderToString(createSSRApp(island), context);
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    const importFn = vi.fn(TEST_IMPORT_FN);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const app = createSSRApp({
      render: () =>
        h(Suspense, null, {
          default: () =>
            domToVNode(container.firstChild as Node, { importFn, nonce: context.onigiriNonce }),
        }),
    });
    apps.push(app);
    app.mount(container);
    await flushPromises();
    await nextTick();
    return { html, container, importFn, complaints: hydrationComplaints(warn, error) };
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
    expect(html).toContain(`<!--${createMarkerSet(NONCE).componentEnd}-->`);
    expect(html).not.toContain("<!--o:c[");
    expect(complaints).toEqual([]);

    container.querySelector("button")!.click();
    await nextTick();
    expect(container.textContent).toContain("hi:3");
    expect(keep()).toBe(adopted);
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
    const markers = createMarkerSet(NONCE);
    const [outer] = markerTuples(html);
    expect(String(outer![4]!.default)).toContain(`<!--${markers.component}[`);
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

  it("only touches SSR compiles", () => {
    const source = `<Badge v-load-client="flag" label="x" />`;
    const ssr = compileCode(source);
    const client = compileCode(source, { ssr: false });
    expect(ssr).toContain("from '@vue-onigiri/core/runtime/ssr-boundary'");
    expect(ssr).toContain(
      '_onigiriRenderClient(_component_Badge, _mergeProps({ label: "x" }, _attrs), null, _parent, _ctx.flag)',
    );
    expect(ssr).not.toContain("load-client");
    expect(client).toContain('_resolveDirective("load-client")');
    expect(client).not.toContain("ssr-boundary");
  });
});

/** Each case covers one codegen path the transform rewrites; `Wrapper` forces Vue's vnode slot branch. */
const PARITY_CASES: [name: string, template: string][] = [
  ["static component", `<div><Badge v-load-client label="x" :count="two" /></div>`],
  [
    "dynamic component with a slot",
    `<div><component :is="which" v-load-client><b>slot {{ label }}</b></component></div>`,
  ],
  [
    "component in a render-function child's slot",
    `<div><Wrapper><Badge v-load-client label="in-slot" /></Wrapper></div>`,
  ],
  [
    "dynamic component in a render-function child's slot",
    `<div><Wrapper><component :is="which" v-load-client><i>deep</i></component></Wrapper></div>`,
  ],
  [
    "component in a scoped compiled parent's slot",
    `<div><ScopedWrap><Badge v-load-client label="x" /></ScopedWrap></div>`,
  ],
  [
    "dynamic component in a scoped compiled parent's slot",
    `<div><ScopedWrap><component :is="which" v-load-client><i>deep</i></component></ScopedWrap></div>`,
  ],
];

const PARITY_STATE = () => ({ two: 2, which: Counter, label: "text" });

describe.each(PARITY_CASES)("parity with plain Vue SSR: %s", (_name, template) => {
  for (const scoped of [false, true]) {
    const suffix = scoped ? " (scoped)" : "";

    it(`is Vue's own output without a nonce${suffix}`, async () => {
      const island = islandComponent(template, PARITY_STATE, { scoped });
      const plain = islandComponent(plainTemplate(template), PARITY_STATE, { scoped, plain: true });
      const html = await renderToString(createSSRApp(island), {});
      expect(html).toBe(await renderToString(createSSRApp(plain), {}));
      expect(html).not.toContain("<!--o:c");
      if (scoped) expect(html).toContain("data-v-island");
    });

    it(`is Vue's own output plus markers with a nonce${suffix}`, async () => {
      const island = islandComponent(template, PARITY_STATE, { scoped });
      const plain = islandComponent(plainTemplate(template), PARITY_STATE, { scoped, plain: true });
      const html = await renderToString(
        createSSRApp(island),
        provideMarkerNonce({ onigiriNonce: NONCE }),
      );
      const tuples = markerTuples(html);
      expect(tuples).toHaveLength(1);
      // Scope ids are a rendering detail; the marker describes the component's props only.
      expect(JSON.stringify(tuples[0]![1] ?? {})).not.toContain("data-v-");
      expect(stripMarkers(html)).toBe(await renderToString(createSSRApp(plain), {}));
    });
  }
});
