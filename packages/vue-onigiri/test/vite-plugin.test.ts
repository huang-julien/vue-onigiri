import path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { Plugin, ResolvedConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import type { NodeTransform } from "@vue/compiler-dom";
import { onigiriCompilerPlugin } from "../src/vite/compiler";
import { ssrLoadClientTransform } from "../src/vite/compiler/ssr-load-client";
import { onigiriPlugins } from "../src/vite/plugins";
import { onigiriScanPlugin } from "../src/vite/scan-plugin";
import { createOnigiriRegistry } from "../src/vite/shared";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

interface VueApi {
  options: { template?: { compilerOptions?: { nodeTransforms?: NodeTransform[] } } };
}

/** Run the compiler plugin's `configResolved` against a plugin list, returning its logger. */
function resolveWith(plugin: Plugin, plugins: Plugin[], root = ROOT) {
  const logger = { warn: vi.fn() };
  (plugin.configResolved as (config: ResolvedConfig) => void)({
    root,
    plugins,
    logger,
  } as unknown as ResolvedConfig);
  return logger;
}

function transform(plugin: Plugin, code: string, id: string) {
  return (plugin.transform as (code: string, id: string) => { code: string } | null)(code, id);
}

function nodeTransformsOf(plugin: Plugin): NodeTransform[] | undefined {
  return (plugin.api as VueApi).options.template?.compilerOptions?.nodeTransforms;
}

describe("onigiriPlugins", () => {
  it("returns scan, compiler, manifest in that order", () => {
    expect(onigiriPlugins().map((plugin) => plugin.name)).toEqual([
      "vite:vue-onigiri-scan",
      "vite:vue-onigiri-compiler",
      "vite:vue-onigiri-manifest",
    ]);
  });

  it("drops the scan plugin when scan is disabled", () => {
    expect(onigiriPlugins({ scan: false }).map((plugin) => plugin.name)).toEqual([
      "vite:vue-onigiri-compiler",
      "vite:vue-onigiri-manifest",
    ]);
  });
});

describe("ssrLoadClientTransform injection", () => {
  it("adds the transform to every plugin-vue instance, after the user's own", () => {
    const own: NodeTransform = () => {};
    const first = vue({ template: { compilerOptions: { nodeTransforms: [own] } } }) as Plugin;
    const second = vue({ include: /\.other\.vue$/ }) as Plugin;
    const logger = resolveWith(onigiriCompilerPlugin(), [first, second]);

    expect(nodeTransformsOf(first)).toEqual([own, ssrLoadClientTransform]);
    expect(nodeTransformsOf(second)).toEqual([ssrLoadClientTransform]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps the user's other template options and injects once", () => {
    const isCustomElement = (tag: string) => tag.startsWith("x-");
    const plugin = vue({
      template: { transformAssetUrls: false, compilerOptions: { isCustomElement } },
    }) as Plugin;
    resolveWith(onigiriCompilerPlugin(), [plugin]);
    resolveWith(onigiriCompilerPlugin(), [plugin]);

    const { template } = (plugin.api as VueApi & { options: { template: any } }).options;
    expect(template.transformAssetUrls).toBe(false);
    expect(template.compilerOptions.isCustomElement).toBe(isCustomElement);
    expect(nodeTransformsOf(plugin)).toEqual([ssrLoadClientTransform]);
  });

  it("survives plugin-vue's own configResolved", () => {
    const plugin = vue() as Plugin;
    resolveWith(onigiriCompilerPlugin(), [plugin]);
    (plugin.configResolved as (config: unknown) => void)({
      root: ROOT,
      command: "build",
      build: { sourcemap: false },
      isProduction: true,
      define: {},
      logger: { warn: () => {} },
    });
    expect(nodeTransformsOf(plugin)).toEqual([ssrLoadClientTransform]);
  });

  it("warns when no plugin-vue instance is registered", () => {
    const logger = resolveWith(onigiriCompilerPlugin(), []);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("ssrLoadClientTransform"));
  });
});

describe("descriptor attachment", () => {
  const SFC = path.join(ROOT, "components/Foo.vue").replaceAll("\\", "/");

  function attach(code: string, id = SFC, options = {}) {
    const plugin = onigiriCompilerPlugin({ sourceMap: false, ...options });
    resolveWith(plugin, [vue() as Plugin]);
    return transform(plugin, code, id)?.code;
  }

  it.each([
    [
      "_export_sfc",
      `const _sfc_main = {};\nexport default /*#__PURE__*/_export_sfc(_sfc_main, [])`,
    ],
    ["variable", `const _sfc_main = {};\nexport default _sfc_main`],
  ])("attaches to the %s export shape", (_name, code) => {
    expect(attach(code)).toContain(
      '_sfc_main.__onigiriDescriptor = {"chunk":"/components/Foo.vue","export":"default"};',
    );
  });

  it("rewrites an inline object export", () => {
    const code = attach(`export default { name: "Foo" }`)!;
    expect(code).toContain(`const __sfc_with_onigiri = { name: "Foo" }`);
    expect(code).toContain("__sfc_with_onigiri.__onigiriDescriptor = ");
    expect(code).toContain("export default __sfc_with_onigiri;");
  });

  it("bakes resolveChunkUrl's URL, and keeps the source path when it returns undefined", () => {
    const code = `const _sfc_main = {};\nexport default _sfc_main`;
    expect(attach(code, SFC, { resolveChunkUrl: () => "/_nuxt/Foo.abc.js" })).toContain(
      '"chunk":"/_nuxt/Foo.abc.js"',
    );
    expect(attach(code, SFC, { resolveChunkUrl: () => undefined })).toContain(
      '"chunk":"/components/Foo.vue"',
    );
  });

  it("names a package file by its bare specifier", () => {
    const button = fileURLToPath(new URL("../../test-ui-lib/Button.vue", import.meta.url));
    const code = `const _sfc_main = {};\nexport default _sfc_main`;
    expect(attach(code, button.replaceAll("\\", "/"))).toContain(
      '"chunk":"vue-onigiri-test-ui-lib/Button.vue"',
    );
  });

  it("leaves sub-requests and non-SFC modules alone", () => {
    const code = `const _sfc_main = {};\nexport default _sfc_main`;
    expect(attach(code, `${SFC}?vue&type=script&setup=true&lang.ts`)).toBeUndefined();
    expect(attach(code, SFC.replace(".vue", ".ts"))).toBeUndefined();
  });

  it("attaches only in server builds", () => {
    const plugin = onigiriCompilerPlugin({ sourceMap: false });
    resolveWith(plugin, [vue() as Plugin]);
    const code = `const _sfc_main = {};\nexport default _sfc_main`;
    const run = (ctx: unknown, opts?: { ssr?: boolean }) =>
      (
        plugin.transform as (
          this: unknown,
          code: string,
          id: string,
          opts?: { ssr?: boolean },
        ) => { code: string } | null
      ).call(ctx, code, SFC, opts)?.code;
    const env = (consumer: string) => ({ environment: { config: { consumer } } });

    expect(run(env("client"), { ssr: true })).toBeUndefined();
    expect(run(env("server"), { ssr: false })).toContain("__onigiriDescriptor");
    // Callers without the environment API fall back to the `ssr` flag.
    expect(run(undefined, { ssr: false })).toBeUndefined();
    expect(run(undefined, { ssr: true })).toContain("__onigiriDescriptor");
  });
});

describe("onigiriScanPlugin dev transform", () => {
  function scanPlugin(command: "serve" | "build") {
    const registry = createOnigiriRegistry();
    const plugin = onigiriScanPlugin({ include: ["does-not-exist"], registry }) as Plugin;
    (plugin.configResolved as (config: ResolvedConfig) => void)({
      root: ROOT,
      command,
    } as ResolvedConfig);
    const ctx = { resolve: async () => null, warn: vi.fn() };
    const file = path.join(ROOT, "test/fixtures/scan/PageWithMarker.vue");
    const run = () =>
      (plugin.transform as (this: unknown, code: string, id: string) => Promise<void>).call(
        ctx,
        readFileSync(file, "utf8"),
        file,
      );
    return { run, ctx, registry };
  }

  it("registers targets of an SFC as dev transforms it, warning once per unresolved tag", async () => {
    const { run, ctx, registry } = scanPlugin("serve");
    await run();
    await run();
    expect(registry.targets()).toContain("/test/fixtures/components/Counter.vue");
    expect(ctx.warn).toHaveBeenCalledTimes(1);
    expect(ctx.warn.mock.calls[0]![0]).toContain("AutoWidget");
  });

  it("leaves builds to the buildStart pre-pass", async () => {
    const { run, registry } = scanPlugin("build");
    await run();
    expect(registry.targets()).toEqual([]);
  });
});
