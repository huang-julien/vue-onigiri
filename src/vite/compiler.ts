import type { Plugin, ResolvedConfig } from 'vite'
import { parse, compileScript, type BindingMetadata } from '@vue/compiler-sfc'
import { compileOnigiriInline } from '../template-compiler'
import MagicString from 'magic-string'
import { createHash } from 'node:crypto'
import path from 'node:path'

// Virtual module identifier shape. We model this on Nuxt's `virtual:nuxt:`
// convention:
// - Specifier emitted into compiled SFCs is
//     `virtual:onigiri:<URL-encoded-path>.mjs`
// - resolveId returns the same string unchanged (no `\0` prefix).
//
// Two reasons for this shape:
// 1. `\0` breaks Vite's `/@id/` URL round-trip for specifiers that also
//    contain colons / slashes (Windows absolute paths like `D:/…`). Using
//    a plain `virtual:` prefix lets Vite serve the module at
//    `/@id/virtual:onigiri:…` — the URL-encoded path stays intact.
// 2. `@vitejs/plugin-vue` tries to parse any specifier ending in `.vue`
//    as an SFC and blows up on our generated JS. The `.mjs` suffix keeps
//    it out of plugin-vue's filter.
const ONIGIRI_PREFIX = 'virtual:onigiri:'
const ONIGIRI_SUFFIX = '.mjs'

function getHash(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8)
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/')
}

function generateScopeId(filePath: string, source: string, root: string, isProduction: boolean): string {
  const relativePath = normalizePath(path.relative(root, filePath))
  const hashInput = isProduction ? relativePath + source : relativePath
  return `data-v-${getHash(hashInput)}`
}

/**
 * Parse the top-level `import` statements of a script block and build a
 * map of local identifier → root-relative source path (`/fixtures/X.vue`).
 *
 * Only relative imports are resolved (starts with `./` or `../`). Absolute
 * specifiers, aliases and package imports are skipped — those aren't local
 * components and won't have manifest entries.
 *
 * Recognized clauses:
 *   import Foo from './X.vue'             → Foo
 *   import { Foo } from './X.vue'         → Foo
 *   import { X as Foo } from './X.vue'    → Foo
 *   import Foo, { Bar } from './X.vue'    → Foo, Bar
 *   Skipped: `type` imports, namespace imports.
 */
function buildImportMap(
  scriptContent: string,
  currentFilePath: string,
  root: string,
): Map<string, string> {
  const map = new Map<string, string>()
  if (!scriptContent) return map

  // Matches `import <clause> from "<source>"`
  const importRegex = /import\s+(?!type\b)([^;]+?)\s+from\s+['"](\.\.?\/[^'"]+)['"]/g
  for (const match of scriptContent.matchAll(importRegex)) {
    const [, clauseRaw, source] = match
    if (!clauseRaw || !source) continue

    // Resolve relative to the file doing the importing, then make it
    // root-relative so it matches what the chunk plugin / manifest emit.
    const abs = path.resolve(path.dirname(currentFilePath), source)
    const rel = '/' + normalizePath(path.relative(root, abs))

    const clause = clauseRaw.trim()
    const identifiers = parseImportClause(clause)
    for (const id of identifiers) {
      map.set(id, rel)
    }
  }
  return map
}

function parseImportClause(clause: string): string[] {
  const results: string[] = []

  // Split default and named parts: "Default, { A, B as C }"
  const namedMatch = clause.match(/\{([^}]*)\}/)
  const defaultPart = namedMatch
    ? clause.slice(0, namedMatch.index).replace(/,\s*$/, '').trim()
    : clause.trim()

  if (defaultPart && !defaultPart.startsWith('*')) {
    // Skip `type` marker in default clause
    const clean = defaultPart.replace(/^type\s+/, '')
    if (clean && /^[a-zA-Z_$][\w$]*$/.test(clean)) {
      results.push(clean)
    }
  }

  if (namedMatch?.[1]) {
    for (const raw of namedMatch[1].split(',')) {
      const spec = raw.trim()
      if (!spec || spec.startsWith('type ')) continue
      // `X as Foo` → local is Foo; `X` → local is X
      const asMatch = spec.match(/^\S+\s+as\s+([a-zA-Z_$][\w$]*)$/)
      if (asMatch?.[1]) {
        results.push(asMatch[1])
      }
      else if (/^[a-zA-Z_$][\w$]*$/.test(spec)) {
        results.push(spec)
      }
    }
  }

  return results
}

