import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import { fileURLToPath } from "node:url";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

/** Two static pages tachometer serves from `bench/client`; relative base keeps assets resolvable. */
export default defineConfig({
  root: here("./"),
  base: "./",
  plugins: [vue()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    // The 10k-row payload JSON alone is about 2 MB.
    chunkSizeWarningLimit: 4000,
    target: "esnext",
    rollupOptions: {
      input: { vue: here("./vue.html"), onigiri: here("./onigiri.html") },
    },
  },
  define: { __DEV__: "false" },
  logLevel: "warn",
});
