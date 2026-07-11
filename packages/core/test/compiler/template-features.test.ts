import { describe, it, expect } from "vitest";
import { compileOnigiri } from "../../src/template-compiler";

describe("onigiri compiler", () => {
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

      expect(result.code).toContain("slot");
      expect(result.code).toContain("Fallback content");
    });
  });

  describe("event handlers", () => {
    it("should handle v-on event handlers", () => {
      const template = `<button @click="handleClick">Click me</button>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"button\"");
      // Events should be captured in props (camelCase per Vue convention)
      expect(result.code).toContain("onClick");
      expect(result.code).toContain("handleClick");
    });

    it("should handle v-on with modifiers", () => {
      const template = `<form @submit.prevent="onSubmit">Submit</form>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"form\"");
      expect(result.code).toContain("onSubmit");
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
      expect(result.code).toContain("\"div\"");
      expect(result.code).toContain("\"static\"");
      expect(result.code).toContain("Static text");
    });

    it("should handle mixed static and dynamic content", () => {
      const template = `<div class="static" :id="dynamicId">Hello {{ name }}</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"static\"");
      expect(result.code).toContain("dynamicId");
      expect(result.code).toContain("name");
    });

    it("should handle boolean attributes", () => {
      const template = `<input disabled readonly />`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"input\"");
      expect(result.code).toContain("disabled");
      expect(result.code).toContain("readonly");
    });
  });

  describe("class and style bindings", () => {
    it("should handle static class", () => {
      const template = `<div class="foo bar">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"foo bar\"");
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
      expect(result.code).toContain("\"div\"");
    });

    it("should handle self-closing elements", () => {
      const template = `<img src="test.png" /><br /><hr />`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"img\"");
      expect(result.code).toContain("\"br\"");
      expect(result.code).toContain("\"hr\"");
    });

    it("should handle HTML comments (skip them)", () => {
      const template = `<div><!-- This is a comment -->Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"div\"");
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

      expect(result.code).toContain("_ctx.formatDate(_ctx.date)");
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
});
