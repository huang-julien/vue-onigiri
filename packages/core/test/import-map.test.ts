import { describe, expect, it } from "vitest";
import { type ScriptImports, buildImportMap } from "../src/vite/compiler/imports";

const ROOT = "D:/proj";
const SFC = "D:/proj/src/pages/Home.vue";

/** Build `compileScript`-shaped import bindings from `[local, source, imported, isType]` tuples. */
function bindings(
  ...entries: [local: string, source: string, imported?: string, isType?: boolean][]
): ScriptImports {
  const imports: ScriptImports = {};
  for (const [local, source, imported = "default", isType = false] of entries) {
    imports[local] = { local, source, imported, isType, isFromSetup: true, isUsedInTemplate: true };
  }
  return imports;
}

describe("buildImportMap", () => {
  it("resolves alias imports to root-relative paths through the bundler resolver", async () => {
    const map = await buildImportMap(
      bindings(["Counter", "@/components/Counter.vue"]),
      SFC,
      ROOT,
      async (source) =>
        source === "@/components/Counter.vue" ? "D:/proj/src/components/Counter.vue" : null,
    );
    expect(map.get("Counter")).toBe("/src/components/Counter.vue");
  });

  it("resolves extension-less relative imports through the bundler resolver", async () => {
    const map = await buildImportMap(
      bindings(["Counter", "./Counter"]),
      SFC,
      ROOT,
      async () => "D:/proj/src/pages/Counter.vue",
    );
    expect(map.get("Counter")).toBe("/src/pages/Counter.vue");
  });

  it("keeps the bare specifier for package imports", async () => {
    const map = await buildImportMap(
      bindings(["ComarkRenderer", "@comark/vue", "ComarkRenderer"]),
      SFC,
      ROOT,
      async () => "D:/proj/node_modules/@comark/vue/dist/index.js",
    );
    expect(map.get("ComarkRenderer")).toBe("@comark/vue");
  });

  it("keeps the bare specifier for workspace-linked packages resolving outside the root", async () => {
    // pnpm `workspace:*` links resolve through the symlink to a realpath
    // outside both node_modules and the project root.
    const map = await buildImportMap(
      bindings(["Button", "@acme/ui-lib/Button.vue"]),
      SFC,
      ROOT,
      async () => "D:/monorepo/packages/ui-lib/Button.vue",
    );
    expect(map.get("Button")).toBe("@acme/ui-lib/Button.vue");
  });

  it("strips resolution queries before deriving the chunk path", async () => {
    const map = await buildImportMap(
      bindings(["Widget", "@/Widget.vue"]),
      SFC,
      ROOT,
      async () => "D:/proj/src/Widget.vue?vue&lang.ts",
    );
    expect(map.get("Widget")).toBe("/src/Widget.vue");
  });

  it("falls back to path joining for relative imports without a resolver", async () => {
    const map = await buildImportMap(bindings(["Counter", "../Counter.vue"]), SFC, ROOT);
    expect(map.get("Counter")).toBe("/src/Counter.vue");
  });

  it("leaves unresolvable non-relative imports unmapped", async () => {
    const map = await buildImportMap(
      bindings(["Mystery", "#virtual/thing"]),
      SFC,
      ROOT,
      async () => null,
    );
    expect(map.has("Mystery")).toBe(false);
  });

  it("maps every specifier of a source under its local name, aliases included", async () => {
    const map = await buildImportMap(
      bindings(["Default", "./m"], ["Renamed", "./m", "Original"], ["Named", "./m", "Named"]),
      SFC,
      ROOT,
    );
    expect(map.get("Default")).toBe("/src/pages/m");
    expect(map.get("Renamed")).toBe("/src/pages/m");
    expect(map.get("Named")).toBe("/src/pages/m");
    expect(map.has("Original")).toBe(false);
  });

  it("skips type-only imports and namespace imports", async () => {
    const map = await buildImportMap(
      bindings(["Props", "./types", "Props", true], ["ns", "./ns", "*"]),
      SFC,
      ROOT,
    );
    expect(map.size).toBe(0);
  });

  it("returns an empty map when the script produced no bindings", async () => {
    const map = await buildImportMap(undefined, SFC, ROOT);
    expect(map.size).toBe(0);
  });
});
