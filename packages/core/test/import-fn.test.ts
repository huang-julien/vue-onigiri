// @vitest-environment happy-dom

import { describe, expect, it } from "vite-plus/test";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, Suspense } from "vue";
import { renderOnigiri } from "../src/runtime/deserialize";
import { serializeComponent } from "../src/runtime/serialize";
import LoadComponent from "./fixtures/components/LoadComponent.vue";
import Counter from "./fixtures/components/Counter.vue";
import { importFn as manifestImportFn } from "virtual:onigiri/manifest";

describe("manifest-based component loading", () => {
  it("virtual:onigiri/manifest resolves .vue modules by source path", async () => {
    const mod = await manifestImportFn("/test/fixtures/components/Counter.vue");
    expect(mod).toBeDefined();
  });

  it("compiler attaches __onigiriASTDescriptor to .vue SFCs", () => {
    const descriptor = (Counter as any).__onigiriASTDescriptor;
    expect(descriptor).toBeDefined();
    // No `resolveChunkUrl` is wired up in the test config, so the
    // descriptor's `chunk` falls through to the SFC's source path —
    // the same value the manifest's `import.meta.glob` is keyed by.
    expect(descriptor).toMatchObject({
      chunk: "/test/fixtures/components/Counter.vue",
      export: "default",
    });
  });

  it("virtual:onigiri/manifest throws for an unknown bare specifier", async () => {
    // A bare specifier (no leading `/`, no scheme) doesn't match the
    // glob and doesn't qualify for the absolute-URL fallback. Surface
    // the friendly diagnostic so the host knows which lever to pull.
    await expect(manifestImportFn("nope")).rejects.toThrow(/No loader registered/);
  });

  it("virtual:onigiri/manifest takes the import() fallback for any absolute URL", async () => {
    // The extension check (`ABSOLUTE_CHUNK_RE`) was dropped so hosts
    // can bake extension-less URLs (e.g. Vite dev's `/@id/<spec>`
    // sentinel) into the AST. Any `/`-prefixed `src` should be handed
    // straight to a native `import()`. The exact failure mode for a
    // non-existent URL depends on the runtime — we just assert that
    // it's *not* the friendly "No loader registered" diagnostic, which
    // would mean the extension check is still gating the fallback.
    await expect(manifestImportFn("/this/does/not/exist")).rejects.toThrow();
    await expect(manifestImportFn("/this/does/not/exist")).rejects.not.toThrow(
      /No loader registered/,
    );
  });

  it("renderOnigiri loads a client-loaded component via the default manifest", async () => {
    const ast = await serializeComponent(LoadComponent);
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const wrapper = mount(
      defineComponent({
        setup() {
          return () =>
            h(Suspense, { onResolve: () => resolve(true) }, { default: () => renderOnigiri(ast) });
        },
      }),
    );
    await promise;
    // The loader defers `importFn` to `onMounted` so SSR and client
    // initial render produce the same `<div>` placeholder (no
    // hydration mismatch). The outer Suspense resolves immediately
    // because the loader's setup is sync — wait for the deferred
    // chunk-load + re-render before asserting on Counter content.
    for (let i = 0; i < 30 && !wrapper.html().includes("counter"); i++) {
      await new Promise((r) => setTimeout(r, 10));
      await flushPromises();
      await nextTick();
    }
    expect(wrapper.html()).toContain("counter");
    expect(wrapper.html()).toContain("Increment");
  });

  it("renderOnigiri's `importFn` option overrides the manifest resolver", async () => {
    const ast = await serializeComponent(LoadComponent);
    let called = false;
    const importFn = async (src: string, exportName: string = "default") => {
      called = true;
      const mod: any = await import(/* @vite-ignore */ src);
      return mod[exportName] ?? mod.default ?? mod;
    };
    const { promise, resolve } = Promise.withResolvers<boolean>();
    mount(
      defineComponent({
        setup() {
          return () =>
            h(
              Suspense,
              { onResolve: () => resolve(true) },
              { default: () => renderOnigiri(ast, { importFn }) },
            );
        },
      }),
    );
    await promise;
    for (let i = 0; i < 30 && !called; i++) {
      await new Promise((r) => setTimeout(r, 10));
      await flushPromises();
      await nextTick();
    }
    expect(called).toBe(true);
  });
});
