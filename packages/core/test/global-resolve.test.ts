import { it, describe, expect } from "vitest";
import { createApp, defineComponent, h, resolveComponent } from "vue";
import { renderToString } from "@vue/server-renderer";
import { serializeApp } from "../src/runtime/serialize";
import { renderOnigiri } from "../src/runtime/deserialize";
import GlobalUser from "./fixtures/components/GlobalUser.vue";
import NestedGlobalRoot from "./fixtures/components/NestedGlobalRoot.vue";
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
    expect(actual).toContain("class=\"resolved\"");
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
    expect(actual).toContain("class=\"resolved\"");
    expect(removeCommentsFromHtml(actual)).toBe(removeCommentsFromHtml(expected));
  });
});
