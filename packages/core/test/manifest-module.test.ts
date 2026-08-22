import { afterEach, describe, expect, it, vi } from "vitest";
import { onigiriManifestPlugin } from "../src/vite/manifest";
import { _resetOnigiriTargets, registerOnigiriTarget } from "../src/vite/shared";

const MANIFEST_ID = "\0virtual:onigiri/manifest";

/** `load` reads `this.debug` off the plugin context, so bind a fake ctx. */
function loadManifest(
  plugin: ReturnType<typeof onigiriManifestPlugin>,
  opts?: { ssr?: boolean },
  ctx: object = {},
): string {
  const load = plugin.load as (this: unknown, id: string, opts?: { ssr?: boolean }) => string;
  return load.call(ctx, MANIFEST_ID, opts);
}

describe("generated manifest module: extraEntries", () => {
  afterEach(() => {
    _resetOnigiriTargets();
  });

  it("emits literal import entries in both environments", () => {
    const plugin = onigiriManifestPlugin({
      serverInclude: "/components/**/*.vue",
      clientInclude: "/components/**/*.vue",
      extraEntries: { "ui-lib/Button.vue": "ui-lib/Button.vue" },
    });

    for (const opts of [{ ssr: true }, { ssr: false }]) {
      const code = loadManifest(plugin, opts);
      expect(code).toContain(`"ui-lib/Button.vue": () => import("ui-lib/Button.vue")`);
    }
  });

  it("wires importFn to createImportFn over the two generated tables", () => {
    const code = loadManifest(
      onigiriManifestPlugin({
        serverInclude: "/components/**/*.vue",
        extraEntries: { "ui-lib/Button.vue": "ui-lib/Button.vue" },
      }),
      { ssr: true },
    );

    // Resolution lives in runtime/manifest-runtime; the module only supplies the tables.
    expect(code).toContain(`from "vue-onigiri/runtime/manifest-runtime"`);
    expect(code).toContain("export const importFn = __createImportFn(__glob, __extra)");
    expect(code).toContain("export const manifest = __glob");
  });

  it("stub mode emits empty tables, with no glob and no literal loaders", () => {
    const code = loadManifest(
      onigiriManifestPlugin({
        stub: true,
        extraEntries: { "ui-lib/Button.vue": "ui-lib/Button.vue" },
      }),
      { ssr: true },
    );

    // Nitro's rollup can compile neither, so both tables must be bare literals.
    expect(code).toContain("const __glob = {}");
    expect(code).toContain("const __extra = {}");
    expect(code).not.toContain("import.meta.glob");
    expect(code).not.toContain("() => import(");
  });

  it("emits an empty extras table for missing or empty extraEntries", () => {
    for (const plugin of [onigiriManifestPlugin(), onigiriManifestPlugin({ extraEntries: {} })]) {
      const code = loadManifest(plugin, { ssr: true });
      expect(code).toContain("const __extra = {}");
      expect(code).not.toContain("() => import(");
    }
  });

  it("wires the runtime identically in every configuration", () => {
    registerOnigiriTarget("/components/Counter.vue");
    const shapes = [
      onigiriManifestPlugin({ stub: true }),
      onigiriManifestPlugin({ serverInclude: "auto" }),
      onigiriManifestPlugin({ serverInclude: false, extraEntries: { "a/B.vue": "a/B.vue" } }),
      onigiriManifestPlugin({ serverInclude: "auto", extraEntries: { "a/B.vue": "a/B.vue" } }),
    ];

    // Only the two table literals vary; the import and both exports are constant,
    // so behaviour is settled by manifest-runtime's own test, not per-shape here.
    const wiring = shapes.map((plugin) => {
      const code = loadManifest(plugin, { ssr: true });
      return code
        .split("\n")
        .filter((line) => line.startsWith("import ") || line.startsWith("export "))
        .join("\n");
    });

    expect(new Set(wiring).size).toBe(1);
  });

  it("'auto' filters bare package specifiers out of the glob and debug-logs them once", () => {
    registerOnigiriTarget("/components/Counter.vue");
    registerOnigiriTarget("ui-lib/Button.vue");
    const plugin = onigiriManifestPlugin();
    const debug = vi.fn();

    const code = loadManifest(plugin, { ssr: true }, { debug });
    expect(code).toContain(`import.meta.glob(["/components/Counter.vue"])`);
    expect(code).not.toContain("ui-lib/Button.vue");
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0]![0]).toContain(`"ui-lib/Button.vue"`);
    expect(debug.mock.calls[0]![0]).toContain("extraEntries");

    // Second load (other environment / reload) stays quiet.
    loadManifest(plugin, { ssr: false }, { debug });
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("splices 'auto' targets into explicit patterns without applying their negatives", () => {
    registerOnigiriTarget("/components/Counter.vue");
    const include = ["auto", "/pages/**/*.vue", "!**/components/**"];
    const serverCode = loadManifest(onigiriManifestPlugin({ serverInclude: include }), {
      ssr: true,
    });
    const clientCode = loadManifest(onigiriManifestPlugin({ clientInclude: include }), {
      ssr: false,
    });

    for (const code of [serverCode, clientCode]) {
      expect(code).toContain(`import.meta.glob(["/components/Counter.vue"])`);
      expect(code).toContain(`import.meta.glob(["/pages/**/*.vue","!**/components/**"])`);
      expect(code).not.toContain(
        `import.meta.glob(["/components/Counter.vue","/pages/**/*.vue","!**/components/**"])`,
      );
    }
  });

  it("'auto' with only bare targets emits no glob but keeps the fallback chain", () => {
    registerOnigiriTarget("ui-lib/Button.vue");
    const code = loadManifest(onigiriManifestPlugin(), { ssr: true }, { debug: vi.fn() });

    // No glob to emit, but importFn is still wired, so the native-import and
    // no-loader fallbacks (owned by manifest-runtime) stay reachable.
    expect(code).not.toContain("import.meta.glob");
    expect(code).toContain("const __glob = {}");
    expect(code).toContain("export const importFn = __createImportFn(__glob, __extra)");
  });

  it("does not log bare specifiers already covered by extraEntries", () => {
    registerOnigiriTarget("ui-lib/Button.vue");
    registerOnigiriTarget("ui-lib/Card.vue");
    registerOnigiriTarget("ui-lib/Modal.vue");
    const debug = vi.fn();

    loadManifest(
      onigiriManifestPlugin({
        extraEntries: {
          // Covers Button by exact key, Card by slash-toggled key, and
          // Modal as an entry value.
          "ui-lib/Button.vue": "ui-lib/Button.vue",
          "/ui-lib/Card.vue": "ui-lib/Card.vue",
          "/_assets/ui-lib/Modal.vue": "ui-lib/Modal.vue",
        },
      }),
      { ssr: true },
      { debug },
    );

    expect(debug).not.toHaveBeenCalled();
  });
});