/**
 * Options for the onigiri compiler plugin
 */
export interface OnigiriCompilerOptions {
  /**
   * Whether to include source maps
   * @default true
   */
  sourceMap?: boolean
}

/**
 * Vite plugin that provides onigiri serialization for Vue SFCs.
 *
 * Two modes of operation:
 *
 * 1. **virtual:onigiri/ import**: Returns just the onigiri render function
 *    ```ts
 *    import __onigiriRender from "virtual:onigiri/path/to/Component.vue"
 *    ```
 *
 * 2. **Transform hook**: Injects onigiri support into compiled SFCs
 *    - Build (inline template): Injects `if (inject(ONIGIRI_RENDER_SYMBOL))` into setup
 *    - Dev (no inline): Imports onigiri render and attaches as `__onigiriRender` property
 */
export function onigiriCompilerPlugin(
  options: OnigiriCompilerOptions = {},
): Plugin {
  const { sourceMap = true } = options
  let config: ResolvedConfig

  return {
    name: 'vite:vue-onigiri-compiler',
    // `enforce: 'post'` pushes the whole plugin into Vite's "post" bucket so
    // our `transform` runs AFTER `@vitejs/plugin-vue` and we see its compiled
    // output (split `type=script` / `type=template` modules, combined dev
    // `export default`). Plugin-level `enforce: 'post'` still runs BEFORE
    // Vite's core `vite:import-analysis` — using hook-level
    // `transform: { order: 'post' }` instead pushed us past import-analysis,
    // causing `virtual:onigiri:*` specifiers to reach the browser unrewritten.
    enforce: 'post',

    configResolved(resolvedConfig) {
      config = resolvedConfig
    },

    resolveId: {
      order: 'pre',
      async handler(id, importer) {
        // Anything matching `virtual:onigiri:<...>.mjs` is ours. The
        // specifier carries its own encoding — we simply claim the id so
        // Vite stops looking elsewhere. No `\0` prefix because that breaks
        // Vite's `/@id/` URL round-trip when the body contains colons
        // (Windows absolute paths like `D:/…`).
        if (id.startsWith(ONIGIRI_PREFIX) && id.endsWith(ONIGIRI_SUFFIX)) {
          return id
        }

        // If a specifier came in raw (no suffix) — shouldn't happen in the
        // normal flow since `attachAsProperty` emits the full form, but be
        // defensive — encode + suffix it.
        if (id.startsWith(ONIGIRI_PREFIX)) {
          const tail = id.slice(ONIGIRI_PREFIX.length)
          const encoded = /%[0-9A-Fa-f]{2}/.test(tail) ? tail : encodeURIComponent(tail)
          return ONIGIRI_PREFIX + encoded + ONIGIRI_SUFFIX
        }

        // Relative imports inside a virtual onigiri module resolve against
        // the original (decoded) file path on disk.
        if (importer?.startsWith(ONIGIRI_PREFIX) && importer.endsWith(ONIGIRI_SUFFIX)) {
          const encoded = importer.slice(ONIGIRI_PREFIX.length, -ONIGIRI_SUFFIX.length)
          const originalFilePath = decodeURIComponent(encoded)
          const resolved = await this.resolve(id, originalFilePath, { skipSelf: true })
          return resolved
        }

        return null
      },
    },

    /**
     * Load virtual:onigiri/ modules - exports only the render function
     */
    async load(id) {
      if (id.includes('devtools')) {
        return null
      }
      // Must match `virtual:onigiri:<encoded>.mjs`
      if (!id.startsWith(ONIGIRI_PREFIX) || !id.endsWith(ONIGIRI_SUFFIX)) {
        return null
      }

      // Extract + decode the wrapped source path.
      const encoded = id.slice(ONIGIRI_PREFIX.length, -ONIGIRI_SUFFIX.length)
      const filePath = decodeURIComponent(encoded)
      const fs = await import('node:fs/promises')
      const source = await fs.readFile(filePath, 'utf8')

      const { descriptor, errors } = parse(source, {
        filename: filePath,
        sourceMap,
      })

      if (errors.length > 0) {
        for (const error of errors) {
          this.error(error.message)
        }
        return null
      }

      if (!descriptor.template) {
        return `export default function __onigiriRender(_ctx, __instance) { return null; }`
      }

      let bindingMetadata: BindingMetadata = {}
      if (descriptor.scriptSetup || descriptor.script) {
        try {
          const scriptResult = compileScript(descriptor, {
            id: filePath,
            sourceMap,
          })
          bindingMetadata = scriptResult.bindings || {}
        }
        catch (error_) {
          console.warn(`[vue-onigiri] Failed to compile script for ${filePath}:`, error_)
        }
      }

      const hasScoped = descriptor.styles.some(style => style.scoped)
      // https://github.com/vitejs/vite-plugin-vue/blob/main/packages/plugin-vue/src/utils/descriptorCache.ts#L34-L54
      const scopeId = hasScoped ? generateScopeId(filePath, source, config.root, config.isProduction) : null

      // Extract imports from the script block
      let scriptImports = ''
      const scriptContent = descriptor.scriptSetup?.content || descriptor.script?.content || ''
      if (scriptContent) {
        // Match all import statements
        const importRegex = /^import\s+.+?from\s+['"].+?['"];?\s*$/gm
        const imports = scriptContent.match(importRegex)
        if (imports) {
          // Filter and clean imports:
          // 1. Skip type-only imports (import type { ... })
          // 2. Remove inline type imports (import { type Foo, Bar })
          const cleanedImports = imports
            .filter(imp => !/^import\s+type\s+/.test(imp))
            .map((imp) => {
              // Remove "type" keyword from named imports: { type Foo, Bar } -> { Bar }
              return imp.replace(/\{([^}]*)\}/g, (match, inner) => {
                const cleaned = inner
                  .split(',')
                  .map((s: string) => s.trim())
                  .filter((s: string) => !s.startsWith('type '))
                  .join(', ')
                return cleaned ? `{ ${cleaned} }` : ''
              })
            })
            // Filter out imports that became empty after removing types
            .filter(imp => !/^import\s+\{\s*\}\s+from/.test(imp) && !/^import\s+from/.test(imp))

          if (cleanedImports.length > 0) {
            scriptImports = cleanedImports.join('\n') + '\n'
          }
        }
      }

      const importMap = buildImportMap(scriptContent, filePath, config.root)

      const onigiriResult = compileOnigiriInline(descriptor.template.content, {
        filename: filePath,
        sourceMap,
        bindingMetadata,
        scopeId,
        importMap,
      })

      // Build imports string from collected codegen imports
      const codegenImports = [...onigiriResult.imports].join('\n')

      // Build component declarations for resolveComponent calls
      const componentDeclarations = [...onigiriResult.components.entries()]
        .map(([tag, varName]) => `  const ${varName} = _resolveComponent("${tag}")`)
        .join('\n')

      // Export only the render function with required imports
      return {
        code: `${scriptImports}${codegenImports}
export default function __onigiriRender(_ctx, __instance) {
${componentDeclarations}
  return ${onigiriResult.expression};
}`,
        map: null,
      }
    },

    /**
     * Transform hook to inject onigiri support into compiled SFCs.
     * Must run AFTER @vitejs/plugin-vue so we see its compiled output
     * (the main .vue module already rewritten to `export default ...`).
     *
     * We DO NOT use `order: 'post'` here — that would move us after
     * Vite's core `vite:import-analysis` plugin, and the `import
     * __onigiriRender from "virtual:onigiri:..."` specifier we inject
     * would reach the browser unrewritten. Relying on registration
     * order to run after @vitejs/plugin-vue is sufficient.
     */
    transform: {
      async handler(code, id) {
        const [filePath, query] = id.split('?')

        // Only handle .vue files
        if (!filePath || !filePath.endsWith('.vue') || filePath.startsWith(ONIGIRI_PREFIX)) {
          return null
        }

        // For .vue file (no query) - this is the final combined output from Vue (dev mode)
        if (!query) {
          if (code.includes('export default')) {
            // Emit the import specifier with the path URL-encoded and
            // a `.mjs` suffix. This shape round-trips cleanly through
            // Vite's `/@id/` URL rewrite for Windows paths (`D:/…`) and
            // keeps @vitejs/plugin-vue from matching `.vue` and trying
            // to re-parse our generated JS as an SFC.
            const onigiriImport = `${ONIGIRI_PREFIX}${encodeURIComponent(filePath)}${ONIGIRI_SUFFIX}`
            return attachAsProperty(code, filePath, onigiriImport, sourceMap)
          }
          return null
        }

        // Handle compiled script module with type=script query (build mode with inline template)
        if (query.includes('type=script')) {
          // Check if this has inline template (build mode)
          const hasInlineTemplate = code.includes('_createElementVNode')
            || code.includes('_createVNode')
            || code.includes('_createBlock')

          if (hasInlineTemplate) {
            // Build mode: inject into setup - need to read template from disk
            return injectIntoSetupAsync(code, filePath, sourceMap, config)
          }
          // Dev mode with type=script query - skip, we handle main .vue file
          return null
        }

        return null
      },
    },
  }
}

