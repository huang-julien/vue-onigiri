import { describe, expect, it } from "vitest";
import { buildImportMap } from "../src/vite/compiler/imports";

const ROOT = "D:/proj";
const SFC = "D:/proj/src/pages/Home.vue";

describe("buildImportMap", () => {
  it("resolves alias imports to root-relative paths through the bundler resolver", async () => {
    const map = await buildImportMap(
      `import Counter from "@/components/Counter.vue";`,
      SFC,
      ROOT,
      async (source) =>
        source === "@/components/Counter.vue" ? "D:/proj/src/components/Counter.vue" : null,
    );
    expect(map.get("Counter")).toBe("/src/components/Counter.vue");
  });

  it("resolves extension-less relative imports through the bundler resolver", async () => {
    const map = await buildImportMap(
      `import Counter from "./Counter";`,
      SFC,
      ROOT,
      async () => "D:/proj/src/pages/Counter.vue",
    );
    expect(map.get("Counter")).toBe("/src/pages/Counter.vue");
  });

  it("keeps the bare specifier for package imports", async () => {
    const map = await buildImportMap(
      `import { ComarkRenderer } from "@comark/vue";`,
      SFC,
      ROOT,
      async () => "D:/proj/node_modules/@comark/vue/dist/index.js",
    );
    expect(map.get("ComarkRenderer")).toBe("@comark/vue");
  });

  it("strips resolution queries before deriving the chunk path", async () => {
    const map = await buildImportMap(
      `import Widget from "@/Widget.vue";`,
      SFC,
      ROOT,
      async () => "D:/proj/src/Widget.vue?vue&lang.ts",
    );
    expect(map.get("Widget")).toBe("/src/Widget.vue");
  });

  it("falls back to path joining for relative imports without a resolver", async () => {
    const map = await buildImportMap(`import Counter from "../Counter.vue";`, SFC, ROOT);
    expect(map.get("Counter")).toBe("/src/Counter.vue");
  });

  it("leaves unresolvable non-relative imports unmapped", async () => {
    const map = await buildImportMap(
      `import Mystery from "#virtual/thing";`,
      SFC,
      ROOT,
      async () => null,
    );
    expect(map.has("Mystery")).toBe(false);
  });
});
