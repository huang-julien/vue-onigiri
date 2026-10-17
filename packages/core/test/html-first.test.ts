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
import {
  createMarkerSet,
  decodeMarker,
  type VServerComponentComponent,
} from "@vue-onigiri/shared";
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

/** Compile a template as Vue SSR with the onigiri transform and evaluate it against local deps. */
function compileSsr(source: string): (...args: any[]) => void {
  const { code, errors } = compileTemplate({
    source,
    filename: "Island.vue",
    id: "island",
    ssr: true,
    compilerOptions: { nodeTransforms: [ssrLoadClientTransform] },
  });
  expect(errors).toEqual([]);
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

function islandComponent(template: string, state: () => Record<string, unknown>): Component {
  return defineComponent({
    components: { Badge, Counter },
    setup: state,
    ssrRender: compileSsr(template),
  });
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

  it("refuses to render without a nonce in the SSR context", async () => {
    const island = islandComponent(`<div><Badge v-load-client label="x" /></div>`, () => ({}));
    await expect(renderToString(createSSRApp(island), {})).rejects.toThrow(/marker nonce/);
  });

  it("only touches SSR compiles", () => {
    const source = `<Badge v-load-client="flag" label="x" />`;
    const ssr = compileTemplate({
      source,
      filename: "Island.vue",
      id: "island",
      ssr: true,
      compilerOptions: { nodeTransforms: [ssrLoadClientTransform] },
    }).code;
    const client = compileTemplate({
      source,
      filename: "Island.vue",
      id: "island",
      compilerOptions: { nodeTransforms: [ssrLoadClientTransform] },
    }).code;
    expect(ssr).toContain("from '@vue-onigiri/core/runtime/ssr-boundary'");
    expect(ssr).toContain(
      '_onigiriRenderClient(_component_Badge, _mergeProps({ label: "x" }, _attrs), null, _parent, _ctx.flag)',
    );
    expect(ssr).not.toContain("load-client");
    expect(client).toContain('_resolveDirective("load-client")');
    expect(client).not.toContain("ssr-boundary");
  });
});
