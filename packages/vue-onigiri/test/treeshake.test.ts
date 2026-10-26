// Real `vite build`s of tiny entries importing the published ids: an entry
// imported for one environment must leave nothing of the other one behind,
// with the package's `sideEffects: false` honored or ignored (aliases, some bundlers).
import { fileURLToPath, URL as NodeURL } from "node:url";
import { describe, expect, it } from "vitest";
import { build, type Plugin, type Rollup } from "vite";

const BUILD_TIMEOUT = 60_000;

const srcUrl = (rel: string) => fileURLToPath(new NodeURL(`../src/${rel}`, import.meta.url));

const RUNTIME_ALIASES = [
  { find: /^vue-onigiri$/, replacement: srcUrl("index.ts") },
  { find: /^vue-onigiri\/server$/, replacement: srcUrl("server.ts") },
  { find: /^vue-onigiri\/manifest$/, replacement: srcUrl("manifest.ts") },
];

// Universal code, as in a Nuxt component: each branch is dropped in the other environment.
const UNIVERSAL_ENTRY = `
import { domToVNode, isMarkerNonce } from "vue-onigiri";
import { provideMarkerNonce } from "vue-onigiri/server";
if (import.meta.env.SSR) console.log(provideMarkerNonce({}), isMarkerNonce("a"));
else console.log(domToVNode(document.body, { nonce: "a" }), isMarkerNonce("a"));
`;

// `vue` and `vue/server-renderer` declare no `sideEffects`, so a bundler keeps their bare imports.
const BARE_IMPORT_RE = /^import "[^"]+";$/gm;

/**
 * Marks every source module as side-effectful, as a bundler ignoring `sideEffects: false` does.
 */
const ignoreSideEffectsFlag: Plugin = {
  name: "ignore-side-effects-flag",
  enforce: "post",
  transform: (code, id) =>
    id.replaceAll("\\", "/").includes("/src/")
      ? { code, map: null, moduleSideEffects: true }
      : undefined,
};

describe.each([
  ["honored", false],
  ["ignored", true],
])("tree-shaking with sideEffects %s", (_, ignoreFlag) => {
  const bundle = async (code: string, ssr: boolean): Promise<string> => {
    const output = (await build({
      configFile: false,
      logLevel: "silent",
      plugins: [
        {
          name: "entry",
          resolveId: (id) => (id === "entry" ? "\0entry" : undefined),
          load: (id) => (id === "\0entry" ? code : undefined),
        },
        ignoreFlag && ignoreSideEffectsFlag,
      ],
      resolve: { alias: RUNTIME_ALIASES },
      build: {
        write: false,
        minify: false,
        ssr,
        rollupOptions: { input: "entry", external: [/^vue(\/|$)/, /^@vue\//] },
      },
    })) as Rollup.RollupOutput;
    const chunks = output.output.filter((o): o is Rollup.OutputChunk => o.type === "chunk");
    const bundled = chunks.map((chunk) => chunk.code).join("\n");
    return ignoreFlag ? bundled.replace(BARE_IMPORT_RE, "") : bundled;
  };

  it.each([["vue-onigiri"], ["vue-onigiri/server"], ["vue-onigiri/manifest"]])(
    "a bare import of %s leaves no code",
    async (id) => {
      for (const ssr of [false, true]) {
        expect((await bundle(`import "${id}";`, ssr)).trim()).toBe("");
      }
    },
    BUILD_TIMEOUT,
  );

  it(
    "the client build of universal code carries no server code",
    async () => {
      const code = await bundle(UNIVERSAL_ENTRY, false);
      expect(code).toContain("createTreeWalker");
      expect(code).not.toContain("vue/server-renderer");
      expect(code).not.toContain("ssrUtils");
      expect(code).not.toContain("getRandomValues");
      expect(code).not.toContain("onigiriNonce");
      expect(code).not.toContain("OnigiriClientBoundary");
    },
    BUILD_TIMEOUT,
  );

  it(
    "the server build of universal code carries no client code",
    async () => {
      const code = await bundle(UNIVERSAL_ENTRY, true);
      expect(code).toContain("getRandomValues");
      expect(code).not.toContain("createTreeWalker");
      expect(code).not.toContain("component-loader");
      expect(code).not.toContain("JSON.parse");
      expect(code).not.toContain("is the stub");
    },
    BUILD_TIMEOUT,
  );
});
