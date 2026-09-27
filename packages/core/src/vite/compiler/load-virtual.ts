import { genString } from "knitwork";
import { compileOnigiriInline } from "../../template-compiler";
import { type OnigiriCompileOptions, analyzeSfc, parseSfcFile } from "./analyze-sfc";
import { parseOnigiriId } from "./constants";
import { genScriptImports } from "./imports";

/**
 * Build the per-SFC standalone `__onigiriRender` module loaded as
 * `<abs-path>.vue?vue&type=onigiri&lang.mjs`. Returns the JS source or
 * `null` when the id isn't an onigiri module.
 */
export async function loadVirtualOnigiriModule(
  id: string,
  opts: OnigiriCompileOptions,
  reportError: (message: string) => void,
): Promise<{ code: string; map: null } | null> {
  const filePath = parseOnigiriId(id);
  if (!filePath) return null;

  const { sourceMap, isCustomElement, additionalImports, resolveChunkUrl, registerTarget } = opts;

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
        `function __onigiriRender(_ctx, __instance) { return null; }\n` +
        `__onigiriRender.__onigiriEmpty = true;\n` +
        `export default __onigiriRender;\n`,
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
    additionalImports: additionalImports,
    isCustomElement,
    resolveChunkUrl,
    registerTarget,
  });

  const codegenImports = [...onigiriResult.imports].join("\n");
  const componentDeclarations = [...onigiriResult.components.entries()]
    .map(
      ([tag, varName]) =>
        `  const ${varName} = __onigiri_resolveComponent(__instance, ${genString(tag)})`,
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
