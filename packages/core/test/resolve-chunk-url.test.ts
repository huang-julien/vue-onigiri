import { describe, expect, it, vi } from "vitest";
import { compileOnigiri } from "../src/template-compiler";

const TEMPLATE = `<Counter v-load-client />`;
const importMap = new Map([["Counter", "/components/Counter.vue"]]);

function compile(resolveChunkUrl?: (sourcePath: string) => string | undefined) {
  return compileOnigiri(TEMPLATE, { importMap, resolveChunkUrl });
}

describe("resolveChunkUrl", () => {
  it("bakes the returned URL into the AST", () => {
    const result = compile(() => "/_nuxt/Counter.abc123.js");

    expect(result.code).toContain("\"/_nuxt/Counter.abc123.js\"");
    expect(result.code).not.toContain("\"/components/Counter.vue\"");
  });

  it("keeps the source path when the hook is absent or doesn't answer", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(compile().code).toContain("\"/components/Counter.vue\"");
      expect(compile(() => undefined).code).toContain("\"/components/Counter.vue\"");
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
