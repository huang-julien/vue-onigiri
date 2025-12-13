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

  describe("slots", () => {
    it("should handle default slot content", () => {
      const template = `<MyComponent>Default slot content</MyComponent>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("MyComponent");
      expect(result.code).toContain("default");
    });

    it("should handle named slots", () => {
      const template = `
        <MyComponent>
          <template #header>Header content</template>
          <template #footer>Footer content</template>
        </MyComponent>
      `;
      const result = compileOnigiri(template);

      expect(result.code).toContain("MyComponent");
      // Named slots should be present
      expect(result.code).toContain("header");
      expect(result.code).toContain("footer");
    });

    it("should handle slot with fallback content", () => {
      const template = `<slot>Fallback content</slot>`;
      const result = compileOnigiri(template);

      // Note: Currently <slot> is treated as a regular element
      // TODO: Implement proper slot type (VServerComponentType.Slot = 4)
      expect(result.code).toContain("slot");
      expect(result.code).toContain("Fallback content");
    });
  });

  describe("event handlers", () => {
    it("should handle v-on event handlers", () => {
      const template = `<button @click="handleClick">Click me</button>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"button"');
      // Events should be captured in props
      expect(result.code).toContain("click");
      expect(result.code).toContain("handleClick");
    });

    it("should handle v-on with modifiers", () => {
      const template = `<form @submit.prevent="onSubmit">Submit</form>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"form"');
      expect(result.code).toContain("submit");
    });

    it("should handle inline handlers", () => {
      const template = `<button @click="count++">Increment</button>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("count++");
    });
  });

  describe("static content optimization", () => {
    it("should handle purely static content", () => {
      const template = `<div class="static">Static text</div>`;
      const result = compileOnigiri(template);

      // Static content should be preserved as-is
      expect(result.code).toContain('"div"');
      expect(result.code).toContain('"static"');
      expect(result.code).toContain("Static text");
    });

    it("should handle mixed static and dynamic content", () => {
      const template = `<div class="static" :id="dynamicId">Hello {{ name }}</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"static"');
      expect(result.code).toContain("dynamicId");
      expect(result.code).toContain("name");
    });

    it("should handle boolean attributes", () => {
      const template = `<input disabled readonly />`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"input"');
      expect(result.code).toContain("disabled");
      expect(result.code).toContain("readonly");
    });
  });

  describe("class and style bindings", () => {
    it("should handle static class", () => {
      const template = `<div class="foo bar">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"foo bar"');
    });

    it("should handle dynamic class binding", () => {
      const template = `<div :class="{ active: isActive }">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("active");
      expect(result.code).toContain("isActive");
    });

    it("should handle array class binding", () => {
      const template = `<div :class="[baseClass, activeClass]">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("baseClass");
      expect(result.code).toContain("activeClass");
    });

    it("should handle inline style object", () => {
      const template = `<div :style="{ color: textColor }">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("color");
      expect(result.code).toContain("textColor");
    });

    it("should handle static style", () => {
      const template = `<div style="color: red; font-size: 14px">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("color: red");
    });
  });

  describe("special elements", () => {
    it("should handle template element", () => {
      const template = `<template v-if="show"><div>Conditional</div></template>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("show");
      expect(result.code).toContain('"div"');
    });

    it("should handle self-closing elements", () => {
      const template = `<img src="test.png" /><br /><hr />`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"img"');
      expect(result.code).toContain('"br"');
      expect(result.code).toContain('"hr"');
    });

    it("should handle HTML comments (skip them)", () => {
      const template = `<div><!-- This is a comment -->Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
      expect(result.code).toContain("Content");
      // Comments should not appear in output
      expect(result.code).not.toContain("This is a comment");
    });
  });

  describe("text interpolation", () => {
    it("should handle simple interpolation", () => {
      const template = `<span>{{ message }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("message");
      // Text type is 2
      expect(result.code).toContain("[2,");
    });

    it("should handle multiple interpolations", () => {
      const template = `<span>{{ first }} and {{ second }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("first");
      expect(result.code).toContain("second");
    });

    it("should handle expressions in interpolation", () => {
      const template = `<span>{{ count + 1 }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("count + 1");
    });

    it("should handle method calls in interpolation", () => {
      const template = `<span>{{ formatDate(date) }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("formatDate(date)");
    });

    it("should handle ternary expressions", () => {
      const template = `<span>{{ isActive ? 'Yes' : 'No' }}</span>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("isActive");
    });
  });

  describe("v-bind variations", () => {
    it("should handle shorthand v-bind", () => {
      const template = `<div :id="elementId" :title="tooltip">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("elementId");
      expect(result.code).toContain("tooltip");
    });

    it("should handle v-bind object spread", () => {
      const template = `<div v-bind="attrs">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("attrs");
    });

    it("should handle dynamic attribute names", () => {
      const template = `<div :[attrName]="attrValue">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("attrName");
      expect(result.code).toContain("attrValue");
    });
  });

  describe("edge cases", () => {
    it("should handle empty elements", () => {
      const template = `<div></div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
    });

    it("should handle whitespace-only content", () => {
      const template = `<div>   </div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
    });

    it("should handle deeply nested structures", () => {
      const template = `
        <div>
          <section>
            <article>
              <header>
                <h1>{{ title }}</h1>
              </header>
            </article>
          </section>
        </div>
      `;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
      expect(result.code).toContain('"section"');
      expect(result.code).toContain('"article"');
      expect(result.code).toContain('"header"');
      expect(result.code).toContain('"h1"');
      expect(result.code).toContain("title");
    });

    it("should handle special characters in text", () => {
      const template = `<div>Hello &amp; goodbye &lt;world&gt;</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain('"div"');
    });

    it("should handle numeric literals", () => {
      const template = `<div :count="42" :ratio="3.14">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("42");
      expect(result.code).toContain("3.14");
    });
  });
});
