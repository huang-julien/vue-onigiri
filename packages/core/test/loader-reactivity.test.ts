// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, shallowRef, Suspense } from "vue";
import { renderOnigiri } from "../src/runtime/deserialize";
import { VServerComponentType, type VServerComponent } from "../src/runtime/shared";

const IslandA = defineComponent({
  name: "IslandA",
  props: { label: { type: String, default: "" } },
  setup: (props) => () => h("div", `A:${props.label}`),
});

const IslandB = defineComponent({
  name: "IslandB",
  setup: () => () => h("div", "B"),
});

const islandTuple = (
  chunk: string,
  props?: Record<string, any>,
  slots?: Record<string, VServerComponent[]>,
): VServerComponent => [VServerComponentType.Component, props, chunk, "default", slots];

const mountAst = (initial: VServerComponent, importFn: any) => {
  const ast = shallowRef(initial);
  const { promise, resolve } = Promise.withResolvers();
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(
          Suspense,
          { onResolve: () => resolve(true) },
          { default: () => renderOnigiri(ast.value, { importFn }) },
        ),
    }),
  );
  return { wrapper, ast, resolved: promise };
};

describe("loader payload reactivity", () => {
  it("re-renders new props and slot content when the payload swaps with the same chunk", async () => {
    const calls: string[] = [];
    const importFn = async (src: string) => {
      calls.push(src);
      return IslandA;
    };

    const withSlot = (label: string, text: string) =>
      islandTuple("/x/IslandA.vue", { label }, {
        default: [[VServerComponentType.Text, text]],
      });

    const { wrapper, ast, resolved } = mountAst(withSlot("one", "slot-one"), importFn);
    await resolved;
    await flushPromises();
    expect(wrapper.html()).toContain("A:one");

    ast.value = withSlot("two", "slot-two");
    await flushPromises();
    await nextTick();
    expect(wrapper.html()).toContain("A:two");
    expect(wrapper.html()).not.toContain("A:one");
    expect(calls).toEqual(["/x/IslandA.vue"]);
  });

  it("re-resolves the chunk when the payload swaps to a different component", async () => {
    const calls: string[] = [];
    const importFn = async (src: string) => {
      calls.push(src);
      return src.includes("IslandB") ? IslandB : IslandA;
    };

    const { wrapper, ast, resolved } = mountAst(
      islandTuple("/x/IslandA.vue", { label: "one" }),
      importFn,
    );
    await resolved;
    await flushPromises();
    expect(wrapper.html()).toContain("A:one");

    ast.value = islandTuple("/x/IslandB.vue");
    await flushPromises();
    await nextTick();
    expect(wrapper.html()).toContain("B");
    expect(wrapper.html()).not.toContain("A:");
    expect(calls).toEqual(["/x/IslandA.vue", "/x/IslandB.vue"]);
  });
});
