import type { Plugin } from "vite";
import { getOnigiriTargets, setOnigiriManifestInvalidator } from "./shared";

const MANIFEST_VIRTUAL_ID = "virtual:onigiri/manifest";
const MANIFEST_RESOLVED_ID = "\0" + MANIFEST_VIRTUAL_ID;

export type OnigiriManifestInclude = "auto" | string | string[] | false;

export interface OnigiriManifestOptions {
  /**
   * What the **server** `__glob` covers.
   *
   * - `"auto"` (default) — only the `v-load-client` targets the
   *   compiler observed during SSR transform. Minimal, no extra bundle
   *   weight, and no source paths beyond those actually needed.
   * - `string | string[]` — explicit glob pattern(s) passed to
   *   `import.meta.glob`. Use for setups where the auto-detected list
   *   misses something (e.g. components only reachable through a
   *   runtime registry).
   * - `false` — no `__glob`. Runtime importFn relies entirely on the
   *   absolute-URL fallback or a custom `importFn` passed via
   *   `renderOnigiri(ast, { importFn })`.
   */
  serverInclude?: OnigiriManifestInclude;
  /**
   * What the **client** `__glob` covers. Same shape as `serverInclude`.
   * Defaults to `false` because hosts that bake fetchable URLs into
   * the AST at compile time (via `resolveChunkUrl`) don't need a
   * client-side glob at all — the runtime importFn just does
   * `import(url)`. Set to `"auto"` if you want the legacy
   * source-path-keyed loader map shipped to the browser.
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
 * Emit a virtual module `virtual:onigiri/manifest` exporting `manifest`
 * and `importFn`. The emitted `importFn(src, exportName)` resolves a
 * chunk reference into a module in three steps:
 *
 *   1. If `src` matches an `import.meta.glob` entry (`__glob[key]`),
 *      call its loader. This covers the legacy source-path-keyed path,
 *      e.g. `'/components/Counter.vue'`.
 *
 *   2. Otherwise, if `src` starts with `/`, fall through to a native
 *      `import(/* @vite-ignore *\/ src)`. This is the recommended path
 *      for hosts that bake fetchable URLs into the AST at compile time
 *      via `resolveChunkUrl` — the URL can be any browser-fetchable
 *      form: a hashed chunk (`/_nuxt/Counter.abc123.js`), a dev-server
 *      sentinel (`/_nuxt/@id/<bare-spec>`), or any other absolute URL.
 *      No extension is required.
 *
 *   3. Otherwise (a bare specifier with no glob entry), throw with a
 *      pointer to the two escape hatches: a custom `importFn` passed to
 *      `renderOnigiri(ast, { importFn })`, or an explicit `include`
 *      pattern on `onigiriManifestPlugin`.
 *
 * Defaults: server auto-detects v-load-client targets; client emits no
 * glob (so we don't leak file paths to the browser by default — hosts
 * are expected to bake URLs via `resolveChunkUrl`).
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
    // `order: 'pre'` so we claim this id before any default resolver
    // externalizes the unknown `virtual:` protocol — critical for
    // Nitro's rollup (where vue-onigiri is inlined and a missed
    // resolution crashes Node with `protocol 'virtual:'`).
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
      // Dev: when the compiler sees a new v-load-client target, drop
      // the manifest from Vite's module graph so the next request
      // re-`load`s it with the fresh set.
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
    const mod = await import(/* @vite-ignore */ src)
    return mod[exportName] ?? mod.default ?? mod
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
