import { beforeEach, describe, expect, it, vi } from "vitest";
import { onigiriManifestPlugin, type OnigiriManifestPluginOptions } from "../src/vite/manifest";
import { createOnigiriRegistry, type OnigiriRegistry } from "../src/vite/shared";

const MANIFEST_ID = "\0virtual:onigiri/manifest";

type LoadOptions = { ssr?: boolean };

/** `load` reads `this.debug` and `this.environment` off the plugin context, so bind a fake ctx. */
function loadManifest(
  plugin: ReturnType<typeof onigiriManifestPlugin>,
  opts?: LoadOptions,
  ctx: object = {},
): string {
  const load = plugin.load as (this: unknown, id: string, opts?: LoadOptions) => string;
  return load.call(ctx, MANIFEST_ID, opts);
}

describe("generated manifest module", () => {
  let registry: OnigiriRegistry;
  const manifestPlugin = (options: OnigiriManifestPluginOptions = {}) =>
    onigiriManifestPlugin({ registry, ...options });

  beforeEach(() => {
    registry = createOnigiriRegistry();
  });

  it("emits literal import entries in both environments", () => {
    const plugin = manifestPlugin({
      serverInclude: "/components/**/*.vue",
      clientInclude: "/components/**/*.vue",
      extraEntries: { "ui-lib/Button.vue": "ui-lib/Button.vue" },
    });

    for (const opts of [{ ssr: true }, { ssr: false }]) {
      const code = loadManifest(plugin, opts);
      expect(code).toContain(`"ui-lib/Button.vue": () => import("ui-lib/Button.vue")`);
    }
  });

  it("builds importFn lazily from createImportFn over the two generated tables", () => {
    const code = loadManifest(
      manifestPlugin({
        serverInclude: "/components/**/*.vue",
        extraEntries: { "ui-lib/Button.vue": "ui-lib/Button.vue" },
      }),
      { ssr: true },
    );

    // Resolution lives in `createImportFn`; the module only supplies the tables.
    expect(code).toContain(`import { createImportFn as __createImportFn } from "vue-onigiri"`);
    expect(code).toContain(
      "export const importFn = (src, exportName) => (__importFn ??= __createImportFn(__glob, __extra))(src, exportName)",
    );
    expect(code).toContain("export const manifest = { ...__glob, ...__extra }");
    expect(code).toContain("export { __createImportFn as createImportFn }");
    // Nothing from the root entry may run while the module evaluates.
    expect(code).not.toMatch(/^(?:const|export const) \w+ = __createImportFn\(/m);
  });

  it("picks the environment from `this.environment` before the `ssr` flag", () => {
    registry.register("/components/Counter.vue");
    const plugin = manifestPlugin({ serverInclude: "auto", clientInclude: false });
    const client = { environment: { config: { consumer: "client" } } };
    const server = { environment: { config: { consumer: "server" } } };

    expect(loadManifest(plugin, { ssr: true }, client)).not.toContain("Counter.vue");
    expect(loadManifest(plugin, { ssr: false }, server)).toContain("Counter.vue");
    expect(loadManifest(plugin, { ssr: false })).not.toContain("Counter.vue");
    expect(loadManifest(plugin, undefined)).toContain("Counter.vue");
  });

  it("stub mode emits empty tables, with no glob and no literal loaders", () => {
    registry.register("/components/Counter.vue");
    const code = loadManifest(
      manifestPlugin({
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
    for (const plugin of [manifestPlugin(), manifestPlugin({ extraEntries: {} })]) {
      const code = loadManifest(plugin, { ssr: true });
      expect(code).toContain("const __extra = {}");
      expect(code).not.toContain("() => import(");
    }
  });

  it("wires the runtime identically in every configuration", () => {
    registry.register("/components/Counter.vue");
    const shapes = [
      manifestPlugin({ stub: true }),
      manifestPlugin({ serverInclude: "auto" }),
      manifestPlugin({ serverInclude: false, extraEntries: { "a/B.vue": "a/B.vue" } }),
      manifestPlugin({ serverInclude: "auto", extraEntries: { "a/B.vue": "a/B.vue" } }),
    ];

    // Only the two table literals vary; the import and the exports are constant,
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

  it("emits scanned targets as literal loaders, keeping glob metacharacters literal", () => {
    for (const target of [
      "/pages/[id].vue",
      "/(group)/Foo.vue",
      "/x/{a,b}.vue",
      "/x/a+b.vue",
      "/x/@scope.vue",
      "/x/!neg.vue",
    ]) {
      registry.register(target);
    }
    const code = loadManifest(manifestPlugin(), { ssr: true });

    expect(code).toContain(`"/pages/[id].vue": () => import("/pages/[id].vue")`);
    expect(code).toContain(`"/(group)/Foo.vue": () => import("/(group)/Foo.vue")`);
    expect(code).toContain(`"/x/{a,b}.vue": () => import("/x/{a,b}.vue")`);
    expect(code).toContain(`"/x/!neg.vue": () => import("/x/!neg.vue")`);
    expect(code).not.toContain("import.meta.glob");
  });

  it("loads a `[id].vue` target through the generated importFn", async () => {
    registry.register("/pages/[id].vue");
    const code = loadManifest(manifestPlugin(), { ssr: true });
    const page = { name: "Page" };
    const imported: string[] = [];
    const createImportFn = (await import("../src/runtime/manifest-runtime")).createImportFn;
    // Evaluate the generated module with stubbed imports and `import()`.
    const body = code
      .split("\n")
      .filter((line) => !line.startsWith("import ") && !line.startsWith("export {"))
      .join("\n")
      .replaceAll("export const ", "const ")
      .replaceAll("import(", "__import(");
    const evaluate = new Function("__createImportFn", "__import", `${body}\nreturn importFn;`) as (
      create: typeof createImportFn,
      load: (spec: string) => Promise<unknown>,
    ) => (src: string) => Promise<unknown>;
    const importFn = evaluate(createImportFn, async (spec) => {
      imported.push(spec);
      return { default: page };
    });

    await expect(importFn("/pages/[id].vue")).resolves.toBe(page);
    expect(imported).toEqual(["/pages/[id].vue"]);
  });

  it("keeps the glob for user patterns next to the literal targets", () => {
    registry.register("/components/Counter.vue");
    const include = ["auto", "/pages/**/*.vue", "!**/components/**"];
    const serverCode = loadManifest(manifestPlugin({ serverInclude: include }), { ssr: true });
    const clientCode = loadManifest(manifestPlugin({ clientInclude: include }), { ssr: false });

    for (const code of [serverCode, clientCode]) {
      expect(code).toContain(`"/components/Counter.vue": () => import("/components/Counter.vue")`);
      expect(code).toContain(
        `const __glob = import.meta.glob(["/pages/**/*.vue","!**/components/**"])`,
      );
    }
  });

  it("lets an extraEntries key win over the same scanned target", () => {
    registry.register("/components/Counter.vue");
    const code = loadManifest(
      manifestPlugin({ extraEntries: { "/components/Counter.vue": "~/Counter.vue" } }),
      { ssr: true },
    );

    expect(code).toContain(`"/components/Counter.vue": () => import("~/Counter.vue")`);
    expect(code.match(/"\/components\/Counter\.vue":/g)).toHaveLength(1);
  });

  it("'auto' filters bare package specifiers out and debug-logs them once", () => {
    registry.register("/components/Counter.vue");
    registry.register("ui-lib/Button.vue");
    const plugin = manifestPlugin();
    const debug = vi.fn();

    const code = loadManifest(plugin, { ssr: true }, { debug });
    expect(code).toContain(`"/components/Counter.vue": () => import("/components/Counter.vue")`);
    expect(code).not.toContain("ui-lib/Button.vue");
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug.mock.calls[0]![0]).toContain(`"ui-lib/Button.vue"`);
    expect(debug.mock.calls[0]![0]).toContain("extraEntries");

    // Second load (other environment / reload) stays quiet.
    loadManifest(plugin, { ssr: false }, { debug });
    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("'auto' with only bare targets emits empty tables but keeps the fallback chain", () => {
    registry.register("ui-lib/Button.vue");
    const code = loadManifest(manifestPlugin(), { ssr: true }, { debug: vi.fn() });

    // No loader to emit, but importFn is still wired, so the native-import and
    // no-loader fallbacks (owned by manifest-runtime) stay reachable.
    expect(code).not.toContain("import.meta.glob");
    expect(code).toContain("const __glob = {}");
    expect(code).toContain("const __extra = {}");
    expect(code).toContain("export const importFn = ");
  });

  it("does not log bare specifiers already covered by extraEntries", () => {
    registry.register("ui-lib/Button.vue");
    registry.register("ui-lib/Card.vue");
    registry.register("ui-lib/Modal.vue");
    const debug = vi.fn();

    loadManifest(
      manifestPlugin({
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

  it("ignores inherited keys when checking extraEntries coverage", () => {
    registry.register("constructor");
    const debug = vi.fn();
    loadManifest(manifestPlugin({ extraEntries: {} }), { ssr: true }, { debug });

    expect(debug).toHaveBeenCalledTimes(1);
  });

  it("only reads targets of its own registry", () => {
    registry.register("/components/Counter.vue");
    const other = onigiriManifestPlugin({ registry: createOnigiriRegistry() });

    expect(loadManifest(other, { ssr: true })).not.toContain("Counter.vue");
  });
});
