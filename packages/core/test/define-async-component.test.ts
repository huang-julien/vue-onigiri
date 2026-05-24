// @vitest-environment happy-dom
import { describe, it, expect } from "vite-plus/test";
import { defineAsyncComponent, defineComponent, h } from "vue";
import { serializeComponent } from "../src/runtime/serialize";
import { VServerComponentType } from "../src/runtime/shared";

describe("serializeComponent with defineAsyncComponent", () => {
  it("resolves and serializes a defineAsyncComponent loader", async () => {
    const Inner = defineComponent({
      props: { msg: String },
      setup: (props) => () => h("div", { class: "inner" }, props.msg),
    });

    const Async = defineAsyncComponent(
      () => new Promise<typeof Inner>((r) => setTimeout(() => r(Inner), 10)),
    );

    const result = await serializeComponent(Async, { msg: "hello async" });

    // The AsyncComponentWrapper resolves on the server and renders the
    // resolved component as its child, which serializes as a Fragment.
    expect(result).toBeDefined();
    expect(result![0]).toBe(VServerComponentType.Fragment);
    const json = JSON.stringify(result);
    expect(json).toContain("div");
    expect(json).toContain("hello async");
  });

  it("resolves a defineAsyncComponent used as a child of another component", async () => {
    const Inner = defineComponent({
      setup: () => () => h("span", "lazy child"),
    });

    const LazyInner = defineAsyncComponent(
      () => new Promise<typeof Inner>((r) => setTimeout(() => r(Inner), 10)),
    );

    const Parent = defineComponent({
      setup: () => () => h("div", null, [h(LazyInner)]),
    });

    const result = await serializeComponent(Parent);

    expect(JSON.stringify(result)).toContain("lazy child");
    expect(JSON.stringify(result)).toContain("span");
  });

  it("handles defineAsyncComponent with rejected loader (errors propagate)", async () => {
    const Failing = defineAsyncComponent(
      () => new Promise((_resolve, reject) => setTimeout(() => reject(new Error("nope")), 5)),
    );

    await expect(serializeComponent(Failing)).rejects.toBeDefined();
  });
});
