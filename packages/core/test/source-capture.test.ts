import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileScript, parse } from "@vue/compiler-sfc";
import type { Plugin, ResolvedConfig } from "vite";
import {
  findSourceCaptureApi,
  getCapturedSource,
  onigiriSourceCapturePlugin,
  runWithCapturedSources,
  type SourceCaptureApi,
} from "../src/vite/compiler/source-capture";
import { ONIGIRI_PREFIX, ONIGIRI_SUFFIX } from "../src/vite/compiler/constants";
import { injectIntoSetupAsync } from "../src/vite/compiler/inject-setup";
import { loadVirtualOnigiriModule } from "../src/vite/compiler/load-virtual";
import { onigiriCompilerPlugin } from "../src/vite/compiler";

const FAKE_PATH = "/x/Comp.vue";
const FAKE_CONFIG = { root: "/x", isProduction: false } as ResolvedConfig;

// A host `enforce: 'pre'` rewrite of the pristine SFC: v-for source wrapped
// in a clamp helper plus its injected import, like Nuxt's islands transform.
const REWRITTEN_SFC = `
<script setup>
import { bound } from "./bound";
defineProps({ count: { type: Number, default: 5 } });
</script>

<template>
  <ul>
    <li v-for="n in bound(count)" :key="n">{{ n }}</li>
  </ul>
</template>
`;

/** A capture plugin instance plus a helper driving its transform hook the way Vite would. */
function makeCapture() {
  const plugin = onigiriSourceCapturePlugin() as Plugin;
  const api = plugin.api as SourceCaptureApi;
  const transform = plugin.transform as (this: unknown, code: string, id: string) => void;
  const capture = (code: string, id: string, environment?: string) =>
    transform.call(environment ? { environment: { name: environment } } : {}, code, id);
  return { plugin, api, capture };
}

const lookupVia = (api: SourceCaptureApi, environment?: string) => (filePath: string) =>
  api.getCapturedSource(filePath, environment);

const loadVirtual = (filePath: string) =>
  loadVirtualOnigiriModule(
    ONIGIRI_PREFIX + encodeURIComponent(filePath) + ONIGIRI_SUFFIX,
    { config: FAKE_CONFIG, sourceMap: false },
    (msg) => {
      throw new Error(msg);
    },
  );

describe("source capture feeding the compiler", () => {
  it("compiles the virtual onigiri module from the captured source, not disk", async () => {
    // The file does not exist on disk: success itself proves the capture was used.
    const { api, capture } = makeCapture();
    capture(REWRITTEN_SFC, FAKE_PATH);

    const result = await runWithCapturedSources(lookupVia(api), () => loadVirtual(FAKE_PATH));
    expect(result?.code).toContain("__onigiriRender");
    expect(result?.code).toContain("bound(");
    expect(result?.code).toContain(`from "./bound"`);
  });

  it("wires capture into the compiler plugin through the resolved plugin list", async () => {
    const { plugin: capturePlugin, capture } = makeCapture();
    capture(REWRITTEN_SFC, FAKE_PATH, "ssr");

    const compiler = onigiriCompilerPlugin({ scan: false }) as Plugin;
    (compiler.configResolved as (c: ResolvedConfig) => void).call(compiler, {
      ...FAKE_CONFIG,
      plugins: [capturePlugin],
    } as ResolvedConfig);

    const load = compiler.load as (this: unknown, id: string) => Promise<{ code: string } | null>;
    const result = await load.call(
      {
        environment: { name: "ssr" },
        resolve: async (id: string) => ({ id }),
        error: (msg: string) => {
          throw new Error(msg);
        },
      },
      ONIGIRI_PREFIX + encodeURIComponent(FAKE_PATH) + ONIGIRI_SUFFIX,
    );

    expect(result?.code).toContain("bound(");
  });

  it("compiles the setup injection's bindings from the captured source", async () => {
    const { api, capture } = makeCapture();
    capture(REWRITTEN_SFC, FAKE_PATH);
    const { descriptor } = parse(REWRITTEN_SFC, { filename: FAKE_PATH });
    const compiled = compileScript(descriptor, { id: FAKE_PATH, inlineTemplate: true });

    const result = await runWithCapturedSources(lookupVia(api), () =>
      injectIntoSetupAsync(compiled.content, FAKE_PATH, { config: FAKE_CONFIG, sourceMap: false }),
    );

    expect(result).not.toBeNull();
    // The bridge getter only exists if the analysis read the rewritten source.
    expect(result?.code).toContain("get bound()");
  });

  it("falls back to disk outside a captured-sources scope", async () => {
    const root = fileURLToPath(new URL("..", import.meta.url));
    const fixturePath = path.resolve(root, "test/fixtures/components/LiteralConst.vue");

    expect(getCapturedSource(fixturePath)).toBeUndefined();
    const result = await loadVirtualOnigiriModule(
      ONIGIRI_PREFIX + encodeURIComponent(fixturePath) + ONIGIRI_SUFFIX,
      { config: { root, isProduction: false } as ResolvedConfig, sourceMap: false },
      (msg) => {
        throw new Error(msg);
      },
    );

    expect(result?.code).toContain("__onigiriRender");
  });

  it("only captures bare .vue requests", () => {
    const { api, capture } = makeCapture();
    capture("<template><div /></template>", "/x/Q.vue?vue&type=template");
    capture("export const notVue = true", "/x/foo.ts");

    expect(api.getCapturedSource("/x/Q.vue")).toBeUndefined();
    expect(api.getCapturedSource("/x/foo.ts")).toBeUndefined();
  });

  it("keys Windows and /@fs/ spellings of the same file identically", () => {
    const { api, capture } = makeCapture();
    capture(REWRITTEN_SFC, "D:/win/Comp.vue");
    expect(api.getCapturedSource("D:\\win\\Comp.vue")).toBe(REWRITTEN_SFC);

    capture(REWRITTEN_SFC, "/@fs/D:/fs/Comp.vue");
    expect(api.getCapturedSource("D:\\fs\\Comp.vue")).toBe(REWRITTEN_SFC);
  });

  it("keeps environments separate so a server-only rewrite cannot leak", () => {
    const { api, capture } = makeCapture();
    const ssrSource = REWRITTEN_SFC;
    const clientSource = REWRITTEN_SFC.replace("bound(count)", "count");
    capture(ssrSource, FAKE_PATH, "ssr");
    capture(clientSource, FAKE_PATH, "client");

    expect(api.getCapturedSource(FAKE_PATH, "ssr")).toBe(ssrSource);
    expect(api.getCapturedSource(FAKE_PATH, "client")).toBe(clientSource);
    // No capture for this environment and no plain entry: disk fallback.
    expect(api.getCapturedSource(FAKE_PATH, "other")).toBeUndefined();
  });

  it("falls back to the environment-less capture for hooks without environment info", () => {
    const { api, capture } = makeCapture();
    capture(REWRITTEN_SFC, FAKE_PATH);
    expect(api.getCapturedSource(FAKE_PATH, "ssr")).toBe(REWRITTEN_SFC);
  });

  it("isolates captures per plugin instance", () => {
    const first = makeCapture();
    const second = makeCapture();
    first.capture(REWRITTEN_SFC, FAKE_PATH);

    expect(first.api.getCapturedSource(FAKE_PATH)).toBe(REWRITTEN_SFC);
    expect(second.api.getCapturedSource(FAKE_PATH)).toBeUndefined();
    expect(findSourceCaptureApi([second.plugin as Plugin])).toBe(second.api);
  });
});
