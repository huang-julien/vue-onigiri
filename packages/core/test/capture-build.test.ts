// Real SSR `vite build`: a toy `enforce: 'pre'` plugin rewrites the SFC, and
// the bundled virtual onigiri module must carry that rewrite, not the disk source.
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build, type Plugin, type Rollup } from "vite";
import vue from "@vitejs/plugin-vue";
import { onigiriCompilerPlugin } from "../src/vite/compiler";
import { onigiriSourceCapturePlugin } from "../src/vite/compiler/source-capture";

const FIXTURE_ROOT = fileURLToPath(new NodeURL("fixtures/capture-app/", import.meta.url));
const BUILD_TIMEOUT = 120_000;

const srcUrl = (rel: string) => fileURLToPath(new NodeURL(`../src/${rel}`, import.meta.url));

/** Compiled onigiri code imports the published runtime ids; point them at source. */
const RUNTIME_ALIASES = Object.fromEntries(
  ["shared", "utils", "with-directive", "render-slot", "resolve-component"].map((mod) => [
    `vue-onigiri/runtime/${mod}`,
    srcUrl(`runtime/${mod}.ts`),
  ]),
);

/** Host pre-transform: clamp the v-for source and inject the helper import. */
const toyClampPlugin = (): Plugin => ({
  name: "toy-vfor-clamp",
  enforce: "pre",
  transform(code, id) {
    if (!id.endsWith("Comp.vue")) return;
    return code
      .replace("n in count", "n in bound(count)")
      .replace("<script setup>", '<script setup>\nimport { bound } from "./bound";');
  },
});

describe("source capture in a real Vite build", () => {
  it(
    "compiles the onigiri render from the pre-transformed source, not disk",
    async () => {
      const output = (await build({
        root: FIXTURE_ROOT,
        configFile: false,
        logLevel: "silent",
        plugins: [toyClampPlugin(), onigiriSourceCapturePlugin(), onigiriCompilerPlugin(), vue()],
        resolve: { alias: RUNTIME_ALIASES },
        build: { ssr: "Comp.vue", write: false, minify: false },
      })) as Rollup.RollupOutput;

      const chunk = output.output.find((o): o is Rollup.OutputChunk => o.type === "chunk")!;
      const virtualId = Object.keys(chunk.modules).find((id) => id.includes("virtual:onigiri"));
      expect(virtualId, "virtual onigiri module missing from the bundle").toBeDefined();

      // Bundling may suffix-rename the identifier, hence the pattern.
      expect(chunk.modules[virtualId!]!.code).toMatch(/bound(\$\d+)?\(/);
      // Sanity: Vue's own render saw the same rewrite, so the two agree.
      expect(chunk.code).toMatch(/ssrRenderList\(.*bound/);
    },
    BUILD_TIMEOUT,
  );
});
