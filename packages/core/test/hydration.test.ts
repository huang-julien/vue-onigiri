// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createSSRApp, h, nextTick, Suspense } from "vue";
import { renderToString } from "@vue/server-renderer";
import { serializeComponent } from "../src/runtime/serialize";
import { renderOnigiri } from "../src/runtime/deserialize";
import LoadComponent from "./fixtures/components/LoadComponent.vue";

describe("hydration over server-rendered HTML", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("hydrates a serialized payload without mismatches and stays interactive", async () => {
    const payload = await serializeComponent(LoadComponent);

    const makeApp = () =>
      createSSRApp({
        setup: () => () => h(Suspense, null, { default: () => renderOnigiri(payload) }),
      });

    // Server side: render the SAME client tree to HTML.
    const html = await renderToString(makeApp());
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    makeApp().mount(container);
    await flushPromises();
    await nextTick();

    const complaints = [...warn.mock.calls, ...error.mock.calls]
      .map((c) => String(c[0]))
      .filter((m) => /hydrat|mismatch/i.test(m));
    expect(complaints).toEqual([]);

    // Interactivity proves the island actually hydrated instead of re-rendering.
    expect(container.innerHTML).toContain("counter : 0");
    container.querySelector("button")!.click();
    await nextTick();
    expect(container.innerHTML).toContain("counter : 1");
  });
});
