import { defineProject } from "vitest/config";
import type { Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { attachDescriptor } from "./src/vite/compiler/attach-descriptor";
import { toRootRelative } from "./src/vite/compiler/paths";
import { onigiriPlugins } from "./src/vite/plugins";

const ROOT = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE_COMPONENTS = "/test/fixtures/components/";

const srcUrl = (rel: string) => fileURLToPath(new URL(`src/${rel}`, import.meta.url));

export default defineProject({
  plugins: [
    ...onigiriPlugins({
      clientInclude: "/test/fixtures/components/**/*.vue",
      extraEntries: {
        // Real node_modules package: the bare specifier is only loadable
        // because the literal entry puts it through bundler resolution.
        "vue-onigiri-test-ui-lib/Button.vue": "vue-onigiri-test-ui-lib/Button.vue",
        // Aliased value: proves entry values resolve like source imports.
        "onigiri-test/aliased-counter": "~fixtures/components/Counter.vue",
      },
    }),
    vue(),
    fixtureDescriptorPlugin(),
  ],
  resolve: {
    alias: [
      { find: "~fixtures", replacement: fileURLToPath(new URL("test/fixtures", import.meta.url)) },
      // Compiled SFCs and the manifest module import the published ids; point them at source.
      // `vue-onigiri/manifest` stays unaliased: the manifest plugin resolves it.
      { find: /^vue-onigiri$/, replacement: srcUrl("index.ts") },
      { find: /^vue-onigiri\/server$/, replacement: srcUrl("server.ts") },
    ],
  },
  test: {
    environment: "node",
    globals: true,
    include: ["./test/**/*.test.ts"],
    pool: "vmForks",
    setupFiles: ["./test/vitest.setup.ts"],
  },
  mode: "production",
});

/**
 * Happy-dom suites transform in the client environment, where the compiler skips the
 * descriptor. They still server-render the fixture components, so attach it here.
 */
function fixtureDescriptorPlugin(): Plugin {
  return {
    name: "test:fixture-descriptor",
    enforce: "post",
    transform(code, id) {
      if (this.environment?.config.consumer !== "client") return;
      const chunk = toRootRelative(id, ROOT);
      if (!chunk.startsWith(FIXTURE_COMPONENTS) || !chunk.endsWith(".vue")) return;
      return attachDescriptor(code, chunk, false);
    },
  };
}
