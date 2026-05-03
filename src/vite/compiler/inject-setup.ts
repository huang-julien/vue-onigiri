import { type BindingMetadata, compileScript, parse } from '@vue/compiler-sfc'
import type { ResolvedConfig } from 'vite'
import MagicString from 'magic-string'
import { compileOnigiriInline } from '../../template-compiler'
import { generateScopeId } from './scope-id'
import { buildImportMap } from './imports'

/**
 * Build a `_ctx` bridge mapping setup-script bindings to their
 * closure-side values. With `__ssrInlineRender: true`, plugin-vue's
 * `setup()` returns the SSR render directly (no exposed setupState),
 * so `instance.proxy.count` is undefined — this bridge re-exposes
 * those locals via the same `_ctx.foo` shape our codegen emits.
 */
function buildBridgeObject(bindingMetadata: BindingMetadata): string {
  const entries: string[] = []
  for (const [name, type] of Object.entries(bindingMetadata || {})) {
    if (typeof type !== 'string' || name.startsWith('__')) continue
    switch (type) {
      case 'props': {
        entries.push(`get ${name}() { return __props.${name} }`)
        break
      }
      case 'setup-ref':
      case 'setup-let':
      case 'setup-maybe-ref':
      case 'setup-reactive-const': {
        entries.push(`get ${name}() { return __onigiri_unref(${name}) }`)
        break
      }
      case 'setup-const': {
        entries.push(`get ${name}() { return ${name} }`)
        break
      }
    }
  }
  return `{ ${entries.join(', ')} }`
}

/**
 * Build mode: inject an inline `__onigiriRender` into the SFC's `setup`,
 * gated on `ONIGIRI_RENDER_SYMBOL`. The injected render closes over the
 * setup-script bindings via a Proxy bridge built from `bindingMetadata`,
 * then delegates to the standalone `__onigiriRender` (which Nuxt's
 * components loader has already rewritten so `<X />` resolves correctly).
 */
export async function injectIntoSetupAsync(
  code: string,
  filePath: string,
  sourceMap: boolean,
  config: ResolvedConfig,
  isCustomElement?: (tag: string) => boolean,
): Promise<{ code: string, map: any } | null> {
  const setupMatch = code.match(/setup\s*\(\s*([^,)]*?)(?:,\s*\{[^}]*\})?\s*\)\s*\{/)
  if (!setupMatch || setupMatch.index === undefined) return null

  // Inject AFTER all setup-script bindings are declared but BEFORE the
  // SSR render's `return (_ctx, _push, …) => {…}` — otherwise the closure
  // would be empty when the render runs.
  const ssrRenderReturnMatch = code.slice(setupMatch.index).match(
    /return\s*\(\s*_ctx\s*,\s*_push\s*,\s*_parent\s*(?:,\s*_attrs\s*)?\)\s*=>\s*\{/,
  )

  const fs = await import('node:fs/promises')
  const source = await fs.readFile(filePath, 'utf8')
  const { descriptor } = parse(source, { filename: filePath })
  if (!descriptor.template) return null

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
  const importMap = buildImportMap(scriptContent, filePath, config.root)

  // We don't actually use `onigiriResult.expression` directly — we
  // delegate to the standalone `__onigiriRender` attached to the
  // component — but compiling here validates the template and gives us
  // the bindingMetadata-driven helper imports if we ever switch back.
  void compileOnigiriInline(descriptor.template.content, {
    filename: filePath,
    sourceMap,
    bindingMetadata,
    scopeId,
    importMap,
    isCustomElement,
  })

  const s = new MagicString(code)

  const imports = `import { inject as __onigiri_inject, getCurrentInstance as __getCurrentInstance, unref as __onigiri_unref } from "vue";
import { ONIGIRI_RENDER_SYMBOL as __ONIGIRI_SYMBOL } from "vue-onigiri/runtime/shared";
`

  const bridgeObject = buildBridgeObject(bindingMetadata)

  // The injected render delegates to the file's standalone
  // `__onigiriRender` (referenced through `__instance.type` to survive
  // bundler renames), passing a Proxy that prefers the closure bridge
  // and falls back to Vue's `_ctx`. The `__onigiri` tag identifies our
  // render to the serializer.
  const injectionCode = `
  if (__onigiri_inject(__ONIGIRI_SYMBOL, null)) {
    const __instance = __getCurrentInstance();
    const __onigiri_bridge = ${bridgeObject};
    const __render = (_ctx) => {
      const _ctx2 = new Proxy(__onigiri_bridge, {
        get(t, k) {
          const v = Reflect.get(t, k);
          if (v !== undefined) return v;
          return _ctx ? _ctx[k] : undefined;
        },
        has(t, k) { return Reflect.has(t, k) || (_ctx && k in _ctx) },
      });
      return __instance.type.__onigiriRender(_ctx2, __instance);
    };
    __render.__onigiri = true;
    return __render;
  }
`

  const injectAt = ssrRenderReturnMatch && ssrRenderReturnMatch.index !== undefined
    ? setupMatch.index + ssrRenderReturnMatch.index
    : setupMatch.index + setupMatch[0].length
  s.appendLeft(injectAt, injectionCode)
  s.prepend(imports)

  return {
    code: s.toString(),
    map: sourceMap ? s.generateMap({ hires: true }) : null,
  }
}
