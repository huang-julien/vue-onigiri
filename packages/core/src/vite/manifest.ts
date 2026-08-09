import type { Plugin } from "vite";
import { getOnigiriTargets, setOnigiriManifestInvalidator } from "./shared";

const MANIFEST_VIRTUAL_ID = "virtual:onigiri/manifest";
const MANIFEST_RESOLVED_ID = "\0" + MANIFEST_VIRTUAL_ID;

export type OnigiriManifestInclude = "auto" | string | string[] | false;

export interface OnigiriManifestOptions {
  /**
   * What the server `__glob` covers: `"auto"` (default) globs only the
   * v-load-client targets seen during transform, explicit pattern(s)
   * override the auto list, `false` emits no glob at all.
   */
  serverInclude?: OnigiriManifestInclude;
  /**
   * Client `__glob`, same shape as `serverInclude`; defaults to `false`
   * so no source-path loader map ships to the browser. `"auto"` works
   * because the compiler plugin's buildStart scan registers every
   * v-load-client target before either environment builds; without a
   * client glob, a source-path descriptor reaching the browser must be
   * resolved by a custom `importFn` or it fails at render time.
   */
  clientInclude?: OnigiriManifestInclude;
}

export interface OnigiriManifestPluginOptions extends OnigiriManifestOptions {
  /**
   * Force a no-glob manifest in **all** environments. Required for
   * bundlers that can't preprocess `import.meta.glob` or compile `.vue`
   * imports (Nitro's pure-Node rollup, including its prerender pass).
   */
  stub?: boolean;
}

/**
 * Emit the `virtual:onigiri/manifest` module exporting `manifest` and
 * `importFn`, which resolves a chunk reference via its glob entry, then
 * native `import()` for absolute URLs, then a diagnostic throw.
 */
export function onigiriManifestPlugin(options: OnigiriManifestPluginOptions = {}): Plugin {
  const stub = options.stub ?? false;
  const serverInclude: OnigiriManifestInclude = stub ? false : (options.serverInclude ?? "auto");
  const clientInclude: OnigiriManifestInclude = stub ? false : (options.clientInclude ?? false);

  const resolveInclude = (include: OnigiriManifestInclude): string[] | false => {
    if (include === false) return false;
    if (include === "auto") {
      const targets = getOnigiriTargets();
      return targets.length > 0 ? [...targets] : false;
    }
    return Array.isArray(include) ? include : [include];
  };

  return {
    name: "vite:vue-onigiri-manifest",
    // Claim the id before default resolvers externalize the `virtual:`
    // protocol; a missed resolution crashes Nitro's rollup.
    resolveId: {
      order: "pre",
      handler(id, importer) {
        if (id === MANIFEST_VIRTUAL_ID) return MANIFEST_RESOLVED_ID;

        if (
          id === "vue-onigiri/runtime/manifest-default"
          || (/(^|[\\/])manifest-default(\.\w+)?$/.test(id)
            && !!importer
            && /[\\/]runtime[\\/]loader\.\w+$/.test(importer))
        ) {
          return MANIFEST_RESOLVED_ID;
        }
      },
    },
    configureServer(server) {
      // Dev: a new v-load-client target invalidates the manifest module
      // so the next request re-loads it with the fresh set.
      setOnigiriManifestInvalidator(() => {
        const mod
          = server.environments.ssr?.moduleGraph.getModuleById(MANIFEST_RESOLVED_ID)
            ?? server.environments.client?.moduleGraph.getModuleById(MANIFEST_RESOLVED_ID);
        if (mod) {
          server.environments.ssr?.moduleGraph.invalidateModule(mod);
          server.environments.client?.moduleGraph.invalidateModule(mod);
        }
      });
    },
    load(id, opts) {
      if (id !== MANIFEST_RESOLVED_ID) return;
      // Treat undefined `ssr` as server: tests / non-Vite consumers don't
      // set the flag, and a client bundle always sets it explicitly to false.
      const isClient = opts?.ssr === false;
      const include = resolveInclude(isClient ? clientInclude : serverInclude);
      const useGlob = include !== false && include.length > 0;
      return `
${useGlob ? `const __glob = import.meta.glob(${JSON.stringify(include)})\n` : ""}
export const manifest = ${useGlob ? "__glob" : "{}"}

export async function importFn(src, exportName = 'default') {
  const key = src.startsWith('/') ? src : '/' + src
  const loader = ${useGlob ? "__glob[key]" : "undefined"}
  if (loader) {
    const mod = await loader()
    return mod[exportName] ?? mod.default ?? mod
  }
  // Absolute URLs baked via \`resolveChunkUrl\` (e.g. \`/_nuxt/Counter.abc123.js\`) load through native import().
  // Protocol-relative URLs ('//host/x') are rejected so a tampered payload cannot load cross-origin scripts.
  if (src.startsWith('/') && !src.startsWith('//')) {
    try {
      const mod = await import(/* @vite-ignore */ src)
      return mod[exportName] ?? mod.default ?? mod
    } catch (cause) {
      throw new Error(
        '[vue-onigiri] Failed to load chunk "' + src + '": ' + (cause?.message ?? cause) + '. ' +
        'This descriptor is a source path unless the host baked a URL via \`resolveChunkUrl\`; ' +
        'it must be resolvable at runtime. '
      )
    }
  }
  throw new Error(
    '[vue-onigiri] No loader registered for chunk "' + src + '". ' +
    'Pass a custom \`importFn\` to \`renderOnigiri(ast, { importFn })\`, ' +
    'or set an \`include\` on \`onigiriManifestPlugin\`, ' +
    'or have the host bake a fetchable URL via \`resolveChunkUrl\`.'
  )
}
`;
    },
  };
}

/**
 * Convenience: returns just the manifest plugin in an array, so existing
 * callers using `[...onigiriPlugins()]` keep working.
 */
export function onigiriPlugins(options: OnigiriManifestPluginOptions = {}): Plugin[] {
  return [onigiriManifestPlugin(options)];
}
