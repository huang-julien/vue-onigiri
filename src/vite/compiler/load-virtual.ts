import { type BindingMetadata, compileScript, parse } from '@vue/compiler-sfc'
import type { ResolvedConfig } from 'vite'
import { compileOnigiriInline } from '../../template-compiler'
import { ONIGIRI_PREFIX, ONIGIRI_SUFFIX } from './constants'
import { generateScopeId } from './scope-id'
import { buildImportMap, extractScriptImports } from './imports'

export interface LoadVirtualOptions {
  config: ResolvedConfig
  sourceMap: boolean
  isCustomElement?: (tag: string) => boolean
}

/**
 * Build the per-SFC standalone `__onigiriRender` module loaded as
 * `virtual:onigiri:<URL-encoded-path>.mjs`. Returns the JS source or
 * `null` when the id isn't an onigiri virtual module.
 */
export async function loadVirtualOnigiriModule(
  id: string,
  opts: LoadVirtualOptions,
  reportError: (message: string) => void,
): Promise<{ code: string, map: null } | null> {
  if (!id.startsWith(ONIGIRI_PREFIX) || !id.endsWith(ONIGIRI_SUFFIX)) return null

  const { config, sourceMap, isCustomElement } = opts
  const encoded = id.slice(ONIGIRI_PREFIX.length, -ONIGIRI_SUFFIX.length)
  const filePath = decodeURIComponent(encoded)
  const fs = await import('node:fs/promises')
  const source = await fs.readFile(filePath, 'utf8')

  const { descriptor, errors } = parse(source, { filename: filePath, sourceMap })
  if (errors.length > 0) {
    for (const error of errors) reportError(error.message)
    return null
  }

  if (!descriptor.template) {
    return {
      code: `export default function __onigiriRender(_ctx, __instance) { return null; }`,
      map: null,
    }
  }

  let bindingMetadata: BindingMetadata = {}
  if (descriptor.scriptSetup || descriptor.script) {
    try {
      const scriptResult = compileScript(descriptor, { id: filePath, sourceMap })
      bindingMetadata = scriptResult.bindings || {}
    }
    catch (error_) {
      console.warn(`[vue-onigiri] Failed to compile script for ${filePath}:`, error_)
    }
  }

  const hasScoped = descriptor.styles.some(style => style.scoped)
  const scopeId = hasScoped ? generateScopeId(filePath, source, config.root, config.isProduction) : null

  const scriptContent = descriptor.scriptSetup?.content || descriptor.script?.content || ''
  const scriptImports = extractScriptImports(scriptContent)
  const importMap = buildImportMap(scriptContent, filePath, config.root)

  const onigiriResult = compileOnigiriInline(descriptor.template.content, {
    filename: filePath,
    sourceMap,
    bindingMetadata,
    scopeId,
    importMap,
    isCustomElement,
  })

  const codegenImports = [...onigiriResult.imports].join('\n')
  const componentDeclarations = [...onigiriResult.components.entries()]
    .map(([tag, varName]) => `  const ${varName} = __onigiri_resolveComponent(__instance, "${tag}")`)
    .join('\n')

  return {
    code: `${scriptImports}${codegenImports}
export default function __onigiriRender(_ctx, __instance) {
${componentDeclarations}
  return ${onigiriResult.expression};
}`,
    map: null,
  }
}
