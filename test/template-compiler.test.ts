import { compileOnigiri } from "../src/template-compiler";
import { describe, it, expect } from "vitest";

describe('compileOnigiri', () => {
    it('should compile a simple template', () => {
        const template = `<div>Hello, World!</div>`;
        const result = compileOnigiri(template);
        expect(result).toBeDefined();
        expect(result.code).toMatchInlineSnapshot(`
          "export function renderOnigiri(_ctx) {
          return [0, "div", undefined, [2, "Hello, World!"]];
          }"
        `);
    });

})

describe('props', () => {
    it('should compile a template with props', () => {
        const template = `<MyComponent :prop="value" />`;
        const result = compileOnigiri(template);
        expect(result).toBeDefined();
        expect(result.code).toMatchInlineSnapshot( `
          "export function renderOnigiri(_ctx) {
          return [1, MyComponent, {"prop": _ctx.value}, undefined];
          }"
        `);
    });
    it('should compile a string prop', () => {
        const template = `<MyComponent prop="value" />`;
        const result = compileOnigiri(template);
        expect(result).toBeDefined();
        expect(result.code).toMatchInlineSnapshot( `
          "export function renderOnigiri(_ctx) {
          return [1, MyComponent, {"prop": "value"}, undefined];
          }"
        `);
    });
    it('bind string', () => {
        const template = `<MyComponent :prop="'value'" />`;
        const result = compileOnigiri(template);
        expect(result).toBeDefined();
        expect(result.code).toMatchInlineSnapshot( `
          "export function renderOnigiri(_ctx) {
          return [1, MyComponent, {"prop": 'value'}, undefined];
          }"
        `);
    });
    it('v-bind', () => {
        const template = `<MyComponent v-bind:prop="value" />`;
        const result = compileOnigiri(template);
        expect(result).toBeDefined();
        expect(result.code).toMatchInlineSnapshot( `
          "export function renderOnigiri(_ctx) {
          return [1, MyComponent, {"prop": _ctx.value}, undefined];
          }"
        `);
    });

    
    it('v-bind object', () => {
        const template = `<MyComponent v-bind="value" />`;
        const result = compileOnigiri(template);
        expect(result).toBeDefined();
        expect(result.code).toMatchInlineSnapshot( `
          "export function renderOnigiri(_ctx) {
          return [1, MyComponent, _ctx.value, undefined];
          }"
        `);
    });

    it('v-bind object with merge', () => {
        const template = `<MyComponent v-bind="value" class="test" />`;
        const result = compileOnigiri(template);
        expect(result).toBeDefined();
        expect(result.code).toMatchInlineSnapshot(`
          "import { mergeProps as _mergeProps } from "vue";

          export function renderOnigiri(_ctx) {
          return [1, MyComponent, _mergeProps(_ctx.value, {"class": "test"}), undefined];
          }"
        `);
    });
})
 
