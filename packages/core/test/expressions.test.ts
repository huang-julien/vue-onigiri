import { describe, expect, it } from "vitest";
import { prefixIdentifiers } from "../src/template-compiler/codegen/expressions";

describe("prefixIdentifiers", () => {
  it("expands shorthand object properties while prefixing references", () => {
    const result = prefixIdentifiers("ui.base({ class: foo, active, ...spread })");
    expect(result).toBe("_ctx.ui.base({ class: _ctx.foo, active: _ctx.active, ..._ctx.spread })");
  });
});
