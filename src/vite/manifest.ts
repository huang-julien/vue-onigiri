import type { Plugin } from 'vite'

const MANIFEST_VIRTUAL_ID = 'virtual:onigiri/manifest'
const MANIFEST_RESOLVED_ID = '\0' + MANIFEST_VIRTUAL_ID

export interface OnigiriManifestOptions {
  /**
   * Glob (relative to root) for the **server** lazy-load fallback.
   * Defaults to `/**\/*.vue`. Set to `false` to disable.
   */
  serverInclude?: string | false
  /**
   * Glob (relative to root) for the **client** lazy-load fallback.
   * Defaults to `false` — exposing `import.meta.glob` to the browser
   * leaks every matching file path into the bundle and lets any caller
   * lazy-load arbitrary components. Without it, the runtime relies on
   * `provideOnigiriImportFn` (preferred) so the host app explicitly
   * controls how chunk paths map to modules.
   *
   * Only set this if you have client islands that aren't reachable
   * through your app's static import graph; scope it as narrowly as
   * possible.
   */
  clientInclude?: string | false
}

export interface OnigiriManifestPluginOptions extends OnigiriManifestOptions {
  /**
   * Force a no-glob manifest in **all** environments. Required for
   * bundlers that can't preprocess `import.meta.glob` or compile `.vue`
   * imports (Nitro's pure-Node rollup, including its prerender pass).
   */
  stub?: boolean
}

/**
 * Emit a virtual module `virtual:onigiri/manifest` exporting `manifest`
 * and `importFn`. `importFn(src)` resolves a root-relative `.vue` path
 * via Vite's `import.meta.glob` for the current environment.
 *
 * Defaults: server uses a `/**\/*.vue` glob; client requires the user
 * to wire `provideOnigiriImportFn` (so we don't leak file paths to the
 * browser by default).
 */
export function onigiriManifestPlugin(options: OnigiriManifestPluginOptions = {}): Plugin {
  const stub = options.stub ?? false
  const serverInclude = stub ? false : (options.serverInclude ?? '/**/*.vue')
  const clientInclude = stub ? false : (options.clientInclude ?? false)
  return {
    name: 'vite:vue-onigiri-manifest',
    // `order: 'pre'` so we claim this id before any default resolver
    // externalizes the unknown `virtual:` protocol — critical for
    // Nitro's rollup (where vue-onigiri is inlined and a missed
    // resolution crashes Node with `protocol 'virtual:'`).
    resolveId: {
      order: 'pre',
      handler(id) {
        if (id === MANIFEST_VIRTUAL_ID) return MANIFEST_RESOLVED_ID
      },
    },
    load(id, opts) {
      if (id !== MANIFEST_RESOLVED_ID) return
      // Treat undefined `ssr` as server: tests / non-Vite consumers don't
      // set the flag, and a client bundle always sets it explicitly to false.
      const isClient = opts?.ssr === false
      const include = isClient ? clientInclude : serverInclude
      const useGlob = include !== false
      return `
${useGlob ? `const __glob = import.meta.glob(${JSON.stringify(include)})\n` : ''}
export const manifest = ${useGlob ? '__glob' : '{}'}

export async function importFn(src, exportName = 'default') {
  const key = src.startsWith('/') ? src : '/' + src
  const loader = ${useGlob ? '__glob[key]' : 'undefined'}
  if (!loader) {
    throw new Error(
      '[vue-onigiri] No loader registered for chunk "' + src + '". ' +
      'Wire \`provideOnigiriImportFn\` on your app, or pass a \`clientInclude\` glob to onigiriManifestPlugin.'
    )
  }
  const mod = await loader()
  return mod[exportName] ?? mod.default ?? mod
}
`
    },
  }
}

/**
 * Convenience: returns just the manifest plugin in an array, so existing
 * callers using `[...onigiriPlugins()]` keep working.
 */
export function onigiriPlugins(options: OnigiriManifestPluginOptions = {}): Plugin[] {
  return [onigiriManifestPlugin(options)]
}
