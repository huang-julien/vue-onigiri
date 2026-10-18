import { describe, expect, it, vi } from "vitest";
import { createImportFn } from "../src/runtime/manifest-runtime";

describe("createImportFn resolution", () => {
  it("resolves an extras key written with or without its leading slash", async () => {
    const button = vi.fn(async () => ({ default: "BUTTON" }));
    const importFn = createImportFn({}, { "ui-lib/Button.vue": button });

    await expect(importFn("ui-lib/Button.vue")).resolves.toBe("BUTTON");
    await expect(importFn("/ui-lib/Button.vue")).resolves.toBe("BUTTON");
    expect(button).toHaveBeenCalledTimes(2);
  });

  it("prefers an extras entry over a glob entry for the same descriptor", async () => {
    const importFn = createImportFn(
      { "/x/A.vue": async () => ({ default: "GLOB" }) },
      { "/x/A.vue": async () => ({ default: "EXTRA" }) },
    );

    await expect(importFn("/x/A.vue")).resolves.toBe("EXTRA");
  });

  it("falls back to the glob when extras miss", async () => {
    const importFn = createImportFn({ "/x/A.vue": async () => ({ default: "GLOB" }) }, {});

    await expect(importFn("/x/A.vue")).resolves.toBe("GLOB");
  });

  it("returns the named export, then default, then the module", async () => {
    const importFn = createImportFn(
      {
        "/named.vue": async () => ({ Widget: "NAMED", default: "DEFAULT" }),
        "/default.vue": async () => ({ default: "DEFAULT" }),
      },
      {},
    );

    await expect(importFn("/named.vue", "Widget")).resolves.toBe("NAMED");
    await expect(importFn("/named.vue")).resolves.toBe("DEFAULT");
    await expect(importFn("/default.vue", "missing")).resolves.toBe("DEFAULT");
  });

  it("does not resolve a descriptor to an Object.prototype member", async () => {
    const importFn = createImportFn({}, {});

    // `constructor`/`toString` exist on the prototype but are not own keys.
    await expect(importFn("constructor")).rejects.toThrow("No loader registered");
    await expect(importFn("toString")).rejects.toThrow("No loader registered");
  });
});
