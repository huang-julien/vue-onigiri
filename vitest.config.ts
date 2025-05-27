import { defineConfig } from "vitest/config";
import { vueServerComponentsPlugin } from "./src/vite/chunk";
import type { Plugin } from "vite"

const { client, server } = vueServerComponentsPlugin();
export default defineConfig({
  plugins: [(client() as [Plugin, Plugin])[1], server()],
  test: {
    environment: "node",
    globals: true,
    include: ["./test/**/*.test.ts"],
    pool:'vmForks',
    setupFiles: ["./test/vitest.setup.ts"],
  },
  define: {
    "import.meta.hot.on": "globalThis.mockedFn",
    "import.meta.hot.accept": "globalThis.mockedFn",
  },
});
