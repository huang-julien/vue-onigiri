// Real `vite build`s of one app through `onigiriPlugins`: a component
// registered only through `additionalImports` never reaches the browser
// bundle, and the SSR bundle compiles `v-load-client` through the transform
// the plugin injected into plugin-vue, with no hand-written `nodeTransforms`.
import path from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build, type Rollup } from "vite";
import vue from "@vitejs/plugin-vue";
import { onigiriPlugins } from "../src/vite/plugins";

const FIXTURE_ROOT = fileURLToPath(new NodeURL("fixtures/client-bundle-app/", import.meta.url));
const BUILD_TIMEOUT = 120_000;
const SERVER_MARKER = "SERVER_ONLY_SECRET_MARKER";

const srcUrl = (rel: string) => fileURLToPath(new NodeURL(`../src/${rel}`, import.meta.url));

/** Compiled SFCs and the manifest module import the published ids; point them at source. */
const RUNTIME_ALIASES = [
  { find: /^vue-onigiri$/, replacement: srcUrl("index.ts") },
  { find: /^vue-onigiri\/server$/, replacement: srcUrl("server.ts") },
];

const chunksOf = (output: Rollup.RollupOutput) =>
  output.output.filter((o): o is Rollup.OutputChunk => o.type === "chunk");

const moduleIdsOf = (chunks: Rollup.OutputChunk[]) =>
  chunks.flatMap((chunk) => chunk.moduleIds.map((id) => id.replaceAll("\\", "/")));

function plugins() {
  return [
    ...onigiriPlugins({
      additionalImports: { SecretServer: "/SecretServer.vue", Island: "/Island.vue" },
      clientInclude: "auto",
    }),
    vue(),
  ];
}

describe("client bundle", () => {
  it(
    "carries no additionalImports target and no v-load-client directive",
    async () => {
      const chunks = chunksOf(
        (await build({
          root: FIXTURE_ROOT,
          configFile: false,
          logLevel: "silent",
          plugins: plugins(),
          resolve: { alias: RUNTIME_ALIASES },
          build: {
            write: false,
            minify: false,
            rollupOptions: {
              input: path.join(FIXTURE_ROOT, "entry-client.ts"),
              external: ["vue"],
              preserveEntrySignatures: "exports-only",
            },
          },
        })) as Rollup.RollupOutput,
      );
      const moduleIds = moduleIdsOf(chunks);
      const code = chunks.map((chunk) => chunk.code).join("\n");

      expect(moduleIds.some((id) => id.endsWith("/SecretServer.vue"))).toBe(false);
      expect(code).not.toContain(SERVER_MARKER);
      expect(code).not.toContain('resolveDirective("load-client")');
      expect(code).not.toContain("ssrRenderClientComponent");
      // Only the server reads the chunk descriptor.
      expect(code).not.toContain("__onigiriDescriptor");
      // The generated manifest replaced the `vue-onigiri/manifest` stub.
      expect(code).not.toContain("is the stub");

      // The island still gets its own chunk through the scanned "auto" manifest.
      const islandChunk = chunks.find((chunk) =>
        chunk.moduleIds.some((id) => id.replaceAll("\\", "/").endsWith("/Island.vue")),
      );
      expect(islandChunk, "no chunk emitted for the v-load-client target").toBeDefined();
      expect(islandChunk).not.toBe(chunks.find((chunk) => chunk.isEntry));
    },
    BUILD_TIMEOUT,
  );

  it(
    "compiles the SSR bundle through the injected transform",
    async () => {
      const chunks = chunksOf(
        (await build({
          root: FIXTURE_ROOT,
          configFile: false,
          logLevel: "silent",
          plugins: plugins(),
          resolve: { alias: RUNTIME_ALIASES },
          build: { ssr: "entry.ts", write: false, minify: false },
        })) as Rollup.RollupOutput,
      );
      const code = chunks.map((chunk) => chunk.code).join("\n");

      expect(code).toContain("ssrRenderClientComponent(_component_Island, ");
      expect(code).not.toContain('resolveDirective("load-client")');
      expect(code).toContain(
        '__onigiriDescriptor = { "chunk": "/Island.vue", "export": "default" }',
      );
    },
    BUILD_TIMEOUT,
  );
});
