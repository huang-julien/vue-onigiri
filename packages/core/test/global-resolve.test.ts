import { it, describe, expect } from "vitest";
import { createApp, defineComponent, h, resolveComponent } from "vue";
import { renderToString } from "@vue/server-renderer";
import { serializeApp } from "../src/runtime/serialize";
import { renderOnigiri } from "../src/runtime/deserialize";
import { resolveComponentInInstance } from "../src/runtime/resolve-component";
import GlobalUser from "./fixtures/components/GlobalUser.vue";
import NestedGlobalRoot from "./fixtures/components/NestedGlobalRoot.vue";
import LocalRegistration from "./fixtures/components/LocalRegistration.vue";
import { removeCommentsFromHtml } from "./utils";

const RouterLinkStub = defineComponent({
  name: "RouterLinkStub",
  props: { to: { type: String, default: "" } },
  setup(props, { slots }) {
    return () => h("a", { href: props.to, class: "resolved" }, slots.default?.());
  },
});

const LinkLike = defineComponent({
  name: "LinkLike",
  setup() {
    return () => {
      const RL = resolveComponent("RouterLinkStub");
      return h(RL as any, { to: "/x" }, () => "link");
    };
  },
});

describe("global component resolution during serialize", () => {
  it("resolves render-time globals (RouterLink-style) the same as Vue SSR", async () => {
    const makeApp = (root: any) => {
      const app = createApp(root);
      app.component("LinkLike", LinkLike);
      app.component("RouterLinkStub", RouterLinkStub);
      return app;
    };

    const expected = await renderToString(makeApp(GlobalUser));

    const serialized = await serializeApp(makeApp(GlobalUser));
    const rebuilt = createApp({ setup: () => () => renderOnigiri(serialized) });
    const actual = await renderToString(rebuilt);

    expect(actual).not.toContain("<RouterLinkStub");
    expect(actual).not.toContain("<LinkLike");
    expect(actual).toContain('class="resolved"');
    expect(removeCommentsFromHtml(actual)).toBe(removeCommentsFromHtml(expected));
  });

  it("resolves render-time globals through a NESTED onigiri subtree", async () => {
    const makeApp = (root: any) => {
      const app = createApp(root);
      app.component("LinkLike", LinkLike);
      app.component("RouterLinkStub", RouterLinkStub);
      return app;
    };

    const expected = await renderToString(makeApp(NestedGlobalRoot));

    const serialized = await serializeApp(makeApp(NestedGlobalRoot));
    const rebuilt = createApp({ setup: () => () => renderOnigiri(serialized) });
    const actual = await renderToString(rebuilt);

    expect(actual).not.toContain("<RouterLinkStub");
    expect(actual).not.toContain("<LinkLike");
    expect(actual).toContain('class="resolved"');
    expect(removeCommentsFromHtml(actual)).toBe(removeCommentsFromHtml(expected));
  });

  it("resolves components registered via the local components option", async () => {
    const expected = await renderToString(createApp(LocalRegistration));

    const serialized = await serializeApp(createApp(LocalRegistration));
    const rebuilt = createApp({ setup: () => () => renderOnigiri(serialized) });
    const actual = await renderToString(rebuilt);

    expect(actual).toContain("counter");
    expect(actual).not.toContain("<renamed-counter");
    expect(removeCommentsFromHtml(actual)).toBe(removeCommentsFromHtml(expected));
  });
});

describe("resolveComponentInInstance lookup order", () => {
  const Local = defineComponent({ name: "LocalComp", render: () => null });
  const Global = defineComponent({ name: "GlobalComp", render: () => null });
  const makeInstance = (localReg?: any, appReg?: any): any => ({
    type: { components: localReg },
    appContext: { components: appReg ?? {} },
  });

  it("checks the local components option before the app context", () => {
    expect(resolveComponentInInstance(makeInstance({ Foo: Local }, { Foo: Global }), "Foo")).toBe(
      Local,
    );
  });

  it("resolves casing variants in the local registry", () => {
    expect(resolveComponentInInstance(makeInstance({ FooBar: Local }), "foo-bar")).toBe(Local);
    expect(resolveComponentInInstance(makeInstance({ fooBar: Local }), "foo-bar")).toBe(Local);
  });

  it("falls back to the app context, then self-name, then the raw tag", () => {
    expect(resolveComponentInInstance(makeInstance(undefined, { Foo: Global }), "Foo")).toBe(
      Global,
    );
    const self: any = { type: { name: "SelfName" }, appContext: { components: {} } };
    expect(resolveComponentInInstance(self, "SelfName")).toBe(self.type);
    expect(resolveComponentInInstance(makeInstance(), "Nope")).toBe("Nope");
  });
});
