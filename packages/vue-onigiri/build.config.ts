import { defineBuildConfig } from "unbuild";

export default defineBuildConfig({
  entries: ["src/index", "src/server", "src/vite", "src/manifest"],
  declaration: true,
  clean: true,
  externals: [
    "vue",
    "vue/server-renderer",
    "@vue/server-renderer",
    "vite",
    // Kept bare in dist so the manifest plugin's exact-id resolveId can swap it.
    "vue-onigiri/manifest",
  ],
});
