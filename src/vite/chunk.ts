import { type Plugin, createFilter } from 'vite'
import MagicString from 'magic-string'
import { normalize, relative } from 'node:path'
import type { ExportDefaultDeclaration, ExportNamedDeclaration, Declaration, Identifier } from 'estree'
import type { ProgramNode, RollupAstNode } from 'rollup'

function normalizePath(path: string): string {
  return normalize(path).replaceAll('\\', '/')
}

/**
 * Explicit registry entry: pin a specific path and (optionally) restrict
 * which named exports are loadable from it. Use this when you want to
 * whitelist components rather than match by pattern, or when an SFC has
 * multiple named exports and only some should be reachable via
 * `v-load-client` / `importFn`.
 */
export interface OnigiriRegistryEntry {
  /**
   * Root-relative path to the `.vue` file (e.g. `/components/Foo.vue`).
   * Globs work too — interpreted via Vite's filter.
   */
  path: string
  /**
   * Whitelist of export names to register. Default: all exports the file
   * declares. Use `['default']` to expose only the default export.
   */
  exports?: string[]
}

export type OnigiriChunkInclude
  = | string
    | RegExp
    | OnigiriRegistryEntry
    | (string | RegExp | OnigiriRegistryEntry)[]

export interface OnigiriChunkPluginOptions {
  /**
   * Selector(s) for `.vue` files that should be tagged with
   * `__chunk`/`__export` and self-register into `__ONIGIRI_REGISTRY__`.
   * Default: every `.vue` file.
   *
   * Accepts:
   *  - a glob string or RegExp (Vite filter syntax)
   *  - an explicit `{ path, exports? }` entry to whitelist a specific
   *    file and optionally restrict its loadable exports
   *  - an array mixing any of the above
   *
   * Narrow this to limit which components participate in `v-load-client`
   * resolution — useful both for security (don't expose paths that
   * aren't loadable anyway) and to keep the registry small.
   */
  include?: OnigiriChunkInclude
  /** Filter exclusions, matched after `include`. */
  exclude?: string | RegExp | (string | RegExp)[]
}

function splitInclude(
  include: OnigiriChunkInclude | undefined,
): { filters: (string | RegExp)[], allowedExports: Map<string, Set<string>> } {
  const filters: (string | RegExp)[] = []
  const allowedExports = new Map<string, Set<string>>()
  const items = Array.isArray(include) ? include : (include == null ? [] : [include])
  for (const item of items) {
    if (typeof item === 'string' || item instanceof RegExp) {
      filters.push(item)
    }
    else {
      filters.push(item.path)
      if (item.exports) {
        const key = normalizePath(item.path).replace(/^\/+/, '/')
        allowedExports.set(key, new Set(item.exports))
      }
    }
  }
  return { filters, allowedExports }
}

/**
 * Tag every matching Vue SFC export with `__chunk` (the root-relative
 * source path) and `__export` ("default") so the serializer can emit
 * hydration markers pointing at the right module. Each module also
 * self-registers into `globalThis.__ONIGIRI_REGISTRY__` so the manifest
 * can resolve it synchronously without a Vite-only `import.meta.glob`
 * runtime call.
 */
export function onigiriChunkPlugin(options: OnigiriChunkPluginOptions = {}): Plugin {
  let root = ''
  const { filters, allowedExports } = splitInclude(options.include)
  const filter = createFilter(filters.length > 0 ? filters : undefined, options.exclude)

  return {
    name: 'vite:vue-onigiri-chunk',

    configResolved(config) {
      root = config.root
    },

    transform: {
      order: 'post',
      handler(code, id) {
        if (!id.endsWith('.vue') || id.includes('?')) return
        if (id.includes('virtual:onigiri')) return
        if (!filter(id)) return
        // Skip raw SFC source — happens in bundlers without plugin-vue
        // (e.g. Nitro's prerender rollup); chunk markers only matter
        // where Vue actually emits a JS module from `.vue`.
        if (/^\s*<(template|script|style)/i.test(code)) return

        const s = new MagicString(code)
        const ast = this.parse(code) as RollupAstNode<ProgramNode>
        const relativePath = normalizePath(relative(root, id))
        const chunkPath = JSON.stringify('/' + relativePath)
        const exportAllowlist = allowedExports.get('/' + relativePath)
        const isExportAllowed = (name: string) => !exportAllowlist || exportAllowlist.has(name)

        const registerSnippet = (varName: string) =>
          `\n;(globalThis.__ONIGIRI_REGISTRY__ ?? (globalThis.__ONIGIRI_REGISTRY__ = {}))[${chunkPath}] = ${varName};`

        // Wrap default export in an IIFE so we can decorate + register
        // regardless of the original declaration's identifier
        // (`_sfc_main`, `_sfc_component`, an inline object, …).
        const defaultExport = ast.body.find(
          (node): node is ExportDefaultDeclaration =>
            node.type === 'ExportDefaultDeclaration',
        )
        if (defaultExport?.declaration && isExportAllowed('default')) {
          const { start, end } = defaultExport.declaration as unknown as RollupAstNode<Declaration>
          const originalCode = code.slice(start, end)
          s.overwrite(
            start,
            end,
            `((__onigiri_c) => {
  Object.assign(__onigiri_c, { __chunk: ${chunkPath}, __export: "default" });
  (globalThis.__ONIGIRI_REGISTRY__ ?? (globalThis.__ONIGIRI_REGISTRY__ = {}))[${chunkPath}] = __onigiri_c;
  return __onigiri_c;
})(${originalCode})`,
          )
        }

        for (const node of ast.body) {
          if (node.type === 'ExportNamedDeclaration') {
            const namedExport = node as RollupAstNode<ExportNamedDeclaration>
            for (const specifier of namedExport.specifiers) {
              if (specifier.type === 'ExportSpecifier' && specifier.exported.type === 'Identifier') {
                const exportedName = specifier.exported.name
                if (!isExportAllowed(exportedName)) continue
                const localName = (specifier.local as Identifier).name
                const exportEnd = namedExport.end
                s.appendRight(
                  exportEnd,
                  `\nObject.assign(${localName}, { __chunk: ${chunkPath}, __export: ${JSON.stringify(exportedName)} });`
                  + registerSnippet(localName),
                )
              }
            }
          }
        }

        if (s.hasChanged()) {
          return {
            code: s.toString(),
            map: s.generateMap({ hires: true }),
          }
        }
      },
    },
  }
}

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
   * Defaults to `false` (registry-only) — exposing `import.meta.glob`
   * on the client leaks every matching file path into the bundle and
   * lets any browser caller lazy-load arbitrary components. The runtime
   * registry (populated by `onigiriChunkPlugin` as modules load) covers
   * statically-imported components, which is the common case. Only set
   * this if you have client components that aren't reachable through
   * the static import graph; scope it as narrowly as possible.
   */
  clientInclude?: string | false
}

