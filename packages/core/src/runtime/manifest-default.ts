import type { ImportFn } from "./utils";

/**
 * Default chunk loader, used only when no other `importFn` is available
 * (see the resolution chain in `loader.ts`).
 *
 * This module is the bundler swap point for chunk loading:
 * - `onigiriManifestPlugin` (Vite) redirects it to the generated
 *   `virtual:onigiri/manifest` module, keeping the zero-config Vite
 *   behavior (`import.meta.glob` map + absolute-URL `import()`).
 * - Any other bundler or meta-framework can alias
 *   `vue-onigiri/runtime/manifest-default` to a module exporting the
 *   same shape (`{ manifest, importFn }`).
 *
 * Without a redirect it throws with setup guidance, so the runtime has
 * no Vite-only imports and stays usable in any bundler (or none).
 */
export const manifest: Record<string, () => Promise<unknown>> = {};

export const importFn: ImportFn = async (src) => {
  throw new Error(
    `[vue-onigiri] No chunk loader available for "${src}". Provide one via ` +
      `renderOnigiri(ast, { importFn }), app.use(onigiriPlugin, { importFn }), ` +
      `the Vite onigiriManifestPlugin, or alias "vue-onigiri/runtime/manifest-default" ` +
      `to a module exporting an importFn.`,
  );
};
