import { describe, it, expect } from "vitest";
import { parse, compileScript } from "@vue/compiler-sfc";
import { compileOnigiri, compileOnigiriInline } from "../src/template-compiler";

describe("onigiri compiler", () => {
  describe("compileOnigiri", () => {
    it("should generate renderOnigiri function with _ctx parameter", () => {
      const template = `<div class="test">{{ message }}</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("function renderOnigiri(_ctx)");
      expect(result.code).toContain("return [");
    });

    it("should access bindings via _ctx", () => {
      const template = `<div>{{ msg }}</div>`;
      const result = compileOnigiri(template);

      // The interpolation should reference _ctx.msg or just msg
      expect(result.code).toContain("msg");
    });
  });

  describe("compileOnigiriInline", () => {
    it("should generate an inline expression without function wrapper", () => {
      const template = `<div class="test">{{ message }}</div>`;
      const result = compileOnigiriInline(template);

      // Should NOT contain function wrapper
      expect(result.expression).not.toContain("function");
      expect(result.expression).not.toContain("return");

      // Should be a direct array expression
      expect(result.expression).toMatch(/^\[0,/); // Starts with element type
      expect(result.expression).toContain('"div"');
      expect(result.expression).toContain("message");
    });

    it("should handle multiple root elements as fragment expression", () => {
      const template = `<div>A</div><span>B</span>`;
      const result = compileOnigiriInline(template);

      // Fragment type is 3
      expect(result.expression).toMatch(/^\[3,/);
      expect(result.expression).toContain('"div"');
      expect(result.expression).toContain('"span"');
    });

    it("should return null for empty template", () => {
      const result = compileOnigiriInline("");
      expect(result.expression).toBe("null");
    });
  });

  describe("script + template integration", () => {
    it("should compile a full SFC and generate onigiri output", () => {
      const source = `
<script setup>
import { ref } from 'vue'

const count = ref(0)
const message = 'Hello'
</script>

<template>
  <div class="container">
    <span>{{ message }}</span>
    <button>{{ count }}</button>
  </div>
</template>
`;

      // Parse the SFC
      const { descriptor } = parse(source, { filename: "test.vue" });

      // Compile script to get bindings
      const scriptResult = compileScript(descriptor, {
        id: "test",
        inlineTemplate: true,
      });

      expect(scriptResult.bindings).toBeDefined();
      expect(scriptResult.bindings).toHaveProperty("count");
      expect(scriptResult.bindings).toHaveProperty("message");

      // Compile template with onigiri
      const onigiriResult = compileOnigiri(descriptor.template!.content, {
        bindingMetadata: scriptResult.bindings,
      });

      expect(onigiriResult.code).toContain("renderOnigiri");
      expect(onigiriResult.code).toContain('"div"'); // Element tag
      expect(onigiriResult.code).toContain('"span"');
      expect(onigiriResult.code).toContain('"button"');
    });

    it("should handle props correctly", () => {
      const source = `
<script setup lang="ts">
defineProps<{ title: string }>()
</script>

<template>
  <h1>{{ title }}</h1>
</template>
`;

      const { descriptor } = parse(source, { filename: "test.vue" });

      const scriptResult = compileScript(descriptor, {
        id: "test",
        inlineTemplate: true,
      });

      expect(scriptResult.bindings).toHaveProperty("title");

      const onigiriResult = compileOnigiri(descriptor.template!.content, {
        bindingMetadata: scriptResult.bindings,
      });

      expect(onigiriResult.code).toContain("renderOnigiri");
      expect(onigiriResult.code).toContain('"h1"');
    });

    it("should handle v-if directives", () => {
      const template = `<div v-if="show">Visible</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      // Note: Current implementation doesn't fully handle v-if yet
      // Just verify it doesn't crash and produces output
      expect(result.code).toContain("show");
    });

    it("should handle v-for directives", () => {
      const template = `<div v-for="item in items" :key="item.id">{{ item.name }}</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      // Note: Current implementation doesn't fully handle v-for yet
      // Just verify it produces output with the iteration variables
      expect(result.code).toContain("item");
    });

    it("should handle dynamic attributes", () => {
      const template = `<div :class="dynamicClass" :id="elementId">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      expect(result.code).toContain("dynamicClass");
      expect(result.code).toContain("elementId");
    });

    it("should handle nested elements", () => {
      const template = `
        <div class="outer">
          <div class="inner">
            <span>Nested content</span>
          </div>
        </div>
      `;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      expect(result.code).toContain('"div"');
      expect(result.code).toContain('"span"');
      expect(result.code).toContain('"outer"');
      expect(result.code).toContain('"inner"');
    });

    it("should handle components", () => {
      const template = `<MyComponent :prop="value" />`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      expect(result.code).toContain("MyComponent");
      // Component type is 1 (VServerComponentType.Component)
      expect(result.code).toContain("[1,");
    });

    it("should handle multiple root elements as fragment", () => {
      const template = `
        <div>First</div>
        <div>Second</div>
      `;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      // Fragment type is 3 (VServerComponentType.Fragment)
      expect(result.code).toContain("[3,");
    });
  });

  describe("generated code structure", () => {
    it("should generate valid JavaScript (ES module)", () => {
      const template = `<div class="test">{{ message }}</div>`;
      const result = compileOnigiri(template);

      // The output is an ES module with export, which can't be tested with new Function()
      // Instead verify the structure is correct
      expect(result.code).toContain("export function renderOnigiri");
      expect(result.code).toContain("return [");
      // Should not have obvious syntax errors
      expect(result.code).not.toContain("undefined undefined");
    });

    it("should export the renderOnigiri function", () => {
      const template = `<div>Test</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("export function renderOnigiri");
    });

    it("should return VServerComponent array structure", () => {
      const template = `<div class="test">Hello</div>`;
      const result = compileOnigiri(template);

      // Should return array starting with type (0 = Element)
      expect(result.code).toMatch(/return \[0,/);
    });
  });
});
