import { compileOnigiriInline } from "../../template-compiler";
import type { AdditionalImport } from "../../template-compiler/codegen/context";
import { type OnigiriCompileOptions, analyzeSfc, parseSfcFile } from "./analyze-sfc";
import { ONIGIRI_PREFIX, ONIGIRI_SUFFIX } from "./constants";
import { genScriptImports } from "./imports";
import { toRootRelative } from "./paths";

/**
 * Build the per-SFC standalone `__onigiriRender` module loaded as
 * `virtual:onigiri:<URL-encoded-path>.mjs`. Returns the JS source or
 * `null` when the id isn't an onigiri virtual module.
 */
export async function loadVirtualOnigiriModule(
  id: string,
  opts: OnigiriCompileOptions,
  reportError: (message: string) => void,
): Promise<{ code: string; map: null } | null> {
  if (!id.startsWith(ONIGIRI_PREFIX) || !id.endsWith(ONIGIRI_SUFFIX)) return null;

  const { config, sourceMap, isCustomElement, additionalImports, resolveChunkUrl, registerTarget }
    = opts;
  const encoded = id.slice(ONIGIRI_PREFIX.length, -ONIGIRI_SUFFIX.length);
  const filePath = decodeURIComponent(encoded);

  const parsed = await parseSfcFile(filePath, sourceMap);
  const { descriptor, errors } = parsed;
  if (errors.length > 0) {
    for (const error of errors) reportError(error.message);
    return null;
  }

  if (!descriptor.template) {
    // Templateless SFC: stamp `__onigiriEmpty` so the serializer falls
    // through to Vue's real render instead of this no-op.
    return {
      code:
        `function __onigiriRender(_ctx, __instance) { return null; }\n`
        + `__onigiriRender.__onigiriEmpty = true;\n`
        + `export default __onigiriRender;\n`,
      map: null,
    };
  }

  const { bindingMetadata, scopeId, scriptImports, importMap } = await analyzeSfc(
    parsed,
    filePath,
    opts,
  );
  const scriptImportStatements = genScriptImports(scriptImports);

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
      ([tag, varName]) =>
        `  const ${varName} = __onigiri_resolveComponent(__instance, ${JSON.stringify(tag)})`,
    )
    .join("\n");

  return {
    code: `${scriptImportStatements}${codegenImports}
export default function __onigiriRender(_ctx, __instance) {
${componentDeclarations}
  return ${onigiriResult.expression};
}`,
    map: null,
  };
}

/**
 * Normalise externally-supplied additionalImports paths to root-relative
 * form, matching the manifest glob keys and the resolveId root join.
 * Paths outside `config.root` stay absolute.
 */
export function normaliseAdditionalImports(
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
