import { type BindingMetadata, compileScript, parse } from "@vue/compiler-sfc";
import type { ResolvedConfig } from "vite";
import MagicString from "magic-string";
import { compileOnigiriInline } from "../../template-compiler";
import type { AdditionalImport } from "../../template-compiler/codegen/context";
import { generateScopeId } from "./scope-id";
import { buildImportMap } from "./imports";

/**
 * Build a `_ctx` bridge mapping setup-script bindings to their
 * closure-side values. With `__ssrInlineRender: true`, plugin-vue's
 * `setup()` returns the SSR render directly (no exposed setupState),
 * so `instance.proxy.count` is undefined — this bridge re-exposes
 * those locals via the same `_ctx.foo` shape our codegen emits.
 */
function buildBridgeObject(bindingMetadata: BindingMetadata): string {
  const entries: string[] = [];
  for (const [name, type] of Object.entries(bindingMetadata || {})) {
    if (typeof type !== "string" || name.startsWith("__")) continue;
    switch (type) {
      case "props": {
        entries.push(`get ${name}() { return __props.${name} }`);
        break;
      }
      case "setup-ref":
      case "setup-let":
      case "setup-maybe-ref":
      case "setup-reactive-const": {
        entries.push(`get ${name}() { return __onigiri_unref(${name}) }`);
        break;
      }
      case "setup-const": {
        entries.push(`get ${name}() { return ${name} }`);
        break;
      }
    }
  }
  return `{ ${entries.join(", ")} }`;
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
  additionalImports?: Map<string, AdditionalImport>,
  resolveChunkUrl?: (sourcePath: string) => string | undefined,
  registerTarget?: (sourcePath: string) => void,
): Promise<{ code: string; map: any } | null> {
  const setupMatch = code.match(/setup\s*\(\s*([^,)]*?)(?:,\s*\{[^}]*\})?\s*\)\s*\{/);
  if (!setupMatch || setupMatch.index === undefined) return null;

  // Inject AFTER all setup-script bindings are declared but BEFORE the
  // returned render arrow — otherwise the closure is in TDZ when the
  // proxy's getter dereferences a setup binding.
  //
  // The exact arrow shape depends on Vue's render mode:
  //   - SSR (production):     `(_ctx, _push, _parent, _attrs) => {…}`
  //     ...where `_attrs` may be renamed (`_attrs2`/`_attrs3`/…) when
  //     the user's `<script setup>` already declares an `_attrs` binding
  //     (e.g. `const _attrs = useAttrs()` in `@nuxt/image`'s NuxtPicture).
  //   - Client inline-render: `(_ctx, _cache, $props, $setup, $data, $options) => {…}`
  //
  // Match any arrow whose first param is `_ctx` so both shapes (and any
  // bundler-induced renaming of the trailing params) wire up correctly.
  const ssrRenderReturnMatch = code
    .slice(setupMatch.index)
    .match(/return\s*\(\s*_ctx\b[^)]*\)\s*=>\s*\{/);

  // No inline render arrow inside setup → this SFC uses the split-template
  // shape (`setup` returns `__returned__ = { …bindings… }`, and the SSR /
  // client render is a separate module-level function). The standalone
  // `__onigiriRender` already gets the bindings via `instance.setupState`
  // through `createOnigiriCtx`, so the closure bridge is both unnecessary
  // and unsafe to splice (would land before the binding `const`s and TDZ).
  if (!ssrRenderReturnMatch || ssrRenderReturnMatch.index === undefined) {
    return null;
  }

  const fs = await import("node:fs/promises");
  const source = await fs.readFile(filePath, "utf8");
  const { descriptor } = parse(source, { filename: filePath });
  if (!descriptor.template) return null;

  let bindingMetadata: BindingMetadata = {};
  if (descriptor.scriptSetup || descriptor.script) {
    try {
      const scriptResult = compileScript(descriptor, { id: filePath, sourceMap });
      bindingMetadata = scriptResult.bindings || {};
    } catch (error_) {
      console.warn(`[vue-onigiri] Failed to compile script for ${filePath}:`, error_);
    }
  }

  const hasScoped = descriptor.styles.some((style) => style.scoped);
  const scopeId = hasScoped
    ? generateScopeId(filePath, source, config.root, config.isProduction)
    : null;

  const scriptContent = descriptor.scriptSetup?.content || descriptor.script?.content || "";
  const importMap = buildImportMap(scriptContent, filePath, config.root);

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
    additionalImports,
    isCustomElement,
    resolveChunkUrl,
    registerTarget,
  });

  const s = new MagicString(code);

  const imports = `import { inject as __onigiri_inject, getCurrentInstance as __getCurrentInstance, unref as __onigiri_unref } from "vue";
import { ONIGIRI_RENDER_SYMBOL as __ONIGIRI_SYMBOL } from "vue-onigiri/runtime/shared";
`;

  const bridgeObject = buildBridgeObject(bindingMetadata);

  // The injected render delegates to the file's standalone
  // `__onigiriRender` (referenced through `__instance.type` to survive
  // bundler renames), passing a Proxy that resolves in three layers:
  //   1. Setup-script bindings from the closure bridge.
  //   2. Standard instance accessors ($slots/slots, $props/props,
  //      $attrs, $emit, $refs, $parent, $root, `_`) sourced directly
  //      from `__instance`. SSR codegen uses the unprefixed forms
  //      (`_ctx.slots`, `_ctx.props`) while client/template codegen
  //      uses the `$`-prefixed forms — both must resolve.
  //   3. Whatever Vue's `_ctx` exposes (catch-all for setupState/data/props
  //      access through `instance.proxy`).
  // The `__onigiri` tag identifies our render to the serializer.
  const injectionCode = `
  if (__onigiri_inject(__ONIGIRI_SYMBOL, null)) {
    const __instance = __getCurrentInstance();
    const __onigiri_bridge = ${bridgeObject};
    const __onigiri_resolveInstanceKey = (k) => {
      switch (k) {
        case "slots": case "$slots": return __instance.slots;
        case "props": case "$props": return __instance.props;
        case "$attrs": return __instance.attrs;
        case "$emit":  return __instance.emit;
        case "$refs":  return __instance.refs;
        case "$parent": return __instance.parent;
        case "$root":  return __instance.root;
        case "_":      return __instance;
      }
      return undefined;
    };
    const __onigiri_hasInstanceKey = (k) =>
      k === "slots" || k === "$slots" ||
      k === "props" || k === "$props" ||
      k === "$attrs" || k === "$emit" ||
      k === "$refs"  || k === "$parent" || k === "$root" ||
      k === "_";
    const __render = (_ctx) => {
      const _ctx2 = new Proxy(__onigiri_bridge, {
        get(t, k) {
          const v = Reflect.get(t, k);
          if (v !== undefined) return v;
          const inst = __onigiri_resolveInstanceKey(k);
          if (inst !== undefined) return inst;
          return _ctx ? _ctx[k] : undefined;
        },
        has(t, k) {
          return Reflect.has(t, k) || __onigiri_hasInstanceKey(k) || (_ctx && k in _ctx);
        },
      });
      return __instance.type.__onigiriRender(_ctx2, __instance);
    };
    __render.__onigiri = true;
    return __render;
  }
`;

  const injectAt = setupMatch.index + ssrRenderReturnMatch.index;
  s.appendLeft(injectAt, injectionCode);
  s.prepend(imports);

  return {
    code: s.toString(),
    map: sourceMap ? s.generateMap({ hires: true }) : null,
  };
}
