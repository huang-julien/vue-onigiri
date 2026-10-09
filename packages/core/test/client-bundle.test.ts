// Real client `vite build`: a server-rendered component registered only
// through `additionalImports` must stay out of the browser bundle. The
// onigiri render that would import it is server-only, so the client build
// carries neither; the SSR build still carries both.
import path from "node:path";
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build, type Rollup } from "vite";
import vue from "@vitejs/plugin-vue";
import { parseOnigiriId } from "../src/vite/compiler/constants";
import { onigiriPlugins } from "../src/vite/plugins";

const FIXTURE_ROOT = fileURLToPath(new NodeURL("fixtures/client-bundle-app/", import.meta.url));
const BUILD_TIMEOUT = 120_000;
const SERVER_MARKER = "SERVER_ONLY_SECRET_MARKER";

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
    "carries neither the onigiri render nor additionalImports targets",
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
      expect(moduleIds.some((id) => parseOnigiriId(id))).toBe(false);
      expect(code).not.toContain("__onigiriRender");

      // The gate must not reach the manifest: the island still gets its chunk.
      const islandChunk = chunks.find((chunk) =>
        chunk.moduleIds.some((id) => id.replaceAll("\\", "/").endsWith("/Island.vue")),
      );
      expect(islandChunk, "no chunk emitted for the v-load-client target").toBeDefined();
      expect(islandChunk).not.toBe(chunks.find((chunk) => chunk.isEntry));
    },
    BUILD_TIMEOUT,
  );

  it(
    "is the only side dropping them: the SSR bundle keeps both",
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
      const moduleIds = moduleIdsOf(chunks);
      const code = chunks.map((chunk) => chunk.code).join("\n");

      expect(moduleIds.some((id) => id.endsWith("/SecretServer.vue"))).toBe(true);
      expect(code).toContain(SERVER_MARKER);
      expect(moduleIds.some((id) => parseOnigiriId(id))).toBe(true);
    },
    BUILD_TIMEOUT,
  );
});