export interface OnigiriManifestPluginOptions extends OnigiriManifestOptions {
  /**
   * Force registry-only mode in **all** environments. Required for
   * bundlers that can't preprocess `import.meta.glob` or compile `.vue`
   * imports (Nitro's pure-Node rollup, including its prerender pass).
   */
  stub?: boolean
}

/**
 * Emit a virtual module `virtual:onigiri/manifest` exporting `manifest`
 * and `importFn`. `importFn(src)` resolves first from
 * `globalThis.__ONIGIRI_REGISTRY__` (populated by `onigiriChunkPlugin`
 * as each SFC module loads), then falls back to a Vite `import.meta.glob`
 * loader if one is enabled for the current environment.
 *
 * Defaults: server uses a `/**\/*.vue` glob; client uses the registry only.
 * The asymmetric default avoids leaking file paths to the browser.
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
      const globFallback = useGlob
        ? `\nconst __glob = import.meta.glob(${JSON.stringify(include)})\n`
        : ''
      const globLookup = useGlob ? '__glob[key]' : 'undefined'
      return `
${globFallback}
function __onigiri_getRegistry() {
  return (typeof globalThis !== 'undefined' && globalThis.__ONIGIRI_REGISTRY__) || {}
}

export const manifest = ${useGlob ? '__glob' : '__onigiri_getRegistry()'}

export async function importFn(src, exportName = 'default') {
  const key = src.startsWith('/') ? src : '/' + src
  const registry = __onigiri_getRegistry()
  const registered = registry[key]
  if (registered) {
    return registered[exportName] ?? registered.default ?? registered
  }
  const loader = ${globLookup}
  if (!loader) {
    throw new Error(
      '[vue-onigiri] No component registered for chunk "' + src + '". ' +
      'Known registry: ' + Object.keys(registry).join(', ')
    )
  }
  const mod = await loader()
  return mod[exportName] ?? mod.default ?? mod
}
`
    },
  }
}

export interface OnigiriPluginsOptions extends OnigiriManifestOptions {
  /**
   * Selector for which `.vue` files participate in the registry / get
   * tagged with `__chunk` and `__export`. Accepts a glob string, RegExp,
   * `{ path, exports? }` entry, or array of any. See
   * `OnigiriChunkPluginOptions.include`.
   */
  registryInclude?: OnigiriChunkInclude
  /** Filter exclusions for the registry, matched after `registryInclude`. */
  registryExclude?: OnigiriChunkPluginOptions['exclude']
}

/**
 * Convenience factory bundling the chunk-marker and manifest plugins.
 * Spread into your Vite config: `plugins: [...onigiriPlugins()]`.
 */
export function onigiriPlugins(options: OnigiriPluginsOptions = {}): Plugin[] {
  const { registryInclude, registryExclude, ...manifestOptions } = options
  return [
    onigiriChunkPlugin({ include: registryInclude, exclude: registryExclude }),
    onigiriManifestPlugin(manifestOptions),
  ]
}

export { onigiriChunkPlugin as onigiriClientPlugin }
export { onigiriChunkPlugin as onigiriServerPlugin }
export { onigiriChunkPlugin as vueOnigiriClient }
export { onigiriChunkPlugin as vueOnigiriServer }
export { onigiriPlugins as vueOnigiriPluginFactory }
export { onigiriPlugins as createOnigiriPlugins }