/**
 * Build mode: Inject onigiri check into setup function (async - reads template from disk)
 */
async function injectIntoSetupAsync(
  code: string,
  filePath: string,
  sourceMap: boolean,
  config: ResolvedConfig,
): Promise<{ code: string, map: any } | null> {
  // Must have setup function
  const setupMatch = code.match(
    /setup\s*\(\s*([^,)]*?)(?:,\s*\{[^}]*\})?\s*\)\s*\{/,
  )

  if (!setupMatch || setupMatch.index === undefined) {
    return null
  }

  // Read and parse the SFC to get template
  const fs = await import('node:fs/promises')
  const source = await fs.readFile(filePath, 'utf8')
  const { descriptor } = parse(source, { filename: filePath })

  if (!descriptor.template) {
    return null
  }

  let bindingMetadata: BindingMetadata = {}
  if (descriptor.scriptSetup || descriptor.script) {
    try {
      const scriptResult = compileScript(descriptor, {
        id: filePath,
        sourceMap,
      })
      bindingMetadata = scriptResult.bindings || {}
    }
    catch (error_) {
      console.warn(`[vue-onigiri] Failed to compile script for ${filePath}:`, error_)
    }
  }

  // Check if any style block has scoped attribute
  const hasScoped = descriptor.styles.some(style => style.scoped)
  // https://github.com/vitejs/vite-plugin-vue/blob/main/packages/plugin-vue/src/utils/descriptorCache.ts#L34-L54
  const scopeId = hasScoped ? generateScopeId(filePath, source, config.root, config.isProduction) : null

  const scriptContent = descriptor.scriptSetup?.content || descriptor.script?.content || ''
  const importMap = buildImportMap(scriptContent, filePath, config.root)

  // Compile template to onigiri expression
  const onigiriResult = compileOnigiriInline(descriptor.template.content, {
    filename: filePath,
    sourceMap,
    bindingMetadata,
    scopeId,
    importMap,
  })

  const s = new MagicString(code)

  // Add imports
  const imports = `import { inject as __onigiri_inject, getCurrentInstance as __getCurrentInstance } from "vue";
import { ONIGIRI_RENDER_SYMBOL as __ONIGIRI_SYMBOL } from "vue-onigiri/runtime/shared";
`

  // Injection code - capture instance at setup time, close over it so the
  // returned render fn has the stable onigiri ABI (_ctx, __instance).
  // Vue calls the returned fn as render(proxy, cache), so the first arg is
  // already the proxy; __instance comes from the setup-time closure.
  // The `__onigiri` tag lets the serializer distinguish our render fn from
  // a normal Vue render fn that happens to share the (_ctx) signature.
  const injectionCode = `
  if (__onigiri_inject(__ONIGIRI_SYMBOL, null)) {
    const __instance = __getCurrentInstance();
    const __render = (_ctx) => ${onigiriResult.expression};
    __render.__onigiri = true;
    return __render;
  }
`

  const setupBodyStart = setupMatch.index + setupMatch[0].length
  s.appendLeft(setupBodyStart, injectionCode)
  s.prepend(imports)

  return {
    code: s.toString(),
    map: sourceMap ? s.generateMap({ hires: true }) : null,
  }
}

