import { type BindingMetadata, compileScript, parse } from "@vue/compiler-sfc";
import type { ResolvedConfig } from "vite";
import { compileOnigiriInline } from "../../template-compiler";
import type { AdditionalImport } from "../../template-compiler/codegen/context";
import { ONIGIRI_PREFIX, ONIGIRI_SUFFIX } from "./constants";
import { generateScopeId } from "./scope-id";
import { buildImportMap, extractScriptImports } from "./imports";
import { toRootRelative } from "./paths";

export interface LoadVirtualOptions {
  config: ResolvedConfig;
  sourceMap: boolean;
  isCustomElement?: (tag: string) => boolean;
  additionalImports?: Map<string, AdditionalImport>;
  resolveChunkUrl?: (sourcePath: string) => string | undefined;
  registerTarget?: (sourcePath: string) => void;
  /** Bundler resolver (`PluginContext.resolve`) so aliased and package imports resolve for `v-load-client`. */
  resolveImport?: (source: string, importer: string) => Promise<string | null | undefined>;
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
): Promise<{ code: string; map: null } | null> {
  if (!id.startsWith(ONIGIRI_PREFIX) || !id.endsWith(ONIGIRI_SUFFIX)) return null;

  const {
    config,
    sourceMap,
    isCustomElement,
    additionalImports,
    resolveChunkUrl,
    registerTarget,
    resolveImport,
  } = opts;
  const encoded = id.slice(ONIGIRI_PREFIX.length, -ONIGIRI_SUFFIX.length);
  const filePath = decodeURIComponent(encoded);
  const fs = await import("node:fs/promises");
  const source = await fs.readFile(filePath, "utf8");

  const { descriptor, errors } = parse(source, { filename: filePath, sourceMap });
  if (errors.length > 0) {
    for (const error of errors) reportError(error.message);
    return null;
  }

  if (!descriptor.template) {
    // Templateless SFC (script-only render fn, or pure setup-returning-fn).
    // Stamp `__onigiriEmpty` so the runtime serializer knows to fall through
    // to Vue's real `render`/`ssrRender` instead of taking this no-op path.
    return {
      code:
        `function __onigiriRender(_ctx, __instance) { return null; }\n`
        + `__onigiriRender.__onigiriEmpty = true;\n`
        + `export default __onigiriRender;\n`,
      map: null,
    };
  }

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
  const scriptImports = extractScriptImports(scriptContent);
  const importMap = await buildImportMap(
    scriptContent,
    filePath,
    config.root,
    resolveImport ? (source) => resolveImport(source, filePath) : undefined,
  );

  const onigiriResult = compileOnigiriInline(descriptor.template.content, {
    filename: filePath,
    sourceMap,
    bindingMetadata,
    scopeId,
    importMap,
    additionalImports: normaliseAdditionalImports(additionalImports, config.root),
    isCustomElement,
    resolveChunkUrl,
    registerTarget,
  });

  const codegenImports = [...onigiriResult.imports].join("\n");
  const componentDeclarations = [...onigiriResult.components.entries()]
    .map(
      ([tag, varName]) => `  const ${varName} = __onigiri_resolveComponent(__instance, "${tag}")`,
    )
    .join("\n");

  return {
    code: `${scriptImports}${codegenImports}
export default function __onigiriRender(_ctx, __instance) {
${componentDeclarations}
  return ${onigiriResult.expression};
}`,
    map: null,
  };
}

/**
 * Convert externally-supplied `additionalImports` paths (Nuxt
 * components etc) into root-relative form anchored at Vite's
 * `config.root`. The codegen needs root-relative for both the
 * v-load-client chunk literals (matching the runtime importFn's
 * `import.meta.glob` keys) AND the static SSR import (the resolveId
 * hook joins `/foo` back to `<config.root>/foo`).
 *
 * Paths that don't sit under `config.root` are left absolute — Vite
 * resolves those directly without needing a root prefix.
 */
function normaliseAdditionalImports(
  raw: Map<string, AdditionalImport> | undefined,
  root: string,
): Map<string, AdditionalImport> | undefined {
  if (!raw) return raw;
  const out = new Map<string, AdditionalImport>();
  for (const [tag, entry] of raw) {
    out.set(tag, { path: toRootRelative(entry.path, root), export: entry.export });
  }
  return out;
}
