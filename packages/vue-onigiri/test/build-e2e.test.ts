// @vitest-environment happy-dom

// Production-build e2e for the package-component path: a real
// node_modules package exposing a raw .vue used as a v-load-client
// target, built with `vite build` (client + SSR), server-rendered from
// the built bundle and hydrated against its emitted chunk. Everything
// between the fixture source and the hydrated DOM goes through the
// compiled output; this is the only test that does.
import path from "node:path";
// happy-dom's global URL resolves against the document; use Node's.
import { fileURLToPath, pathToFileURL, URL as NodeURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { flushPromises } from "@vue/test-utils";
import { createSSRApp, h, nextTick, Suspense } from "vue";
import { build, type InlineConfig, type Rollup } from "vite";
import vue from "@vitejs/plugin-vue";
import { onigiriPlugins } from "../src/vite/plugins";
import { domToVNode } from "../src/runtime/dom-to-vnode";
import type { ImportFn } from "../src/runtime/utils";

const BUTTON_SPEC = "vue-onigiri-test-ui-lib/Button.vue";
const FIXTURE_ROOT = fileURLToPath(new NodeURL("fixtures/build-app/", import.meta.url));
const BUILD_TIMEOUT = 120_000;

const srcUrl = (rel: string) => fileURLToPath(new NodeURL(`../src/${rel}`, import.meta.url));

/** Compiled SFCs and the manifest module import the published ids; point them at source. */
const RUNTIME_ALIASES = [
  { find: /^vue-onigiri$/, replacement: srcUrl("index.ts") },
  { find: /^vue-onigiri\/server$/, replacement: srcUrl("server.ts") },
];

function fixtureConfig(): InlineConfig {
  return {
    root: FIXTURE_ROOT,
    configFile: false,
    logLevel: "silent",
    plugins: [...onigiriPlugins({ extraEntries: { [BUTTON_SPEC]: BUTTON_SPEC } }), vue()],
    resolve: { alias: RUNTIME_ALIASES },
  };
}

let ssrEntry: { render: () => Promise<{ html: string; nonce: string }>; importFn: ImportFn };
let clientEntry: { importFn: ImportFn };
let clientOutput: Rollup.RollupOutput;

beforeAll(async () => {
  await build({
    ...fixtureConfig(),
    // The package ships a raw .vue, so the SSR bundler must compile it
    // instead of externalizing it; a real host needs the same setting.
    ssr: { noExternal: ["vue-onigiri-test-ui-lib"] },
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
    path.join(
      FIXTURE_ROOT,
      "dist/client",
      clientOutput.output.find((o) => o.type === "chunk" && o.isEntry)!.fileName,
    ),
  ).href;
  clientEntry = await import(clientUrl);
}, BUILD_TIMEOUT);

describe("production build e2e: package component via extraEntries", () => {
  it("client build emits a browser chunk for the package component", () => {
    const chunks = clientOutput.output.filter((o): o is Rollup.OutputChunk => o.type === "chunk");
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

  it("built SSR bundle marks the package component with its bare specifier", async () => {
    const { html, nonce } = await ssrEntry.render();
    expect(html).toContain(`<!--o:c:${nonce}[1,null,${JSON.stringify(BUTTON_SPEC)},"default"]-->`);
    expect(html).toContain("UI Lib Button: 0");
  });

  it("hydrates the built SSR HTML with the client chunk", async () => {
    const { html, nonce } = await ssrEntry.render();
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    // The chunk loads through real module I/O, so wait for the Suspense
    // boundary instead of counting microtask flushes.
    const { promise: hydrated, resolve } = Promise.withResolvers<void>();
    createSSRApp({
      setup: () => () =>
        h(
          Suspense,
          { onResolve: () => resolve() },
          {
            default: () =>
              domToVNode(container.firstChild!, { nonce, importFn: clientEntry.importFn }),
          },
        ),
    }).mount(container);
    await hydrated;
    await flushPromises();
    await nextTick();

    const complaints = [...warn.mock.calls, ...error.mock.calls]
      .map((c) => String(c[0]))
      .filter((m) => /hydrat|mismatch/i.test(m));
    expect(complaints).toEqual([]);

    // Listener attachment can land after Suspense resolves, since the chunk
    // import is real disk I/O; retry until a click counts.
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
