import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type ObjectDirective } from "vue";
import { serializeApp } from "../src/runtime/serialize";
import { withDirective } from "../src/runtime/with-directive";
import { VServerComponentType, type VServerComponentBuffered } from "../src/runtime/shared";
import DirectiveUse from "./fixtures/components/DirectiveUse.vue";

const el = (): VServerComponentBuffered => [
  VServerComponentType.Element,
  "div",
  undefined,
  undefined,
];

describe("withDirective resolution", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves string-named directives through the instance app context", () => {
    const tip: ObjectDirective = {
      getSSRProps: (binding) => ({ "data-tip": binding.value }),
    };
    const instance = { type: {}, appContext: { directives: { tip } } } as any;
    const result = withDirective("tip", el(), { value: "hi" }, instance) as any;
    expect(result[2]).toEqual({ "data-tip": "hi" });
  });

  it("prefers the component-local directives option over the app context", () => {
    const local: ObjectDirective = { getSSRProps: () => ({ "data-from": "local" }) };
    const global: ObjectDirective = { getSSRProps: () => ({ "data-from": "app" }) };
    const instance = {
      type: { directives: { tip: local } },
      appContext: { directives: { tip: global } },
    } as any;
    const result = withDirective("tip", el(), { value: 1 }, instance) as any;
    expect(result[2]).toEqual({ "data-from": "local" });
  });

  it("warns and returns the node unchanged when a directive cannot be resolved", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const node = el();
    const result = withDirective("nope", node, {}, { type: {}, appContext: { directives: {} } } as any);
    expect(result).toBe(node);
    expect(warn).toHaveBeenCalledWith("[vue-onigiri] Failed to resolve directive: nope");
  });

  it("app-registered directives apply during serialization and do not leak across apps", async () => {
    const appWithDirective = createApp(DirectiveUse);
    appWithDirective.directive("tip", {
      getSSRProps: (binding) => ({ "data-tip": binding.value }),
    });
    const { ast } = await serializeApp(appWithDirective);
    expect(JSON.stringify(ast)).toContain("\"data-tip\":\"hello\"");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bareApp = createApp(DirectiveUse);
    const { ast: bareAst } = await serializeApp(bareApp);
    expect(JSON.stringify(bareAst)).not.toContain("data-tip");
    expect(warn).toHaveBeenCalledWith("[vue-onigiri] Failed to resolve directive: tip");
  });
});
