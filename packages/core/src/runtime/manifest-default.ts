import type { ImportFn } from "./utils";

export const manifest: Record<string, () => Promise<unknown>> = {};

export const importFn: ImportFn = async (src) => {
  throw new Error(
    `[vue-onigiri] No chunk loader available for "${src}". Provide one via ` +
      `renderOnigiri(ast, { importFn }), app.use(onigiriPlugin, { importFn }), ` +
      `the Vite onigiriManifestPlugin, or alias "vue-onigiri/runtime/manifest-default" ` +
      `to a module exporting an importFn.`,
  );
};
