import type { Plugin } from 'vite'
import MagicString from 'magic-string'
import { normalize, relative } from 'node:path'
import type { ExportDefaultDeclaration, ExportNamedDeclaration, Declaration, Identifier } from 'estree'
import type { ProgramNode, RollupAstNode } from 'rollup'

function normalizePath(path: string): string {
  return normalize(path).replaceAll('\\', '/')
}

/**
 * Attach `__chunk` and `__export` to Vue SFC exports.
 *
 * `__chunk` is always the source path (rooted at `/`, relative to the
 * project root). The `virtual:onigiri/manifest` module resolves these
 * paths to the actual module via `import.meta.glob` — Vite handles
 * chunking, hashing, and dev/prod differences transparently.
 *
 * This plugin applies in both client and SSR environments: in either, the
 * `__chunk` value is the same source path, and the virtual manifest picks
 * up the right build (client chunk / server bundle) at runtime.
 */
export function onigiriChunkPlugin(): Plugin {
  let root = ''

  return {
    name: 'vite:vue-onigiri-chunk',

    configResolved(config) {
      root = config.root
    },

    transform: {
      order: 'post',
      handler(code, id) {
        if (!id.endsWith('.vue') || id.includes('?')) {
          return
        }
        if (id.includes('virtual:onigiri')) {
          return
        }

        const s = new MagicString(code)
        const ast = this.parse(code) as RollupAstNode<ProgramNode>
        const relativePath = normalizePath(relative(root, id))
        const chunkPath = JSON.stringify('/' + relativePath)

        // Default export
        const defaultExport = ast.body.find(
          (node): node is ExportDefaultDeclaration =>
            node.type === 'ExportDefaultDeclaration',
        )
        if (defaultExport?.declaration) {
          const { start, end } = defaultExport.declaration as unknown as RollupAstNode<Declaration>
          const originalCode = code.slice(start, end)
          s.overwrite(
            start,
            end,
            `Object.assign(${originalCode}, { __chunk: ${chunkPath}, __export: "default" })`,
          )
        }

        // Named exports
        for (const node of ast.body) {
          if (node.type === 'ExportNamedDeclaration') {
            const namedExport = node as RollupAstNode<ExportNamedDeclaration>
            for (const specifier of namedExport.specifiers) {
              if (specifier.type === 'ExportSpecifier' && specifier.exported.type === 'Identifier') {
                const localName = (specifier.local as Identifier).name
                const exportEnd = (namedExport as unknown as RollupAstNode<ExportNamedDeclaration>).end
                s.appendRight(
                  exportEnd,
                  `\nObject.assign(${localName}, { __chunk: ${chunkPath}, __export: "default" });`,
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
   * Glob pattern (relative to project root) matching files that can be
   * loaded as client components. Defaults to all .vue files.
   */
  include?: string
}

/**
 * Emits a virtual module `virtual:onigiri/manifest` that exports an
 * `ImportFn`-compatible function resolving chunk keys to component
 * modules via `import.meta.glob`.
 *
 * The runtime loader imports from this module directly — users don't pass
 * an `importFn` anywhere. The plugin registers in every environment so
 * both client and SSR builds see the same virtual module.
 */
export function onigiriManifestPlugin(options: OnigiriManifestOptions = {}): Plugin {
  const include = options.include ?? '/**/*.vue'
  return {
    name: 'vite:vue-onigiri-manifest',
    resolveId(id) {
      if (id === MANIFEST_VIRTUAL_ID) {
        return MANIFEST_RESOLVED_ID
      }
    },
    load(id) {
      if (id !== MANIFEST_RESOLVED_ID) return
      return `
const modules = import.meta.glob(${JSON.stringify(include)})

export const manifest = modules

export async function importFn(src, exportName = 'default') {
  const key = src.startsWith('/') ? src : '/' + src
  const loader = modules[key]
  if (!loader) {
    throw new Error(
      '[vue-onigiri] No component registered for chunk "' + src + '". ' +
      'Known chunks: ' + Object.keys(modules).join(', ')
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
 * Convenience factory bundling the chunk-marker and manifest plugins.
 * Spread into your Vite config: `plugins: [...onigiriPlugins()]`.
 */
export function onigiriPlugins(manifestOptions: OnigiriManifestOptions = {}): Plugin[] {
  return [onigiriChunkPlugin(), onigiriManifestPlugin(manifestOptions)]
}

// Back-compat aliases — these are now equivalent. Both client and server
// builds use the same chunk plugin (source-path based), so the split is
// purely cosmetic. Kept so existing configs don't break.
export { onigiriChunkPlugin as onigiriClientPlugin }
export { onigiriChunkPlugin as onigiriServerPlugin }
export { onigiriChunkPlugin as vueOnigiriClient }
export { onigiriChunkPlugin as vueOnigiriServer }
export { onigiriPlugins as vueOnigiriPluginFactory }
export { onigiriPlugins as createOnigiriPlugins }
