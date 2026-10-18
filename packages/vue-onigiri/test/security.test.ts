import { describe, expect, it } from "vitest";
import { createImportFn } from "../src/runtime/manifest-runtime";

describe("manifest importFn hardening", () => {
  const BACKSLASH = String.fromCharCode(92);
  const TAB = String.fromCharCode(9);
  const NEWLINE = String.fromCharCode(10);
  const RETURN = String.fromCharCode(13);

  // One implementation backs every generated manifest, so the guard is exercised
  // directly instead of through a generated module.
  const importFn = createImportFn({}, {});

  // Every spelling below resolves to https://evil.com through the URL parser,
  // which deletes tab/newline/return before parsing and reads `\` as a second `/`.
  const CROSS_ORIGIN = [
    "//evil.com/pwn.js",
    `/${BACKSLASH}evil.com/pwn.js`,
    `/${BACKSLASH}${BACKSLASH}evil.com/pwn.js`,
    `/${TAB}/evil.com/pwn.js`,
    `/${NEWLINE}/evil.com/pwn.js`,
    `/${RETURN}/evil.com/pwn.js`,
  ];

  it.each(CROSS_ORIGIN)("refuses %j instead of importing cross-origin", async (src) => {
    // Asserting the premise guards against a fix that only handles the spellings
    // we happened to think of.
    expect(new URL(src, "https://app.example.com/page").origin).toBe("https://evil.com");
    await expect(importFn(src)).rejects.toThrow("No loader registered for chunk");
  });

  // The import() fallback exists for URLs a host baked via `resolveChunkUrl`;
  // hardening it must not start refusing those.
  it.each([
    "/_nuxt/Counter.DhSf1sT2.js",
    "/components/Counter.vue",
    "/x/My Component.vue",
    "/x/Foo.vue?v=123",
  ])("still attempts a same-origin descriptor %j", async (src) => {
    // No module resolver here, so reaching import() surfaces as the load error
    // rather than the "no loader" refusal.
    await expect(importFn(src)).rejects.toThrow("Failed to load chunk");
  });
});
