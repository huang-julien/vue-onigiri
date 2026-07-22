import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, type ObjectDirective } from "vue";
import { serializeApp } from "../src/runtime/serialize";
import { vModel, withDirective } from "../src/runtime/with-directive";
import { VServerComponentType, type VServerComponentBuffered } from "../src/runtime/shared";
import DirectiveUse from "./fixtures/components/DirectiveUse.vue";

const T = VServerComponentType;
const applyModel = (node: any, value: any) =>
  (vModel.transformOnigiri as any)(node, { value, modifiers: {} });

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

  it("vModel sets checked on checkboxes instead of value", () => {
    const checkbox = (value: string) => [T.Element, "input", { type: "checkbox", value }, undefined];

    expect(applyModel(checkbox("a"), true)[2]).toEqual({ type: "checkbox", value: "a", checked: true });
    expect(applyModel(checkbox("a"), false)[2]).toEqual({ type: "checkbox", value: "a" });
    expect(applyModel(checkbox("a"), ["a", "b"])[2].checked).toBe(true);
    expect(applyModel(checkbox("c"), ["a", "b"])[2].checked).toBeUndefined();
    expect(applyModel(checkbox("a"), new Set(["a"]))[2].checked).toBe(true);
  });

  it("vModel sets checked on matching radios", () => {
    const radio = (value: string) => [T.Element, "input", { type: "radio", value }, undefined];

    expect(applyModel(radio("x"), "x")[2].checked).toBe(true);
    expect(applyModel(radio("y"), "x")[2].checked).toBeUndefined();
  });

  it("vModel keeps value semantics for text inputs and textarea", () => {
    expect(applyModel([T.Element, "input", { type: "text" }, undefined], "hi")[2].value).toBe("hi");
    expect(applyModel([T.Element, "textarea", undefined, undefined], "hi")[2].value).toBe("hi");
  });

  it("vModel marks matching options selected instead of setting value on select", () => {
    const select = [
      T.Element,
      "select",
      undefined,
      [
        [T.Element, "option", { value: "a" }, [[T.Text, "A"]]],
        [T.Element, "option", { value: "b" }, [[T.Text, "B"]]],
        [T.Element, "option", undefined, [[T.Text, "c-text"]]],
      ],
    ];

    const result = applyModel(select, "b");
    expect(result[2]).toBeUndefined();
    const [optA, optB, optText] = result[3];
    expect(optA[2].selected).toBeUndefined();
    expect(optB[2].selected).toBe(true);
    expect(optText[2]?.selected).toBeUndefined();

    // Option value falls back to its text content.
    const byText = applyModel(select, "c-text");
    expect(byText[3][2][2].selected).toBe(true);
  });

  it("vModel handles multiple select and optgroup children", () => {
    const select = [
      T.Element,
      "select",
      { multiple: true },
      [
        [
          T.Element,
          "optgroup",
          { label: "g" },
          [
            [T.Element, "option", { value: "a" }, undefined],
            [T.Element, "option", { value: "b" }, undefined],
          ],
        ],
        [T.Element, "option", { value: "c" }, undefined],
      ],
    ];

    const result = applyModel(select, ["a", "c"]);
    const group = result[3][0];
    expect(group[3][0][2].selected).toBe(true);
    expect(group[3][1][2].selected).toBeUndefined();
    expect(result[3][1][2].selected).toBe(true);
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
