import type { ImportFn } from "./runtime/utils";

export { createImportFn } from "./runtime/manifest-runtime";
export type { ChunkTable } from "./runtime/manifest-runtime";

/**
 * Chunk table of the stub, empty: the Vite manifest plugin or a host alias replaces this module.
 */
export const manifest: Record<string, () => Promise<unknown>> = {};

/**
 * Loader default of the stub, throwing with setup guidance.
 */
export const importFn: ImportFn = async (src) => {
  throw new Error(
    `[vue-onigiri] No chunk loader available for "${src}": "vue-onigiri/manifest" is the stub. ` +
      `Add \`onigiriPlugins()\` (or \`onigiriManifestPlugin\`) from "vue-onigiri/vite" so it is ` +
      `replaced, alias "vue-onigiri/manifest" to your own module, or pass an \`importFn\` to ` +
      `domToVNode(el, { nonce, importFn }) or app.use(onigiriPlugin, { importFn }).`,
  );
};
