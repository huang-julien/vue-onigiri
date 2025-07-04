import { defineConfig } from "vitest/config";
import { vueOnigiriPluginFactory } from "./src/vite/chunk";
import type { Plugin } from "vite";

const { client, server } = vueOnigiriPluginFactory();
const clientPLugin = client();
export default defineConfig({
  plugins: [clientPLugin[1], clientPLugin[2], ...server()],
  test: {
    environment: "node",
    globals: true,
    include: ["./test/**/*.test.ts"],
    pool: "vmForks",
    setupFiles: ["./test/vitest.setup.ts"],
  },
  define: {
    "import.meta.hot.on": "globalThis.mockedFn",
    "import.meta.hot.accept": "globalThis.mockedFn",
  },
  mode: "production",
});
