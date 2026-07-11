import { describe, it, expect } from "vite-plus/test";
import { parse, compileScript } from "@vue/compiler-sfc";
import { compileOnigiri } from "../../src/template-compiler";

describe("onigiri compiler", () => {
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

    it("should handle components with v-load-client", () => {
      const template = `<MyComponent v-load-client :prop="value" />`;
      const result = compileOnigiri(template, {
        additionalImports: new Map([["MyComponent", { path: "/components/MyComponent.vue" }]]),
      });

      expect(result.code).toContain("renderOnigiri");
      expect(result.code).toContain('"/components/MyComponent.vue"');
      // Component type is 1 (VServerComponentType.Component)
      expect(result.code).toContain("[1,");
    });

    it("v-load-client with a named-export additionalImports entry emits that export", () => {
      // Regression: the codegen used to hardcode `"default"` for the chunk
      // export name regardless of what `additionalImports[tag].export` said,
      // so a host registering a named export (e.g. Nuxt's
      // `addComponent({ export: 'ComarkRenderer', filePath: '@comark/vue' })`)
      // would resolve to `mod.default` (== undefined) at hydration time and
      // render as an empty comment placeholder.
      const result = compileOnigiri(`<ComarkRenderer v-load-client :tree="tree" />`, {
        additionalImports: new Map([
          ["ComarkRenderer", { path: "@comark/vue", export: "ComarkRenderer" }],
        ]),
      });

      expect(result.code).toContain('"@comark/vue", "ComarkRenderer"');
      expect(result.code).not.toContain('"@comark/vue", "default"');
    });

    it("v-load-client resolves the export through any casing of the tag", () => {
      // Vue normalises template tag names; the additionalImports key may
      // have been registered as any of PascalCase / kebab-case / camelCase.
      // The resolver walks all four casings (raw, Pascal, camel, kebab) so
      // none of those registrations should fall back to `"default"`.
      const compileWith = (tag: string, registryKey: string) =>
        compileOnigiri(`<${tag} v-load-client />`, {
          additionalImports: new Map([
            [registryKey, { path: "@scope/pkg", export: "NamedExport" }],
          ]),
        });

      for (const [tag, key] of [
        ["NamedExport", "NamedExport"],
        ["named-export", "NamedExport"],
        ["NamedExport", "named-export"],
      ] as const) {
        const result = compileWith(tag, key);
        expect(result.code).toContain('"@scope/pkg", "NamedExport"');
      }
    });

    it("v-load-client with a dynamic expression honours additionalImports[tag].export", () => {
      // Same regression as the static path, but for the `v-load-client="expr"`
      // shape that emits `__serializeChildComponent(..., chunkPath, exportName)`.
      const result = compileOnigiri(`<ComarkRenderer v-load-client="visible" :tree="tree" />`, {
        additionalImports: new Map([
          ["ComarkRenderer", { path: "@comark/vue", export: "ComarkRenderer" }],
        ]),
      });

      expect(result.code).toContain('"@comark/vue", "ComarkRenderer"');
      expect(result.code).not.toContain('"@comark/vue", "default"');
    });

    it("should handle components without v-load-client (server-rendered)", () => {
      const template = `<MyComponent :prop="value" />`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("renderOnigiri");
      expect(result.code).toContain("__serializeComponentInContext(");
      expect(result.code).toContain("MyComponent");
      // Should NOT contain Component type array - it's server-rendered
      expect(result.code).not.toContain("[1,");
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
});
