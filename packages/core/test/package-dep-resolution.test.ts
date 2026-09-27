// Regression for bare imports inside the generated onigiri module. The
// package component imports a dependency only its own package declares:
// it resolves from the component's directory, never from the app root.
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build, createServer, type InlineConfig, type ViteDevServer } from "vite";
import { createDefaultImportMeta, ESModulesEvaluator, ModuleRunner } from "vite/module-runner";
import vue from "@vitejs/plugin-vue";
import { onigiriCompilerPlugin } from "../src/vite/compiler";
import { toOnigiriId } from "../src/vite/compiler/constants";

const LIB = "@vue-onigiri/test-ui-lib";
const DEP = "@vue-onigiri/test-ui-dep";
const FIXTURE_ROOT = fileURLToPath(new URL("fixtures/dep-app/", import.meta.url));
const TIMEOUT = 120_000;

const srcUrl = (rel: string) => fileURLToPath(new URL(`../src/${rel}`, import.meta.url));

/** Compiled onigiri code imports the published runtime ids; point them at source. */
const RUNTIME_ALIASES = Object.fromEntries(
  ["serialize", "shared", "utils", "with-directive", "render-slot", "resolve-component"].map(
    (mod) => [`vue-onigiri/runtime/${mod}`, srcUrl(`runtime/${mod}.ts`)],
  ),
);

function fixtureConfig(): InlineConfig {
  return {
    root: FIXTURE_ROOT,
    configFile: false,
    logLevel: "silent",
    plugins: [onigiriCompilerPlugin(), vue()],
    resolve: { alias: RUNTIME_ALIASES },
  };
}

const labelPath = () =>
  createRequire(path.join(FIXTURE_ROOT, "entry.ts")).resolve(`${LIB}/Label.vue`);

describe("fixture layout", () => {
  it("hides the dependency from the app root", () => {
    const fromRoot = createRequire(path.join(FIXTURE_ROOT, "entry.ts"));
    expect(() => fromRoot.resolve(DEP)).toThrow();
    expect(existsSync(createRequire(labelPath()).resolve(DEP))).toBe(true);
  });
});

describe("dev SSR: package component with its own dependency", () => {
  let server: ViteDevServer;
  let runner: ModuleRunner;

  beforeAll(async () => {
    server = await createServer({
      ...fixtureConfig(),
      appType: "custom",
      server: { middlewareMode: true, ws: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
      // The package ships a raw .vue, its dependency ships plain JS: the
      // first is compiled by Vite, the second stays a runtime bare import.
      ssr: { noExternal: [LIB], external: [DEP] },
    });
    const { hot } = server.environments.ssr;
    // `createServerModuleRunner` registers Node module hooks, which Vitest forbids.
    runner = new ModuleRunner(
      {
        transport: { invoke: (payload) => hot.handleInvoke(payload) },
        hmr: false,
        sourcemapInterceptor: false,
        createImportMeta: createDefaultImportMeta,
      },
      new ESModulesEvaluator(),
    );
  }, TIMEOUT);

  afterAll(async () => {
    await runner?.close();
    await server?.close();
  });

  it(
    "serializes through the module runner",
    async () => {
      const entry = await runner.import("/entry.ts");
      const payload = await entry.serialize();
      expect(JSON.stringify(payload)).toContain("[dep] hello");
    },
    TIMEOUT,
  );

  it("keys the generated module on the component's real path", async () => {
    const id = toOnigiriId(labelPath().replaceAll("\\", "/"));
    const mod = server.environments.ssr.moduleGraph.getModuleById(id);
    expect(mod, `no module for ${id}`).toBeDefined();
    expect(mod!.transformResult?.code).toContain("__onigiriRender");
  });

  it("invalidates the generated module when the SFC changes", () => {
    const file = labelPath().replaceAll("\\", "/");
    const { moduleGraph } = server.environments.ssr;
    const mod = moduleGraph.getModuleById(toOnigiriId(file))!;
    expect(mod.transformResult).not.toBeNull();

    moduleGraph.onFileChange(file);
    expect(mod.transformResult).toBeNull();
  });

  it(
    "serves the generated module to the client under the url the SFC imports",
    async () => {
      const client = server.environments.client;
      const sfc = await client.transformRequest(`/@fs/${labelPath().replaceAll("\\", "/")}`);
      const url = /import __onigiriRender from "([^"]+)"/.exec(sfc!.code)?.[1];
      expect(url).toBeDefined();

      const generated = await client.transformRequest(url!.replace(/^\/@id\//, ""));
      expect(generated?.code).toContain("export default function __onigiriRender");
      // plugin-vue must leave it alone: no SFC main-module wrapper.
      expect(generated?.code).not.toContain("_sfc_main");
    },
    TIMEOUT,
  );
});

describe("build: package component with its own dependency", () => {
  it(
    "serializes from the built SSR bundle",
    async () => {
      await build({
        ...fixtureConfig(),
        ssr: { noExternal: [LIB, DEP] },
        build: { ssr: "entry.ts", outDir: "dist/server", emptyOutDir: true, minify: false },
      });
      const entry = await import(
        pathToFileURL(path.join(FIXTURE_ROOT, "dist/server/entry.js")).href
      );
      const payload = await entry.serialize();
      expect(JSON.stringify(payload)).toContain("[dep] hello");
    },
    TIMEOUT,
  );
});
