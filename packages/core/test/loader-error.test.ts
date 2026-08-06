// @vitest-environment happy-dom

import { describe, expect, it } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { defineComponent, h, nextTick, shallowRef, Suspense } from "vue";
import { renderOnigiri } from "../src/runtime/deserialize";
import { VServerComponentType, type VServerComponent } from "../src/runtime/shared";

const Island = defineComponent({
  name: "Island",
  setup: () => () => h("div", "island"),
});

const islandTuple = (chunk: string): VServerComponent => [
  VServerComponentType.Component,
  undefined,
  chunk,
  "default",
  undefined,
];

const mountAst = (
  initial: VServerComponent,
  importFn: any,
  errorHandler: (err: unknown) => void,
) => {
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
    { global: { config: { errorHandler } } },
  );
  return { wrapper, ast, resolved: promise };
};

describe("loader chunk-load failure", () => {
  it("resolves the Suspense, renders nothing, and reports via app.config.errorHandler", async () => {
    const failure = new Error("404 /x/Missing.vue");
    const errors: unknown[] = [];
    const { wrapper, resolved } = mountAst(
      islandTuple("/x/Missing.vue"),
      async () => {
        throw failure;
      },
      (err) => errors.push(err),
    );

    // Before the loader-level catch, a rejected importFn left this
    // Suspense pending forever (this await would time the test out).
    await resolved;
    await flushPromises();

    expect(errors).toEqual([failure]);
    expect(wrapper.html()).not.toContain("island");
  });

  it("reports and clears the island when a payload swap fails to load", async () => {
    const failure = new Error("404 /x/Missing.vue");
    const errors: unknown[] = [];
    const importFn = async (src: string) => {
      if (src.includes("Missing")) throw failure;
      return Island;
    };

    const { wrapper, ast, resolved } = mountAst(
      islandTuple("/x/Island.vue"),
      importFn,
      (err) => errors.push(err),
    );
    await resolved;
    await flushPromises();
    expect(wrapper.html()).toContain("island");
    expect(errors).toEqual([]);

    ast.value = islandTuple("/x/Missing.vue");
    await flushPromises();
    await nextTick();

    expect(errors).toEqual([failure]);
    expect(wrapper.html()).not.toContain("island");
  });
});
