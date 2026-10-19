// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, Suspense } from "vue";
import { htmlToVNode } from "../src/runtime/dom-to-vnode";
import Counter from "./fixtures/components/Counter.vue";
import { componentMarkerHtml, NONCE } from "./helpers";
import { importFn as manifestImportFn } from "vue-onigiri/manifest";

describe("manifest-based component loading", () => {
  it("the generated manifest resolves .vue modules by source path", async () => {
    const mod = await manifestImportFn("/test/fixtures/components/Counter.vue");
    expect(mod).toBeDefined();
  });

  it("extraEntries loads a real node_modules package component by bare specifier", async () => {
    // `vue-onigiri-test-ui-lib` is a workspace package linked into
    // node_modules; without its literal entry this bare specifier would
    // hit the "No loader registered" throw (see the test below).
    const mod = await manifestImportFn("vue-onigiri-test-ui-lib/Button.vue");
    expect(mod).toBeDefined();
    expect(typeof mod).toBe("object");
  });

  it("extraEntries lookup tolerates a leading-slash difference", async () => {
    const mod = await manifestImportFn("/vue-onigiri-test-ui-lib/Button.vue");
    expect(mod).toBeDefined();
  });

  it("extraEntries values resolve through the bundler, so aliases work", async () => {
    const mod = await manifestImportFn("onigiri-test/aliased-counter");
    expect(mod).toBeDefined();
  });

  it("the generated manifest throws for an unknown bare specifier", async () => {
    // A bare specifier (no leading `/`, no scheme) doesn't match the
    // glob and doesn't qualify for the absolute-URL fallback. Surface
    // the friendly diagnostic so the host knows which lever to pull.
    await expect(manifestImportFn("nope")).rejects.toThrow(/No loader registered/);
  });

  it("the generated manifest takes the import() fallback for any absolute URL", async () => {
    // The extension check (`ABSOLUTE_CHUNK_RE`) was dropped so hosts
    // can bake extension-less URLs (e.g. Vite dev's `/@id/<spec>`
    // sentinel) into the marker. Any `/`-prefixed `src` should be handed
    // straight to a native `import()`. The exact failure mode for a
    // non-existent URL depends on the runtime; we just assert that
    // it's *not* the friendly "No loader registered" diagnostic, which
    // would mean the extension check is still gating the fallback.
    await expect(manifestImportFn("/this/does/not/exist")).rejects.toThrow();
    await expect(manifestImportFn("/this/does/not/exist")).rejects.not.toThrow(
      /No loader registered/,
    );
  });

  it("the generated manifest reports the failing chunk when import() throws", async () => {
    // A source-path descriptor the glob doesn't cover: the native
    // import() fails with whatever the runtime says, which is opaque on
    // its own. Rethrow naming the chunk and the levers that fix it.
    await expect(manifestImportFn("/this/does/not/exist.vue")).rejects.toThrow(
      /Failed to load chunk/,
    );
    await expect(manifestImportFn("/this/does/not/exist.vue")).rejects.toThrow(
      /\/this\/does\/not\/exist\.vue/,
    );
  });

  it("loads a marked component via the default manifest", async () => {
    const html = componentMarkerHtml("/test/fixtures/components/Counter.vue", "");
    const { promise, resolve } = Promise.withResolvers<boolean>();
    const wrapper = mount(
      defineComponent({
        setup() {
          return () =>
            h(
              Suspense,
              { onResolve: () => resolve(true) },
              { default: () => htmlToVNode(html, { nonce: NONCE }) },
            );
        },
      }),
    );
    await promise;
    await flushPromises();
    await nextTick();
    expect(wrapper.html()).toContain("counter");
    expect(wrapper.html()).toContain("Increment");
  });

  it("the `importFn` option overrides the manifest resolver", async () => {
    const html = componentMarkerHtml("/test/fixtures/components/Counter.vue", "");
    const importFn = vi.fn(async () => Counter as any);
    const { promise, resolve } = Promise.withResolvers<boolean>();
    mount(
      defineComponent({
        setup() {
          return () =>
            h(
              Suspense,
              { onResolve: () => resolve(true) },
              { default: () => htmlToVNode(html, { importFn, nonce: NONCE }) },
            );
        },
      }),
    );
    await promise;
    expect(importFn).toHaveBeenCalledWith("/test/fixtures/components/Counter.vue", "default");
  });
});
