// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, shallowRef, Suspense } from "vue";
import { htmlToVNode } from "../src/runtime/dom-to-vnode";
import { componentMarkerHtml, NONCE } from "./helpers";

const IslandA = defineComponent({
  name: "IslandA",
  props: { label: { type: String, default: "" } },
  setup:
    (props, { slots }) =>
    () =>
      h("div", [`A:${props.label}`, slots.default?.()]),
});

const IslandB = defineComponent({
  name: "IslandB",
  setup: () => () => h("div", "B"),
});

const mountMarker = (initial: string, importFn: any) => {
  const html = shallowRef(initial);
  const { promise, resolve } = Promise.withResolvers();
  const wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(
          Suspense,
          { onResolve: () => resolve(true) },
          { default: () => htmlToVNode(html.value, { importFn, nonce: NONCE }) },
        ),
    }),
  );
  return { wrapper, html, resolved: promise };
};

describe("loader marker reactivity", () => {
  it("re-renders new props and slot HTML when the marker swaps with the same chunk", async () => {
    const calls: string[] = [];
    const importFn = async (src: string) => {
      calls.push(src);
      return IslandA;
    };
    const withSlot = (label: string, text: string) =>
      componentMarkerHtml("/x/IslandA.vue", "", { label }, { default: `<i>${text}</i>` });

    const { wrapper, html, resolved } = mountMarker(withSlot("one", "slot-one"), importFn);
    await resolved;
    await flushPromises();
    expect(wrapper.html()).toContain("A:one");
    expect(wrapper.html()).toContain("slot-one");

    html.value = withSlot("two", "slot-two");
    await flushPromises();
    await nextTick();
    expect(wrapper.html()).toContain("A:two");
    expect(wrapper.html()).toContain("slot-two");
    expect(wrapper.html()).not.toContain("A:one");
    expect(calls).toEqual(["/x/IslandA.vue"]);
  });

  it("re-resolves the chunk when the marker swaps to a different component", async () => {
    const calls: string[] = [];
    const importFn = async (src: string) => {
      calls.push(src);
      return src.includes("IslandB") ? IslandB : IslandA;
    };

    const { wrapper, html, resolved } = mountMarker(
      componentMarkerHtml("/x/IslandA.vue", "", { label: "one" }),
      importFn,
    );
    await resolved;
    await flushPromises();
    expect(wrapper.html()).toContain("A:one");

    html.value = componentMarkerHtml("/x/IslandB.vue", "");
    await flushPromises();
    await nextTick();
    expect(wrapper.html()).toContain("B");
    expect(wrapper.html()).not.toContain("A:");
    expect(calls).toEqual(["/x/IslandA.vue", "/x/IslandB.vue"]);
  });
});
