import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  createApp,
  defineAsyncComponent,
  defineComponent,
  h,
  resolveComponent,
  resolveDirective,
  withCtx,
  withDirectives,
  type Component,
  type ObjectDirective,
} from "vue";
import { serializeApp } from "../src/runtime/serialize";
import SlotHost from "./fixtures/components/SlotHost.vue";
import RenderTimeResolve from "./fixtures/components/RenderTimeResolve.vue";

const GlobalFoo = defineComponent({
  name: "GlobalFoo",
  props: { label: { type: String, default: "plain" } },
  setup: (props) => () => h("b", { class: "global-foo" }, `foo-${props.label}`),
});

const AsyncSlotHost = defineAsyncComponent(() => Promise.resolve(SlotHost));

const tip: ObjectDirective = {
  getSSRProps: (binding) => ({ "data-tip": binding.value }),
};

function makeApp(root: Component) {
  const app = createApp(root);
  app.component("GlobalFoo", GlobalFoo);
  app.directive("tip", tip);
  return app;
}

async function serializeToJson(root: Component) {
  const { ast } = await serializeApp(makeApp(root));
  return JSON.stringify(ast);
}

describe("rendering instance inside slot content", () => {
  let warn: MockInstance;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolveComponent works in a hand-written slot function", async () => {
    const Parent = defineComponent({
      setup: () => () =>
        h(SlotHost, null, { default: () => h(resolveComponent("GlobalFoo") as any) }),
    });

    const json = await serializeToJson(Parent);

    expect(json).toContain("foo-plain");
    expect(json).not.toContain('"GlobalFoo"');
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolveComponent works in a slot passed to an async onigiri component", async () => {
    // Nuxt registers globals as async wrappers; the resolved vnode is rebuilt outside a render.
    const Parent = defineComponent({
      setup: () => () =>
        h(AsyncSlotHost, null, { default: () => h(resolveComponent("GlobalFoo") as any) }),
    });

    const json = await serializeToJson(Parent);

    expect(json).toContain("foo-plain");
    expect(json).not.toContain('"GlobalFoo"');
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolveComponent works in a scoped slot receiving props", async () => {
    const Parent = defineComponent({
      setup: () => () =>
        h(AsyncSlotHost, null, {
          item: (scope: { n: number }) =>
            h(resolveComponent("GlobalFoo") as any, { label: `scoped-${scope.n + 1}` }),
        }),
    });

    const json = await serializeToJson(Parent);

    expect(json).toContain("foo-scoped-42");
    expect(json).not.toContain('"GlobalFoo"');
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolveComponent works in slots handed to the root component", async () => {
    const { ast } = await serializeApp(makeApp(SlotHost), {
      default: () => h(resolveComponent("GlobalFoo") as any),
      item: (scope: { n: number }) =>
        h(resolveComponent("GlobalFoo") as any, { label: `root-${scope.n + 1}` }),
    });
    const json = JSON.stringify(ast);

    expect(json).toContain("foo-plain");
    expect(json).toContain("foo-root-42");
    expect(json).not.toContain('"GlobalFoo"');
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolveDirective works in a hand-written slot function", async () => {
    let resolved: unknown;
    const Parent = defineComponent({
      setup: () => () =>
        h(AsyncSlotHost, null, {
          item: (scope: { n: number }) => {
            resolved = resolveDirective("tip");
            return withDirectives(h("i", null, `dir-${scope.n}`), [[resolved as any, "hi"]]);
          },
        }),
    });

    const json = await serializeToJson(Parent);

    expect(resolved).toBe(tip);
    expect(json).toContain("dir-41");
    expect(json).toContain('"data-tip":"hi"');
    expect(warn).not.toHaveBeenCalled();
  });

  it("applies element directives once in the vnode-tree path", async () => {
    const mark: ObjectDirective = { getSSRProps: () => ({ class: "marked" }) };
    const Nested = defineComponent({
      setup: () => () =>
        h("section", null, [withDirectives(h("i", { class: "inner" }, "x"), [[mark]])]),
    });
    const Root = defineComponent({
      setup: () => () => withDirectives(h("div", { class: "root" }, [h(Nested)]), [[mark]]),
    });

    const { ast } = await serializeApp(makeApp(Root));
    const expected = await serializeApp(
      makeApp(
        defineComponent({
          setup: () => () =>
            h("div", { class: "root marked" }, [
              h(
                defineComponent({
                  setup: () => () => h("section", null, [h("i", { class: "inner marked" }, "x")]),
                }),
              ),
            ]),
        }),
      ),
    );

    expect(ast).toEqual(expected.ast);
    expect(warn).not.toHaveBeenCalled();
  });

  it("withCtx-wrapped slots keep resolving against their owner", async () => {
    const LocalFoo = defineComponent({
      setup: () => () => h("b", null, "local-foo"),
    });
    const Parent = defineComponent({
      components: { GlobalFoo: LocalFoo },
      render() {
        return h(SlotHost, null, {
          default: withCtx(() => [h(resolveComponent("GlobalFoo") as any)]),
          item: withCtx((scope: { n: number }) => [h("i", null, `ctx-${scope.n + 1}`)]),
          _: 1,
        });
      },
    });

    const json = await serializeToJson(Parent);

    expect(json).toContain("local-foo");
    expect(json).toContain("ctx-42");
    expect(json).not.toContain("foo-plain");
    expect(warn).not.toHaveBeenCalled();
  });

  it("resolveComponent works in onigiri render expressions and slot fallbacks", async () => {
    const asRoot = await serializeToJson(RenderTimeResolve);
    const asChild = await serializeToJson(
      defineComponent({ setup: () => () => h(RenderTimeResolve) }),
    );

    for (const json of [asRoot, asChild]) {
      expect(json).toContain("foo-plain");
      expect(json).toContain("foo-fallback");
      expect(json).not.toContain('"GlobalFoo"');
    }
    expect(warn).not.toHaveBeenCalled();
  });

  it("restores the previous rendering instance when a slot throws", async () => {
    const Parent = defineComponent({
      setup: () => () =>
        h(AsyncSlotHost, null, {
          default: () => {
            throw new Error("slot boom");
          },
        }),
    });

    await expect(serializeApp(makeApp(Parent))).rejects.toThrow("slot boom");

    // A leaked instance would let this bare call resolve without warning.
    expect(resolveComponent("GlobalFoo")).toBe("GlobalFoo");
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
