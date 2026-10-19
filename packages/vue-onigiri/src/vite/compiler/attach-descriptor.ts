import MagicString from "magic-string";

/**
 * Attach the `{ chunk, export }` descriptor to the SFC's default export,
 * handling every export shape plugin-vue emits for the bare `.vue` module
 * (`_export_sfc`, plain var, inline object).
 */
export function attachDescriptor(
  code: string,
  chunk: string,
  sourceMap: boolean,
): { code: string; map: any } | null {
  const s = new MagicString(code);
  const assignment = (varName: string): string =>
    `${varName}.__onigiriDescriptor = ${JSON.stringify({ chunk, export: "default" })};\n`;
  const result = () => ({
    code: s.toString(),
    map: sourceMap ? s.generateMap({ hires: true }) : null,
  });

  const exportSfcMatch = code.match(
    /export\s+default\s+(?:\/\*[^*]*\*\/\s*)?_export_sfc\s*\(\s*(_sfc_main|_sfc_component)/,
  );
  if (exportSfcMatch?.[1] && exportSfcMatch.index !== undefined) {
    s.appendLeft(exportSfcMatch.index, assignment(exportSfcMatch[1]));
    return result();
  }

  const varExportMatch = code.match(
    /export\s+default\s+(_sfc_main|__default__|_sfc_component)\s*(?:;\s*)?$/m,
  );
  if (varExportMatch?.[1] && varExportMatch.index !== undefined) {
    s.appendLeft(varExportMatch.index, assignment(varExportMatch[1]));
    return result();
  }

  const inlineExportMatch = code.match(/export\s+default\s+(?:\/\*[^*]*\*\/\s*)?/);
  if (inlineExportMatch?.index !== undefined) {
    s.overwrite(
      inlineExportMatch.index,
      inlineExportMatch.index + inlineExportMatch[0].length,
      "const __sfc_with_onigiri = ",
    );
    s.append(`\n${assignment("__sfc_with_onigiri")}export default __sfc_with_onigiri;`);
    return result();
  }

  return null;
}
