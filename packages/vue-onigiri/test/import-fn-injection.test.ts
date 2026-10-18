// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, Suspense } from "vue";
import { htmlToVNode } from "../src/runtime/dom-to-vnode";
import { onigiriPlugin } from "../src/runtime/plugin";
import { importFn as defaultImportFn } from "../src/manifest";
import { onigiriManifestPlugin } from "../src/vite/manifest";
import type { ImportFn } from "../src/runtime/utils";
import { componentMarkerHtml, NONCE } from "./helpers";

const Island = defineComponent({
  name: "Island",
  setup: () => () => h("div", "island-loaded"),
});

const ISLAND_HTML = componentMarkerHtml("/virtual/Island.vue", "");

const trackedImportFn = (result: any) => {
  const calls: any[][] = [];
  const fn = async (...args: any[]) => {
    calls.push(args);
    return result;
  };
  return { fn, calls };
};

const mountMarker = (importFn?: ImportFn, plugins: any[] = []) => {
  const { promise, resolve } = Promise.withResolvers();
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(
          Suspense,
          { onResolve: () => resolve(true) },
          { default: () => htmlToVNode(ISLAND_HTML, { importFn, nonce: NONCE }) },
        ),
    }),
    { global: { plugins } },
  );
  return { wrapper, resolved: promise };
};

describe("importFn resolution chain", () => {
  it("uses the app-level importFn provided by onigiriPlugin", async () => {
    const { fn, calls } = trackedImportFn(Island);
    const { wrapper, resolved } = mountMarker(undefined, [[onigiriPlugin, { importFn: fn }]]);
    await resolved;
    await flushPromises();
    expect(calls).toEqual([["/virtual/Island.vue", "default"]]);
    expect(wrapper.html()).toContain("island-loaded");
  });

  it("per-render importFn wins over the app-level one", async () => {
    const appFn = trackedImportFn(defineComponent({ setup: () => () => h("div", "from-app") }));
    const renderFn = trackedImportFn(Island);
    const { wrapper, resolved } = mountMarker(renderFn.fn as ImportFn, [
      [onigiriPlugin, { importFn: appFn.fn }],
    ]);
    await resolved;
    await flushPromises();
    expect(renderFn.calls.length).toBe(1);
    expect(appFn.calls.length).toBe(0);
    expect(wrapper.html()).toContain("island-loaded");
  });

  it("the `vue-onigiri/manifest` stub throws with setup guidance", async () => {
    await expect(defaultImportFn("/nope.vue")).rejects.toThrow(
      '[vue-onigiri] No chunk loader available for "/nope.vue": "vue-onigiri/manifest" is the stub',
    );
  });

  it("resolves slot markers through the app-level importFn", async () => {
    const { fn, calls } = trackedImportFn(Island);
    const html = componentMarkerHtml("/virtual/Outer.vue", "", undefined, {
      default: componentMarkerHtml("/virtual/Inner.vue", ""),
    });
    const Outer = defineComponent({
      setup:
        (_, { slots }) =>
        () =>
          h("section", slots.default?.()),
    });
    const outerFn = async (src: string) => (src === "/virtual/Outer.vue" ? Outer : fn(src));
    const { promise, resolve } = Promise.withResolvers();
    const wrapper = mount(
      defineComponent({
        setup: () => () =>
          h(
            Suspense,
            { onResolve: () => resolve(true) },
            { default: () => htmlToVNode(html, { nonce: NONCE }) },
          ),
      }),
      { global: { plugins: [[onigiriPlugin, { importFn: outerFn }]] } },
    );
    await promise;
    await flushPromises();
    await vi.waitFor(() => expect(wrapper.html()).toContain("island-loaded"));
    expect(calls).toEqual([["/virtual/Inner.vue"]]);
  });
});

describe("onigiriManifestPlugin resolveId", () => {
  const RESOLVED = "\0virtual:onigiri/manifest";
  const resolveId = (onigiriManifestPlugin() as any).resolveId.handler as (
    id: string,
    importer?: string,
  ) => string | undefined;

  it("replaces the bare `vue-onigiri/manifest` id from any importer", () => {
    for (const importer of [
      undefined,
      "/app/node_modules/vue-onigiri/dist/index.mjs?v=abc123",
      "D:/x/packages/vue-onigiri/src/runtime/loader.ts",
      "/app/src/main.ts",
    ]) {
      expect(resolveId("vue-onigiri/manifest", importer)).toBe(RESOLVED);
    }
  });

  it("keeps resolving the virtual id", () => {
    expect(resolveId("virtual:onigiri/manifest")).toBe(RESOLVED);
  });

  it("leaves every other id alone", () => {
    for (const id of [
      "vue-onigiri",
      "vue-onigiri/manifest.mjs",
      "vue-onigiri/dist/manifest.mjs",
      "./manifest",
      "/app/vue-onigiri/manifest",
    ]) {
      expect(resolveId(id, "/app/src/main.ts")).toBeUndefined();
    }
  });
});
