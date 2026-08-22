import { genImport } from "knitwork";
import MagicString from "magic-string";

/**
 * Attach `__onigiriRender` and the `{ chunk, export }` descriptor to the
 * SFC's default export, handling every export shape plugin-vue emits for
 * the bare `.vue` chunk (`_export_sfc`, plain var, inline object).
 */
export function attachAsProperty(
  code: string,
  resolvedOnigiriId: string,
  sourceMap: boolean,
  descriptorChunk?: string,
  descriptorExport: string = "default",
): { code: string; map: any } | null {
  if (!code.includes("export default")) return null;

  const s = new MagicString(code);
  const importStatement = genImport(resolvedOnigiriId, "__onigiriRender") + "\n";
  const descriptorJSON = descriptorChunk
    ? JSON.stringify({ chunk: descriptorChunk, export: descriptorExport })
    : null;
  const buildAssignments = (varName: string): string => {
    let out = `${varName}.__onigiriRender = __onigiriRender;\n`;
    if (descriptorJSON) {
      out += `${varName}.__onigiriASTDescriptor = ${descriptorJSON};\n`;
    }
    return out;
  };

  const exportSfcMatch = code.match(
    /export\s+default\s+(?:\/\*[^*]*\*\/\s*)?_export_sfc\s*\(\s*(_sfc_main|_sfc_component)/,
  );
  if (exportSfcMatch && exportSfcMatch[1] && exportSfcMatch.index !== undefined) {
    s.prepend(importStatement);
    s.appendLeft(exportSfcMatch.index, buildAssignments(exportSfcMatch[1]));
    return { code: s.toString(), map: sourceMap ? s.generateMap({ hires: true }) : null };
  }

  const varExportMatch = code.match(
    /export\s+default\s+(_sfc_main|__default__|_sfc_component)\s*;?\s*$/m,
  );
  if (varExportMatch && varExportMatch[1] && varExportMatch.index !== undefined) {
    s.prepend(importStatement);
    s.appendLeft(varExportMatch.index, buildAssignments(varExportMatch[1]));
    return { code: s.toString(), map: sourceMap ? s.generateMap({ hires: true }) : null };
  }

  const inlineExportMatch = code.match(/export\s+default\s+(?:\/\*[^*]*\*\/\s*)?/);
  if (inlineExportMatch && inlineExportMatch.index !== undefined) {
    s.prepend(importStatement);
    s.overwrite(
      inlineExportMatch.index,
      inlineExportMatch.index + inlineExportMatch[0].length,
      "const __sfc_with_onigiri = ",
    );
    s.append(`\n${buildAssignments("__sfc_with_onigiri")}export default __sfc_with_onigiri;`);
    return { code: s.toString(), map: sourceMap ? s.generateMap({ hires: true }) : null };
  }

  return null;
}
