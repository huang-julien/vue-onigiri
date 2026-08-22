// @vitest-environment happy-dom

// Production-build e2e for the package-component path: a real
// node_modules package exposing a raw .vue used as a v-load-client
// target, built with `vite build` (client + SSR), server-rendered from
// the built bundle and hydrated against its emitted chunk. Everything
// between the fixture source and the hydrated DOM goes through the
// compiled output — this is the only test that does.
import path from "node:path";
// happy-dom's global URL resolves against the document; use Node's.
import { fileURLToPath, pathToFileURL, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createSSRApp, h, nextTick, Suspense } from "vue";
import { renderToString } from "@vue/server-renderer";
import { build, type InlineConfig, type Rollup } from "vite";
import vue from "@vitejs/plugin-vue";
import { onigiriCompilerPlugin } from "../src/vite/compiler";
import { onigiriManifestPlugin } from "../src/vite/manifest";
import { renderOnigiri } from "../src/runtime/deserialize";
import type { ImportFn } from "../src/runtime/utils";

const BUTTON_SPEC = "@vue-onigiri/test-ui-lib/Button.vue";
const FIXTURE_ROOT = fileURLToPath(new NodeURL("fixtures/build-app/", import.meta.url));
const BUILD_TIMEOUT = 120_000;

const srcUrl = (rel: string) => fileURLToPath(new NodeURL(`../src/${rel}`, import.meta.url));

/** Compiled onigiri code imports the published runtime ids; point them at source. */
const RUNTIME_ALIASES = Object.fromEntries(
  [
    "serialize",
    "deserialize",
    "shared",
    "utils",
    "with-directive",
    "render-slot",
    "resolve-component",
    "loader",
    "plugin",
    "manifest-runtime",
  ].map((mod) => [`vue-onigiri/runtime/${mod}`, srcUrl(`runtime/${mod}.ts`)]),
);

function fixtureConfig(): InlineConfig {
  return {
    root: FIXTURE_ROOT,
    configFile: false,
    logLevel: "silent",
    plugins: [
      onigiriCompilerPlugin(),
      vue(),
      onigiriManifestPlugin({
        extraEntries: { [BUTTON_SPEC]: BUTTON_SPEC },
      }),
    ],
    resolve: { alias: RUNTIME_ALIASES },
  };
}

let ssrEntry: { serialize: () => Promise<unknown>; importFn: ImportFn };
let clientEntry: { importFn: ImportFn };
let clientOutput: Rollup.RollupOutput;

beforeAll(async () => {
  await build({
    ...fixtureConfig(),
    // The package ships a raw .vue, so the SSR bundler must compile it
    // instead of externalizing it — a real host needs the same setting.
    ssr: { noExternal: ["@vue-onigiri/test-ui-lib"] },
    build: {
      ssr: "entry.ts",
      outDir: "dist/server",
      emptyOutDir: true,
      minify: false,
    },
  });
  const entryUrl = pathToFileURL(path.join(FIXTURE_ROOT, "dist/server/entry.js")).href;
  ssrEntry = await import(entryUrl);

  clientOutput = (await build({
    ...fixtureConfig(),
    build: {
      outDir: "dist/client",
      emptyOutDir: true,
      minify: false,
      // Plain dynamic imports instead of the DOM preload helper, so the
      // test can import the built chunks off disk.
      modulePreload: false,
      rollupOptions: {
        input: path.join(FIXTURE_ROOT, "entry-client.ts"),
        // Share the test realm's Vue with the loaded chunk, like a real
        // page shares one Vue between app bundle and island chunks.
        external: ["vue"],
        // Fixture-only: the entry exists just to re-export importFn, so
        // keep its exports from being tree-shaken. Real client entries
        // consume importFn as a side effect of bootstrapping.
        preserveEntrySignatures: "exports-only",
      },
    },
  })) as Rollup.RollupOutput;
  const clientUrl = pathToFileURL(
    path.join(FIXTURE_ROOT, "dist/client", clientOutput.output.find((o) => o.type === "chunk" && o.isEntry)!.fileName),
  ).href;
  clientEntry = await import(clientUrl);
}, BUILD_TIMEOUT);

describe("production build e2e: package component via extraEntries", () => {
  it("client build emits a browser chunk for the package component", () => {
    const chunks = clientOutput.output.filter(
      (o): o is Rollup.OutputChunk => o.type === "chunk",
    );
    const buttonChunk = chunks.find((chunk) =>
      chunk.moduleIds.some((id) => id.replaceAll("\\", "/").endsWith("test-ui-lib/Button.vue")),
    );
    expect(buttonChunk, "no chunk emitted for the package .vue").toBeDefined();
    // The literal entry must survive as a lazy import: the Button chunk
    // stays separate from the entry instead of being inlined into it.
    const entryChunk = chunks.find((chunk) => chunk.isEntry)!;
    expect(buttonChunk).not.toBe(entryChunk);
    expect(entryChunk.code).toContain(BUTTON_SPEC);
    expect(entryChunk.dynamicImports).toContain(buttonChunk!.fileName);
  });

  it("built SSR bundle serializes the AST with the bare specifier as the chunk reference", async () => {
    const payload = await ssrEntry.serialize();
    expect(JSON.stringify(payload)).toContain(JSON.stringify(BUTTON_SPEC));
  });

  it("SSR-renders with the server chunk and hydrates with the client chunk", async () => {
    const payload = (await ssrEntry.serialize()) as any;

    const makeApp = (importFn: ImportFn, onResolve?: () => void) =>
      createSSRApp({
        setup: () => () =>
          h(Suspense, { onResolve }, {
            default: () => renderOnigiri(payload, { importFn }),
          }),
      });

    // Server side: the built server importFn resolves the bare specifier
    // to the chunk the SSR build emitted.
    const html = await renderToString(makeApp(ssrEntry.importFn));
    expect(html).toContain("UI Lib Button: 0");

    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // Client side: hydrate against the browser build's emitted chunk. The
    // chunk loads through real module I/O, so wait for the Suspense
    // boundary instead of counting microtask flushes.
    const { promise: hydrated, resolve } = Promise.withResolvers<void>();
    makeApp(clientEntry.importFn, () => resolve()).mount(container);
    await hydrated;
    await flushPromises();
    await nextTick();

    const complaints = [...warn.mock.calls, ...error.mock.calls]
      .map((c) => String(c[0]))
      .filter((m) => /hydrat|mismatch/i.test(m));
    expect(complaints).toEqual([]);

    // Interactivity proves the island hydrated from the built chunk. The
    // chunk import is real disk I/O (a macrotask), so listener attachment
    // can land after Suspense resolves — retry until a click counts (any
    // non-zero count proves it; retried clicks keep incrementing).
    await vi.waitFor(async () => {
      container.querySelector<HTMLButtonElement>("button.ui-lib-button")!.click();
      await nextTick();
      expect(container.innerHTML).toMatch(/UI Lib Button: [1-9]/);
    });

    warn.mockRestore();
    error.mockRestore();
    container.remove();
  });
});
