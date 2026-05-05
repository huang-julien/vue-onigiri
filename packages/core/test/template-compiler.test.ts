import { compileOnigiri } from "../src/template-compiler";
import { describe, it, expect } from "vite-plus/test";

describe("compileOnigiri", () => {
  it("should compile a simple template", () => {
    const template = `<div>Hello, World!</div>`;
    const result = compileOnigiri(template);
    expect(result).toBeDefined();
    expect(result.code).toMatchInlineSnapshot(`
      "export function renderOnigiri(_ctx, __instance) {
      return [0, "div", undefined, [[2, "Hello, World!"]]];
      }"
    `);
  });

  it("treats hyphenated tags as Vue components by default", () => {
    const result = compileOnigiri(`<my-widget />`);
    // Default heuristic: hyphenated tag → resolveComponent path
    expect(result.code).toContain("__onigiri_resolveComponent");
    expect(result.code).toContain('"my-widget"');
  });

  it("isCustomElement skips the resolveComponent path", () => {
    const result = compileOnigiri(`<my-widget />`, {
      isCustomElement: (tag) => tag === "my-widget",
    });
    // With isCustomElement → emitted as a plain HTML element
    expect(result.code).not.toContain("__onigiri_resolveComponent");
    expect(result.code).toContain('"my-widget"');
    expect(result.code).toContain('[0, "my-widget"');
  });
});

describe("props", () => {
  it("should compile a template with dynamic prop", () => {
    const template = `<MyComponent :prop="value" />`;
    const result = compileOnigiri(template);
    expect(result).toBeDefined();
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponentInInstance as __onigiri_resolveComponent } from "vue-onigiri/runtime/resolve-component";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = __onigiri_resolveComponent(__instance, "MyComponent")
        return __serializeComponentInContext(_component_MyComponent, {"prop": _ctx.value}, __instance, undefined);
      }"
    `);
  });

  it("should compile a static string prop", () => {
    const template = `<MyComponent prop="value" />`;
    const result = compileOnigiri(template);
    expect(result).toBeDefined();
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponentInInstance as __onigiri_resolveComponent } from "vue-onigiri/runtime/resolve-component";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = __onigiri_resolveComponent(__instance, "MyComponent")
        return __serializeComponentInContext(_component_MyComponent, {"prop": "value"}, __instance, undefined);
      }"
    `);
  });

  it("bind string literal expression", () => {
    const template = `<MyComponent :prop="'value'" />`;
    const result = compileOnigiri(template);
    expect(result).toBeDefined();
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponentInInstance as __onigiri_resolveComponent } from "vue-onigiri/runtime/resolve-component";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = __onigiri_resolveComponent(__instance, "MyComponent")
        return __serializeComponentInContext(_component_MyComponent, {"prop": 'value'}, __instance, undefined);
      }"
    `);
  });

  it("v-bind directive", () => {
    const template = `<MyComponent v-bind:prop="value" />`;
    const result = compileOnigiri(template);
    expect(result).toBeDefined();
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponentInInstance as __onigiri_resolveComponent } from "vue-onigiri/runtime/resolve-component";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = __onigiri_resolveComponent(__instance, "MyComponent")
        return __serializeComponentInContext(_component_MyComponent, {"prop": _ctx.value}, __instance, undefined);
      }"
    `);
  });

  it("v-bind object spread", () => {
    const template = `<MyComponent v-bind="value" />`;
    const result = compileOnigiri(template);
    expect(result).toBeDefined();
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponentInInstance as __onigiri_resolveComponent } from "vue-onigiri/runtime/resolve-component";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = __onigiri_resolveComponent(__instance, "MyComponent")
        return __serializeComponentInContext(_component_MyComponent, _ctx.value, __instance, undefined);
      }"
    `);
  });

  it("v-bind object with merge", () => {
    const template = `<MyComponent v-bind="value" class="test" />`;
    const result = compileOnigiri(template);
    expect(result).toBeDefined();
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponentInInstance as __onigiri_resolveComponent } from "vue-onigiri/runtime/resolve-component";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";
      import { mergeProps as _mergeProps } from "vue";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = __onigiri_resolveComponent(__instance, "MyComponent")
        return __serializeComponentInContext(_component_MyComponent, _mergeProps(_ctx.value, {"class": "test"}), __instance, undefined);
      }"
    `);
  });
});
