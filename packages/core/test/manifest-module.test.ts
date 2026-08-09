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

  it("looks up extras (exact, then slash-toggled) before the glob, before the native fallback, before the throw", () => {
    const code = loadManifest(
      onigiriManifestPlugin({
        serverInclude: "/components/**/*.vue",
        extraEntries: { "ui-lib/Button.vue": "ui-lib/Button.vue" },
      }),
      { ssr: true },
    );

    const exact = code.indexOf("__extra[src]");
    const toggled = code.indexOf("__extra[src.startsWith('/') ? src.slice(1) : key]");
    const glob = code.indexOf("__glob[key]");
    const fallback = code.indexOf("await import(/* @vite-ignore */ src)");
    const noLoader = code.indexOf("No loader registered");
    expect(exact).toBeGreaterThan(-1);
    expect(toggled).toBeGreaterThan(exact);
    expect(glob).toBeGreaterThan(toggled);
    expect(fallback).toBeGreaterThan(glob);
    expect(noLoader).toBeGreaterThan(fallback);
  });

  it("stub mode drops extras along with the glob", () => {
    const code = loadManifest(
      onigiriManifestPlugin({
        stub: true,
        extraEntries: { "ui-lib/Button.vue": "ui-lib/Button.vue" },
      }),
      { ssr: true },
    );

    expect(code).not.toContain("__extra");
    expect(code).not.toContain("import.meta.glob");
  });

  it("omits __extra entirely for missing or empty extraEntries", () => {
    expect(loadManifest(onigiriManifestPlugin(), { ssr: true })).not.toContain("__extra");
    expect(loadManifest(onigiriManifestPlugin({ extraEntries: {} }), { ssr: true }))
      .not.toContain("__extra");
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

  it("'auto' with only bare targets emits no glob but keeps the fallback chain", () => {
    registerOnigiriTarget("ui-lib/Button.vue");
    const code = loadManifest(onigiriManifestPlugin(), { ssr: true }, { debug: vi.fn() });

    expect(code).not.toContain("import.meta.glob");
    expect(code).toContain("No loader registered");
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
