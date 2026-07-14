// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, Suspense } from "vue";
import { renderOnigiri, type RenderOnigiriOptions } from "../src/runtime/deserialize";
import { onigiriPlugin } from "../src/runtime/plugin";
import { importFn as defaultImportFn } from "../src/runtime/manifest-default";
import { onigiriManifestPlugin } from "../src/vite/manifest";
import { VServerComponentType, type VServerComponent } from "../src/runtime/shared";

const Island = defineComponent({
  name: "Island",
  setup: () => () => h("div", "island-loaded"),
});

const componentAst = (): VServerComponent => [
  VServerComponentType.Component,
  undefined,
  "/virtual/Island.vue",
  "default",
  undefined,
];

const trackedImportFn = (result: any) => {
  const calls: any[][] = [];
  const fn = async (...args: any[]) => {
    calls.push(args);
    return result;
  };
  return { fn, calls };
};

const mountAst = (
  ast: VServerComponent,
  options?: RenderOnigiriOptions,
  plugins: any[] = [],
) => {
  const { promise, resolve } = Promise.withResolvers();
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(
          Suspense,
          { onResolve: () => resolve(true) },
          { default: () => renderOnigiri(ast, options) },
        ),
    }),
    { global: { plugins } },
  );
  return { wrapper, resolved: promise };
};

describe("importFn resolution chain", () => {
  it("uses the app-level importFn provided by onigiriPlugin", async () => {
    const { fn, calls } = trackedImportFn(Island);
    const { wrapper, resolved } = mountAst(componentAst(), undefined, [[onigiriPlugin, { importFn: fn }]]);
    await resolved;
    await flushPromises();
    expect(calls).toEqual([["/virtual/Island.vue", "default"]]);
    expect(wrapper.html()).toContain("island-loaded");
  });

  it("per-render importFn wins over the app-level one", async () => {
    const appFn = trackedImportFn(
      defineComponent({ setup: () => () => h("div", "from-app") }),
    );
    const renderFn = trackedImportFn(Island);
    const { wrapper, resolved } = mountAst(componentAst(), { importFn: renderFn.fn }, [
      [onigiriPlugin, { importFn: appFn.fn }],
    ]);
    await resolved;
    await flushPromises();
    expect(renderFn.calls.length).toBe(1);
    expect(appFn.calls.length).toBe(0);
    expect(wrapper.html()).toContain("island-loaded");
  });

  it("default manifest module throws with setup guidance outside Vite", async () => {
    await expect(defaultImportFn("/nope.vue")).rejects.toThrow(
      '[vue-onigiri] No chunk loader available for "/nope.vue"',
    );
  });
});

describe("onigiriManifestPlugin manifest-default redirect", () => {
  const RESOLVED = "\0virtual:onigiri/manifest";
  const resolveId = (onigiriManifestPlugin() as any).resolveId.handler as (
    id: string,
    importer?: string,
  ) => string | undefined;

  it("redirects the runtime loader's relative import from src and dist", () => {
    expect(resolveId("./manifest-default", "D:/x/packages/core/src/runtime/loader.ts")).toBe(
      RESOLVED,
    );
    expect(
      resolveId("./manifest-default.js", "/app/node_modules/vue-onigiri/dist/runtime/loader.js"),
    ).toBe(RESOLVED);
  });

  it("redirects the bare specifier from anywhere", () => {
    expect(resolveId("vue-onigiri/runtime/manifest-default", "/app/src/main.ts")).toBe(RESOLVED);
  });

  it("does not hijack user modules named manifest-default", () => {
    expect(resolveId("./manifest-default", "/app/src/main.ts")).toBeUndefined();
    expect(resolveId("./manifest-default.ts", "/app/src/components/loader-panel.vue")).toBeUndefined();
  });
});
