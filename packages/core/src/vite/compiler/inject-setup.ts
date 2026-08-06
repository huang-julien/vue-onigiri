import { type BindingMetadata, compileScript, parse } from "@vue/compiler-sfc";
import type { ResolvedConfig } from "vite";
import MagicString from "magic-string";
import { compileOnigiriInline } from "../../template-compiler";
import type { AdditionalImport } from "../../template-compiler/codegen/context";
import { generateScopeId } from "./scope-id";
import { buildImportMap } from "./imports";

/**
 * Build a `_ctx` bridge exposing setup-script bindings from the closure.
 * Under `__ssrInlineRender` setup returns the render directly and exposes
 * no setupState, so `_ctx.foo` must read the closure instead.
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
      case "setup-const":
      // Plain consts are closure bindings too; without a bridge entry the
      // lookup falls through to an empty `_ctx[k]` and renders `undefined`.
      case "literal-const": {
        entries.push(`get ${name}() { return ${name} }`);
        break;
      }
    }
  }
  return `{ ${entries.join(", ")} }`;
}

/**
 * Build mode: inject an inline `__onigiriRender` into the SFC's setup,
 * gated on `ONIGIRI_RENDER_SYMBOL`, closing over setup bindings via a
 * Proxy bridge and delegating to the standalone `__onigiriRender`.
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
  resolveImport?: (source: string, importer: string) => Promise<string | null | undefined>,
): Promise<{ code: string; map: any } | null> {
  const setupMatch = code.match(/setup\s*\(\s*([^,)]*?)(?:,\s*\{[^}]*\})?\s*\)\s*\{/);
  if (!setupMatch || setupMatch.index === undefined) return null;

  // Inject after setup-script bindings are declared but before setup's own
  // `return` (earlier hits the TDZ, later is unreachable). Two compiler
  // output shapes, both anchored on the first top-level return:
  //
  //   A. Inline SSR render arrow (`__ssrInlineRender` + small template):
  //        `return (_ctx, _push, _parent[, _attrs]) => {...}`
  //      `_attrs` may be renamed (`_attrs2`, ...) when the script declares one.
  //
  //   B. Split-template shape (top-level `await` or large template):
  //        `return __returned__`
  //        `return (Object.defineProperty(__returned__, ...), __returned__)`
  //
  // Returning a function from setup is what makes Vue use it as the render
  // fn (see `setupStatefulComponent` in `@vue/runtime-core`).
  const codeFromSetup = code.slice(setupMatch.index);
  const inlineRenderMatch = codeFromSetup.match(/return\s*\(\s*_ctx\b[^)]*\)\s*=>\s*\{/);
  const splitTemplateMatch = inlineRenderMatch
    ? null
    : codeFromSetup.match(
        /return\s+(?:__returned__|\(\s*Object\.defineProperty\s*\(\s*__returned__)\b/,
      );

  const renderReturnMatch = inlineRenderMatch ?? splitTemplateMatch;

  // No anchor (Options API, unknown shape): skip injection; the attached
  // standalone render still reads bindings via setupState / proxy.
  if (!renderReturnMatch || renderReturnMatch.index === undefined) {
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
  const importMap = await buildImportMap(
    scriptContent,
    filePath,
    config.root,
    resolveImport ? (src) => resolveImport(src, filePath) : undefined,
  );

  // Result unused (we delegate to the standalone render); compiling here
  // still validates the template.
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

  // Delegates to the standalone render via `__instance.type` (survives
  // bundler renames) behind a Proxy resolving the closure bridge first,
  // then instance accessors (both `slots` and `$slots` forms must work),
  // then Vue's `_ctx`. The `__onigiri` tag marks our render for the serializer.
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

  const injectAt = setupMatch.index + renderReturnMatch.index;
  s.appendLeft(injectAt, injectionCode);
  s.prepend(imports);

  return {
    code: s.toString(),
    map: sourceMap ? s.generateMap({ hires: true }) : null,
  };
}
