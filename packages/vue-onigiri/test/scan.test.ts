import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { scanClientTargets } from "../src/vite/scan";
import { onigiriScanPlugin } from "../src/vite/scan-plugin";
import { onigiriManifestPlugin } from "../src/vite/manifest";
import { createOnigiriRegistry } from "../src/vite/shared";

const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

async function runScan(overrides: Partial<Parameters<typeof scanClientTargets>[0]> = {}) {
  const registerTarget = vi.fn();
  const warn = vi.fn();
  await scanClientTargets({
    root: FIXTURES,
    include: ["scan"],
    additionalImports: new Map([["AutoWidget", { path: "/widgets/AutoWidget.vue" }]]),
    registerTarget,
    warn,
    ...overrides,
  });
  return { registerTarget, warn };
}

describe("scanClientTargets", () => {
  it("registers targets resolved through script imports and additionalImports", async () => {
    const { registerTarget } = await runScan();

    const targets = registerTarget.mock.calls.map(([t]) => t);
    expect(targets).toContain("/components/Counter.vue");
    expect(targets).toContain("/widgets/AutoWidget.vue");
  });

  it("matches kebab-case tags against PascalCase imports, through nested elements", async () => {
    const { registerTarget } = await runScan();

    const targets = registerTarget.mock.calls.map(([t]) => t);
    expect(targets).toContain("/components/LoadComponent.vue");
  });

  it("warns for <component :is> carrying the marker, naming the file", async () => {
    const { warn } = await runScan();

    const dynamicWarning = warn.mock.calls.find(([msg]) => msg.includes("<component :is>"));
    expect(dynamicWarning?.[0]).toContain("/scan/PageDynamic.vue");
    expect(dynamicWarning?.[0]).toContain("clientInclude");
  });

  it("warns for tags resolving through neither imports nor additionalImports", async () => {
    const { warn } = await runScan();

    const unresolved = warn.mock.calls.find(([msg]) => msg.includes("MysteryComp"));
    expect(unresolved?.[0]).toContain("/scan/PageUnresolved.vue");
  });

  it("skips tags matched by isCustomElement instead of warning", async () => {
    const { warn } = await runScan({ isCustomElement: (tag) => tag === "MysteryComp" });

    expect(warn.mock.calls.some(([msg]) => msg.includes("MysteryComp"))).toBe(false);
  });

  it("does not register anything outside the include dirs", async () => {
    const { registerTarget, warn } = await runScan({ include: ["scan/does-not-exist"] });

    expect(registerTarget).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("onigiriScanPlugin buildStart scan + manifest 'auto'", () => {
  it("populates targets before load so clientInclude 'auto' emits their loaders", async () => {
    const registry = createOnigiriRegistry();
    const plugin = onigiriScanPlugin({
      registry,
      include: ["scan"],
      additionalImports: { AutoWidget: "/widgets/AutoWidget.vue" },
    }) as any;
    plugin.configResolved({ root: FIXTURES, isProduction: false });

    const ctx = { resolve: async () => null, warn: vi.fn() };
    await plugin.buildStart.call(ctx);
    // Second buildStart (other environment) reuses the memoized scan.
    await plugin.buildStart.call(ctx);

    expect(registry.targets()).toContain("/components/Counter.vue");
    expect(registry.targets()).toContain("/widgets/AutoWidget.vue");

    const manifest = onigiriManifestPlugin({ clientInclude: "auto", registry }) as any;
    const clientCode = manifest.load("\0virtual:onigiri/manifest", { ssr: false });
    expect(clientCode).toContain(
      `"/components/Counter.vue": () => import("/components/Counter.vue")`,
    );
  });

  it("standalone scan and manifest plugins share a default registry", async () => {
    const plugin = onigiriScanPlugin({ include: ["scan"] }) as any;
    plugin.configResolved({ root: FIXTURES, isProduction: false });
    await plugin.buildStart.call({ resolve: async () => null, warn: vi.fn() });

    const manifest = onigiriManifestPlugin({ clientInclude: "auto" }) as any;
    expect(manifest.load("\0virtual:onigiri/manifest", { ssr: false })).toContain(
      `"/components/Counter.vue": () => import("/components/Counter.vue")`,
    );
  });
});
