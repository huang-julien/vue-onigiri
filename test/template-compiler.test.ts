import { compileOnigiri } from '../src/template-compiler'
import { describe, it, expect } from 'vitest'

describe('compileOnigiri', () => {
  it('should compile a simple template', () => {
    const template = `<div>Hello, World!</div>`
    const result = compileOnigiri(template)
    expect(result).toBeDefined()
    expect(result.code).toMatchInlineSnapshot(`
      "export function renderOnigiri(_ctx, __instance) {
      return [0, "div", undefined, [[2, "Hello, World!"]]];
      }"
    `)
  })
})

describe('props', () => {
  it('should compile a template with dynamic prop', () => {
    const template = `<MyComponent :prop="value" />`
    const result = compileOnigiri(template)
    expect(result).toBeDefined()
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponent as _resolveComponent } from "vue";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = _resolveComponent("MyComponent")
        return __serializeComponentInContext(_component_MyComponent, {"prop": _ctx.value}, __instance, undefined);
      }"
    `)
  })

  it('should compile a static string prop', () => {
    const template = `<MyComponent prop="value" />`
    const result = compileOnigiri(template)
    expect(result).toBeDefined()
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponent as _resolveComponent } from "vue";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = _resolveComponent("MyComponent")
        return __serializeComponentInContext(_component_MyComponent, {"prop": "value"}, __instance, undefined);
      }"
    `)
  })

  it('bind string literal expression', () => {
    const template = `<MyComponent :prop="'value'" />`
    const result = compileOnigiri(template)
    expect(result).toBeDefined()
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponent as _resolveComponent } from "vue";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = _resolveComponent("MyComponent")
        return __serializeComponentInContext(_component_MyComponent, {"prop": 'value'}, __instance, undefined);
      }"
    `)
  })

  it('v-bind directive', () => {
    const template = `<MyComponent v-bind:prop="value" />`
    const result = compileOnigiri(template)
    expect(result).toBeDefined()
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponent as _resolveComponent } from "vue";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = _resolveComponent("MyComponent")
        return __serializeComponentInContext(_component_MyComponent, {"prop": _ctx.value}, __instance, undefined);
      }"
    `)
  })

  it('v-bind object spread', () => {
    const template = `<MyComponent v-bind="value" />`
    const result = compileOnigiri(template)
    expect(result).toBeDefined()
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponent as _resolveComponent } from "vue";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = _resolveComponent("MyComponent")
        return __serializeComponentInContext(_component_MyComponent, _ctx.value, __instance, undefined);
      }"
    `)
  })

  it('v-bind object with merge', () => {
    const template = `<MyComponent v-bind="value" class="test" />`
    const result = compileOnigiri(template)
    expect(result).toBeDefined()
    expect(result.code).toMatchInlineSnapshot(`
      "import { resolveComponent as _resolveComponent } from "vue";
      import { serializeComponentInContext as __serializeComponentInContext } from "vue-onigiri/runtime/serialize";
      import { mergeProps as _mergeProps } from "vue";

      export function renderOnigiri(_ctx, __instance) {
      const _component_MyComponent = _resolveComponent("MyComponent")
        return __serializeComponentInContext(_component_MyComponent, _mergeProps(_ctx.value, {"class": "test"}), __instance, undefined);
      }"
    `)
  })
})
