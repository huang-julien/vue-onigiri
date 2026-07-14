// @vitest-environment happy-dom
import { describe, it, expect } from "vitest";
import { defineComponent, h, ref } from "vue";
import { serializeComponent } from "../src/runtime/serialize";
import { VServerComponentType } from "../src/runtime/shared";

describe("serializeComponent with render fn + setup", () => {
  it("setup returning a render function is invoked", async () => {
    const C = defineComponent({
      props: { msg: String },
      setup(props) {
        const count = ref(7);
        return () => h("div", { class: "x" }, `${props.msg}:${count.value}`);
      },
    });

    const { ast: result } = await serializeComponent(C, { msg: "hi" });

    expect(result).toEqual([
      VServerComponentType.Element,
      "div",
      { class: "x" },
      [[VServerComponentType.Text, "hi:7"]],
    ]);
  });

  it("options-style render() with setup() returning state is invoked", async () => {
    const C = defineComponent({
      props: { msg: String },
      setup() {
        return { count: 42 };
      },
      render() {
        return h("span", { id: "y" }, `${this.msg}-${this.count}`);
      },
    });

    const { ast: result } = await serializeComponent(C, { msg: "hello" });

    expect(result).toEqual([
      VServerComponentType.Element,
      "span",
      { id: "y" },
      [[VServerComponentType.Text, "hello-42"]],
    ]);
  });

  it("async setup + render function awaits before rendering", async () => {
    const C = defineComponent({
      async setup() {
        const value = await new Promise<string>((r) => setTimeout(() => r("async!"), 10));
        return () => h("p", value);
      },
    });

    const { ast: result } = await serializeComponent(C);

    expect(result).toEqual([
      VServerComponentType.Element,
      "p",
      undefined,
      [[VServerComponentType.Text, "async!"]],
    ]);
  });
});
