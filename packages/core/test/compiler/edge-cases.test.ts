import { describe, it, expect } from "vitest";
import { compileOnigiri } from "../../src/template-compiler";

describe("onigiri compiler", () => {
  describe("edge cases", () => {
    it("should handle empty elements", () => {
      const template = `<div></div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"div\"");
    });

    it("should handle whitespace-only content", () => {
      const template = `<div>   </div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"div\"");
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

      expect(result.code).toContain("\"div\"");
      expect(result.code).toContain("\"section\"");
      expect(result.code).toContain("\"article\"");
      expect(result.code).toContain("\"header\"");
      expect(result.code).toContain("\"h1\"");
      expect(result.code).toContain("title");
    });

    it("should handle special characters in text", () => {
      const template = `<div>Hello &amp; goodbye &lt;world&gt;</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("\"div\"");
    });

    it("should handle numeric literals", () => {
      const template = `<div :count="42" :ratio="3.14">Content</div>`;
      const result = compileOnigiri(template);

      expect(result.code).toContain("42");
      expect(result.code).toContain("3.14");
    });
  });

  describe("typescript syntax stripping", () => {
    it("strips `as Type` casts", () => {
      const result = compileOnigiri(`<div :id="(value as string)">Test</div>`);
      expect(result.code).not.toMatch(/\bas\s+string\b/);
      expect(result.code).toContain("_ctx.value");
    });

    it("strips `as` casts in compound member access", () => {
      const result = compileOnigiri(`<div :name="route.meta._layout as string">Test</div>`);
      expect(result.code).not.toMatch(/\bas\s+string\b/);
      expect(result.code).toContain("_ctx.route.meta._layout");
    });

    it("strips `satisfies` casts", () => {
      const result = compileOnigiri(`<div :id="(value satisfies string)">Test</div>`);
      expect(result.code).not.toMatch(/\bsatisfies\b/);
    });

    it("strips non-null `!` assertions", () => {
      const result = compileOnigiri(`<div :id="value!">Test</div>`);
      expect(result.code).not.toMatch(/_ctx\.value!/);
      expect(result.code).toContain("_ctx.value");
    });

    it("strips angle-bracket type assertions", () => {
      const result = compileOnigiri(`<div :id="(<string>value)">Test</div>`);
      expect(result.code).not.toMatch(/<string>/);
      expect(result.code).toContain("_ctx.value");
    });

    it("strips type annotations on v-on inline arrow params", () => {
      const result = compileOnigiri(`<button @click="(e: MouseEvent) => onClick(e)">x</button>`);
      expect(result.code).not.toMatch(/:\s*MouseEvent/);
      expect(result.code).toContain("_ctx.onClick");
    });
  });
});
