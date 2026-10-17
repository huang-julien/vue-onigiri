import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { onigiriCompilerPlugin } from "./src/vite/compiler";
import codspeedPlugin from "@codspeed/vitest-plugin";
import { HTML_FIRST_RE, htmlFirstFixturePlugins } from "./bench/html-first-fixtures";

const srcUrl = (rel: string) => fileURLToPath(new URL(`src/${rel}`, import.meta.url));

export default defineConfig({
  plugins: [
    ...htmlFirstFixturePlugins(),
    onigiriCompilerPlugin({ serializeInClient: true }),
    vue({ exclude: HTML_FIRST_RE }),
    codspeedPlugin(),
  ],
  resolve: {
    alias: {
      "@vue-onigiri/core/runtime/serialize": srcUrl("runtime/serialize.ts"),
      "@vue-onigiri/core/runtime/deserialize": srcUrl("runtime/deserialize.ts"),
      "@vue-onigiri/core/runtime/shared": srcUrl("runtime/shared.ts"),
      "@vue-onigiri/core/runtime/ssr-boundary": srcUrl("runtime/ssr-boundary.ts"),
      "@vue-onigiri/core/runtime/utils": srcUrl("runtime/utils.ts"),
      "@vue-onigiri/core/runtime/with-directive": srcUrl("runtime/with-directive.ts"),
      "@vue-onigiri/core/runtime/render-slot": srcUrl("runtime/render-slot.ts"),
      "@vue-onigiri/core/runtime/resolve-component": srcUrl("runtime/resolve-component.ts"),
      "@vue-onigiri/core/runtime/loader": srcUrl("runtime/loader.ts"),
      "@vue-onigiri/core/runtime/manifest-runtime": srcUrl("runtime/manifest-runtime.ts"),
      "@vue-onigiri/core/runtime/plugin": srcUrl("runtime/plugin.ts"),
    },
  },
  test: {
    environment: "node",
    pool: "forks",
    env: {
      // Force production build for vue
      NODE_ENV: "production",
    },
    include: ["./bench/**/*.measure.ts"],
    benchmark: {
      include: ["./bench/**/*.bench.ts"],
    },
  },
  define: {
    __DEV__: "false",
  },
  mode: "production",
});