/**
 * Dev mode: Import onigiri render and attach as component property
 */
function attachAsProperty(
  code: string,
  filePath: string,
  resolvedOnigiriId: string,
  sourceMap: boolean,
): { code: string, map: any } | null {
  // Must have a default export
  if (!code.includes('export default')) {
    return null
  }

  const s = new MagicString(code)

  // Import the onigiri render function using resolved virtual module ID
  const importStatement = `import __onigiriRender from "${resolvedOnigiriId}";\n`

  // Handle Vue's _export_sfc pattern: export default _export_sfc(_sfc_main, [...])
  // This is the common dev mode pattern
  const exportSfcMatch = code.match(
    /export\s+default\s+(?:\/\*[^*]*\*\/\s*)?_export_sfc\s*\(\s*(_sfc_main|_sfc_component)/,
  )

  if (exportSfcMatch && exportSfcMatch[1] && exportSfcMatch.index !== undefined) {
    const componentVar = exportSfcMatch[1]
    s.prepend(importStatement)
    // Attach before the export
    s.appendLeft(exportSfcMatch.index, `${componentVar}.__onigiriRender = __onigiriRender;\n`)

    return {
      code: s.toString(),
      map: sourceMap ? s.generateMap({ hires: true }) : null,
    }
  }

  // Handle: export default _sfc_main
  const varExportMatch = code.match(
    /export\s+default\s+(_sfc_main|__default__|_sfc_component)\s*;?\s*$/m,
  )

  if (varExportMatch && varExportMatch[1] && varExportMatch.index !== undefined) {
    const componentVar = varExportMatch[1]
    s.prepend(importStatement)
    s.appendLeft(varExportMatch.index, `${componentVar}.__onigiriRender = __onigiriRender;\n`)

    return {
      code: s.toString(),
      map: sourceMap ? s.generateMap({ hires: true }) : null,
    }
  }

  // Handle inline export: export default /*...*/ _defineComponent({...})
  const inlineExportMatch = code.match(
    /export\s+default\s+(?:\/\*[^*]*\*\/\s*)?/,
  )

  if (inlineExportMatch && inlineExportMatch.index !== undefined) {
    s.prepend(importStatement)

    const exportStart = inlineExportMatch.index
    const exportPrefix = inlineExportMatch[0]

    s.overwrite(
      exportStart,
      exportStart + exportPrefix.length,
      'const __sfc_with_onigiri = ',
    )
    s.append(`\n__sfc_with_onigiri.__onigiriRender = __onigiriRender;\nexport default __sfc_with_onigiri;`)

    return {
      code: s.toString(),
      map: sourceMap ? s.generateMap({ hires: true }) : null,
    }
  }

  return null
}

export default onigiriCompilerPlugin
