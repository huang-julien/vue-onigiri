import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";
import { onigiriCompilerPlugin } from "./src/vite/compiler";

const srcUrl = (rel: string) => fileURLToPath(new URL(`src/${rel}`, import.meta.url));

export default defineConfig({
  plugins: [onigiriCompilerPlugin({ serializeInClient: true }), vue()],
  resolve: {
    alias: {
      "vue-onigiri/runtime/serialize": srcUrl("runtime/serialize.ts"),
      "vue-onigiri/runtime/deserialize": srcUrl("runtime/deserialize.ts"),
      "vue-onigiri/runtime/shared": srcUrl("runtime/shared.ts"),
      "vue-onigiri/runtime/utils": srcUrl("runtime/utils.ts"),
      "vue-onigiri/runtime/with-directive": srcUrl("runtime/with-directive.ts"),
      "vue-onigiri/runtime/render-slot": srcUrl("runtime/render-slot.ts"),
      "vue-onigiri/runtime/resolve-component": srcUrl("runtime/resolve-component.ts"),
      "vue-onigiri/runtime/loader": srcUrl("runtime/loader.ts"),
      "vue-onigiri/runtime/manifest-runtime": srcUrl("runtime/manifest-runtime.ts"),
      "vue-onigiri/runtime/plugin": srcUrl("runtime/plugin.ts"),
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
