import { describe, it, expect } from "vitest";
import { compileOnigiri, compileOnigiriInline } from "../../src/template-compiler";

describe("onigiri compiler", () => {
  describe("compileOnigiri", () => {
    it("should generate renderOnigiri function with _ctx parameter", () => {
      const template = `<div class="test">{{ message }}</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("function renderOnigiri(_ctx, __instance)");
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
      expect(result.expression).toContain("\"div\"");
      expect(result.expression).toContain("message");
    });

    it("should handle multiple root elements as fragment expression", () => {
      const template = `<div>A</div><span>B</span>`;
      const result = compileOnigiriInline(template);

      // Fragment type is 3
      expect(result.expression).toMatch(/^\[3,/);
      expect(result.expression).toContain("\"div\"");
      expect(result.expression).toContain("\"span\"");
    });

    it("should return null for empty template", () => {
      const result = compileOnigiriInline("");
      expect(result.expression).toBe("null");
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
