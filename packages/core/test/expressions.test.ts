import { describe, expect, it } from "vitest";
import { prefixIdentifiers } from "../src/template-compiler/codegen/expressions";

describe("prefixIdentifiers", () => {
  it("expands shorthand object properties while prefixing references", () => {
    const result = prefixIdentifiers("ui.base({ class: foo, active, ...spread })");
    expect(result).toBe("_ctx.ui.base({ class: _ctx.foo, active: _ctx.active, ..._ctx.spread })");
  });

  it("leaves Vue's allowed globals unprefixed", () => {
    expect(prefixIdentifiers("new Set(items).size + Math.max(a, 1)")).toBe(
      "new Set(_ctx.items).size + Math.max(_ctx.a, 1)",
    );
  });

  it("collapses bare Vue namespaces without touching string literals", () => {
    expect(prefixIdentifiers("$setup.count + $props.step + '$setup.count'")).toBe(
      "_ctx.count + _ctx.step + '$setup.count'",
    );
  });

  it("keeps namespaces already reached through _ctx", () => {
    expect(prefixIdentifiers("_ctx.$options.name")).toBe("_ctx.$options.name");
  });
});
